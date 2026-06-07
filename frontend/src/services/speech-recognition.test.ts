import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createSpeechRecognitionSession,
  getInterviewSpeechRecognitionProfile,
  isSpeechRecognitionSupported,
} from './speech-recognition';

interface MockRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onresult: ((event: { readonly results: unknown }) => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
}

function createIndexedCollection<T>(items: readonly T[]): {
  readonly length: number;
  item(index: number): T | null;
  readonly [index: number]: T;
} {
  return Object.assign(
    {
      length: items.length,
      item(index: number): T | null {
        return items[index] ?? null;
      },
    },
    Object.fromEntries(items.map((item, index) => [index, item])),
  ) as {
    readonly length: number;
    item(index: number): T | null;
    readonly [index: number]: T;
  };
}

describe('speech-recognition', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'SpeechRecognition');
    Reflect.deleteProperty(window, 'webkitSpeechRecognition');
    vi.restoreAllMocks();
  });

  it('reports support and returns the default profile', () => {
    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      maxAlternatives = 0;
      onstart = null;
      onend = null;
      onerror = null;
      onresult = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
    }

    Reflect.set(window, 'SpeechRecognition', MockSpeechRecognition);

    expect(isSpeechRecognitionSupported()).toBe(true);
    expect(getInterviewSpeechRecognitionProfile()).toEqual({
      lang: 'zh-CN',
      description: '默认按中文识别，并对 AI、RAG、TypeScript、Node.js 等常见英文技术词做优先保留和格式归一化。',
    });
  });

  it('returns null when the browser does not support speech recognition', () => {
    expect(isSpeechRecognitionSupported()).toBe(false);
    expect(
      createSpeechRecognitionSession({
        onError: () => undefined,
        onTranscript: () => undefined,
      }),
    ).toBeNull();
  });

  it('normalizes transcripts and forwards lifecycle callbacks', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const onError = vi.fn();
    const onTranscript = vi.fn();
    let recognitionInstance: MockRecognitionInstance | null = null;

    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      maxAlternatives = 0;
      onstart = null;
      onend = null;
      onerror = null;
      onresult = null;
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();

      constructor() {
        recognitionInstance = this;
      }
    }

    Reflect.set(window, 'webkitSpeechRecognition', MockSpeechRecognition);

    const session = createSpeechRecognitionSession({
      lang: 'en-US',
      onStart,
      onEnd,
      onError,
      onTranscript,
    });

    expect(session).not.toBeNull();
    expect(recognitionInstance).not.toBeNull();
    expect(recognitionInstance?.continuous).toBe(true);
    expect(recognitionInstance?.interimResults).toBe(true);
    expect(recognitionInstance?.maxAlternatives).toBe(3);
    expect(recognitionInstance?.lang).toBe('en-US');

    expect(session?.start()).toBe(true);
    recognitionInstance?.onstart?.();
    recognitionInstance?.onresult?.({
      results: createIndexedCollection([
        {
          isFinal: true,
          ...createIndexedCollection([
            { transcript: '普通回答' },
            { transcript: 'ai agent with type script and node js' },
          ]),
        },
        {
          isFinal: false,
          ...createIndexedCollection([{ transcript: 'rag follow up' }]),
        },
      ]),
    });
    recognitionInstance?.onerror?.({ error: 'network' });
    recognitionInstance?.onerror?.({ error: 'aborted' });
    recognitionInstance?.onend?.();
    session?.stop();
    session?.abort();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('语音识别网络异常，请稍后重试。');
    expect(onTranscript).toHaveBeenCalledWith({
      finalTranscript: 'AI Agent with TypeScript and Node.js',
      interimTranscript: 'RAG follow up',
    });
    expect(recognitionInstance?.stop).toHaveBeenCalledTimes(1);
    expect(recognitionInstance?.abort).toHaveBeenCalledTimes(1);
  });

  it('surfaces a startup error when recognition.start throws', () => {
    const onError = vi.fn();

    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      maxAlternatives = 0;
      onstart = null;
      onend = null;
      onerror = null;
      onresult = null;
      start = vi.fn(() => {
        throw new Error('boom');
      });
      stop = vi.fn();
      abort = vi.fn();
    }

    Reflect.set(window, 'SpeechRecognition', MockSpeechRecognition);

    const session = createSpeechRecognitionSession({
      onError,
      onTranscript: () => undefined,
    });

    expect(session?.start()).toBe(false);
    expect(onError).toHaveBeenCalledWith('语音输入无法启动，请刷新页面后重试。');
  });
});
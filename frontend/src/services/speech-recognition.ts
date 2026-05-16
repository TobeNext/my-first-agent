interface BrowserSpeechRecognitionAlternative {
  readonly transcript: string;
}

interface BrowserSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): BrowserSpeechRecognitionAlternative | null;
  readonly [index: number]: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionResultList {
  readonly length: number;
  item(index: number): BrowserSpeechRecognitionResult | null;
  readonly [index: number]: BrowserSpeechRecognitionResult;
}

interface BrowserSpeechRecognitionEvent {
  readonly results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognitionErrorEvent {
  readonly error: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives?: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface BrowserSpeechRecognitionConstructor {
  new (): BrowserSpeechRecognition;
}

export interface SpeechRecognitionTranscript {
  readonly finalTranscript: string;
  readonly interimTranscript: string;
}

export interface SpeechRecognitionSession {
  start(): boolean;
  stop(): void;
  abort(): void;
}

export interface SpeechRecognitionProfile {
  readonly lang: string;
  readonly description: string;
}

export interface CreateSpeechRecognitionSessionOptions {
  readonly lang?: string;
  readonly onStart?: () => void;
  readonly onEnd?: () => void;
  readonly onError: (message: string) => void;
  readonly onTranscript: (transcript: SpeechRecognitionTranscript) => void;
}

function isSpeechRecognitionConstructor(value: unknown): value is BrowserSpeechRecognitionConstructor {
  return typeof value === 'function';
}

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  const speechRecognition = Reflect.get(window, 'SpeechRecognition');
  if (isSpeechRecognitionConstructor(speechRecognition)) {
    return speechRecognition;
  }

  const webkitSpeechRecognition = Reflect.get(window, 'webkitSpeechRecognition');
  return isSpeechRecognitionConstructor(webkitSpeechRecognition) ? webkitSpeechRecognition : null;
}

function getResultAtIndex(results: BrowserSpeechRecognitionResultList, index: number): BrowserSpeechRecognitionResult | null {
  return results.item(index) ?? results[index] ?? null;
}

function getAlternativeAtIndex(
  result: BrowserSpeechRecognitionResult,
  index: number,
): BrowserSpeechRecognitionAlternative | null {
  return result.item(index) ?? result[index] ?? null;
}

const INTERVIEW_SPEECH_RECOGNITION_PROFILE: SpeechRecognitionProfile = {
  lang: 'zh-CN',
  description: '默认按中文识别，并对 AI、RAG、TypeScript、Node.js 等常见英文技术词做优先保留和格式归一化。',
};

const TRANSCRIPT_NORMALIZATION_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bai\b/giu, 'AI'],
  [/\brag\b/giu, 'RAG'],
  [/\bllm\b/giu, 'LLM'],
  [/\bmcp\b/giu, 'MCP'],
  [/\bsse\b/giu, 'SSE'],
  [/\bbff\b/giu, 'BFF'],
  [/\bapi\b/giu, 'API'],
  [/\bsdk\b/giu, 'SDK'],
  [/\bgl?m\b/giu, 'GLM'],
  [/\bci\/?cd\b/giu, 'CI/CD'],
  [/\bopen\s*ai\b/giu, 'OpenAI'],
  [/\btype\s*script\b/giu, 'TypeScript'],
  [/\btypescript\b/giu, 'TypeScript'],
  [/\bjava\s*script\b/giu, 'JavaScript'],
  [/\bjavascript\b/giu, 'JavaScript'],
  [/\bnode\s*\.?\s*js\b/giu, 'Node.js'],
  [/\bvue\s*3\b/giu, 'Vue 3'],
  [/\bvue\b/giu, 'Vue'],
  [/\breact\b/giu, 'React'],
  [/\bpython\b/giu, 'Python'],
  [/\bmastra\b/giu, 'Mastra'],
  [/\bprompt\b/giu, 'Prompt'],
  [/\bembedding(s)?\b/giu, 'Embedding$1'],
  [/\bworkflow(s)?\b/giu, 'Workflow$1'],
  [/\bagent(s)?\b/giu, 'Agent$1'],
  [/\bfunction\s*calling\b/giu, 'Function Calling'],
];

const TECHNICAL_TERM_PATTERNS: readonly RegExp[] = [
  /\b(ai|rag|llm|mcp|sse|bff|api|sdk|typescript|javascript|node\.?js|python|vue|react|openai|mastra)\b/giu,
  /\b(function\s*calling|embedding|workflow|agent)\b/giu,
];

function normalizeTranscriptSpacing(value: string): string {
  return value
    .replace(/\s+/gu, ' ')
    .replace(/\s+([,.;:!?])/gu, '$1')
    .replace(/([\u4e00-\u9fff])\s+([,.;:!?])/gu, '$1$2')
    .trim();
}

function normalizeInterviewTranscript(value: string): string {
  let normalizedValue = normalizeTranscriptSpacing(value);

  for (const [pattern, replacement] of TRANSCRIPT_NORMALIZATION_RULES) {
    normalizedValue = normalizedValue.replace(pattern, replacement);
  }

  return normalizedValue;
}

function scoreTranscriptCandidate(value: string): number {
  let score = 0;

  for (const pattern of TECHNICAL_TERM_PATTERNS) {
    const matches = value.match(pattern);
    score += matches?.length ?? 0;
  }

  if (/[A-Za-z]/u.test(value)) {
    score += 1;
  }

  if (/[\u4e00-\u9fff]/u.test(value)) {
    score += 1;
  }

  return score;
}

function selectBestTranscript(result: BrowserSpeechRecognitionResult): string {
  let bestTranscript = '';
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < result.length; index += 1) {
    const alternative = getAlternativeAtIndex(result, index);
    const transcript = alternative?.transcript.trim() ?? '';
    if (!transcript) {
      continue;
    }

    const normalizedTranscript = normalizeInterviewTranscript(transcript);
    const score = scoreTranscriptCandidate(normalizedTranscript);
    if (score > bestScore) {
      bestScore = score;
      bestTranscript = normalizedTranscript;
    }
  }

  return bestTranscript;
}

function extractTranscript(event: BrowserSpeechRecognitionEvent): SpeechRecognitionTranscript {
  const finalSegments: string[] = [];
  const interimSegments: string[] = [];

  for (let index = 0; index < event.results.length; index += 1) {
    const result = getResultAtIndex(event.results, index);
    const transcript = result ? selectBestTranscript(result) : '';

    if (!transcript || !result) {
      continue;
    }

    if (result.isFinal) {
      finalSegments.push(transcript);
      continue;
    }

    interimSegments.push(transcript);
  }

  return {
    finalTranscript: finalSegments.join(' ').trim(),
    interimTranscript: interimSegments.join(' ').trim(),
  };
}

function formatSpeechRecognitionError(error: string): string {
  switch (error) {
    case 'audio-capture':
      return '未检测到可用麦克风。';
    case 'network':
      return '语音识别网络异常，请稍后重试。';
    case 'not-allowed':
    case 'service-not-allowed':
      return '浏览器未授予麦克风权限，请允许访问麦克风后重试。';
    case 'no-speech':
      return '没有识别到语音，请靠近麦克风后重试。';
    case 'aborted':
      return '语音输入已停止。';
    default:
      return '语音输入失败，请稍后重试。';
  }
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionConstructor() !== null;
}

export function getInterviewSpeechRecognitionProfile(): SpeechRecognitionProfile {
  return INTERVIEW_SPEECH_RECOGNITION_PROFILE;
}

export function createSpeechRecognitionSession(
  options: CreateSpeechRecognitionSessionOptions,
): SpeechRecognitionSession | null {
  const SpeechRecognition = getSpeechRecognitionConstructor();
  if (!SpeechRecognition) {
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
  recognition.lang = options.lang ?? INTERVIEW_SPEECH_RECOGNITION_PROFILE.lang;
  recognition.onstart = options.onStart ?? null;
  recognition.onend = options.onEnd ?? null;
  recognition.onerror = (event) => {
    if (event.error === 'aborted') {
      return;
    }

    options.onError(formatSpeechRecognitionError(event.error));
  };
  recognition.onresult = (event) => {
    options.onTranscript(extractTranscript(event));
  };

  return {
    start(): boolean {
      try {
        recognition.start();
        return true;
      } catch {
        options.onError('语音输入无法启动，请刷新页面后重试。');
        return false;
      }
    },
    stop(): void {
      recognition.stop();
    },
    abort(): void {
      recognition.abort();
    },
  };
}

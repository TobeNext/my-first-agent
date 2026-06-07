import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPersistedInterviewSession,
  clearPersistedInterviewSession,
  hasRestorableInterviewSession,
  readPersistedInterviewSession,
  savePersistedInterviewSession,
} from './interview-session-storage';

const baseInterviewState = {
  assistantReply: '请先介绍一下你在这个项目里的职责。',
  flowTestMockUserReply: null,
  phase: 'interviewing',
  activeRoundType: 'professional-skills',
  activeNodeTopic: 'TypeScript',
  finalReportReady: false,
  progress: {
    totalQuestionCount: 4,
    completedQuestionCount: 1,
    remainingQuestionCount: 3,
    currentQuestionIndex: 2,
    currentRoundType: 'professional-skills' as const,
    currentRoundLabel: '专业技能轮',
    currentStage: 'main-question' as const,
    currentFollowUpIndex: null,
    currentQuestionText: '你如何处理 TypeScript 中的类型收窄？',
    currentNodeTopic: 'TypeScript',
  },
};

const baseSettings = {
  reviewIncorrectOrMissingPoints: true,
  skipProfessionalSkillsRound: false,
  skipProjectExperienceRound: false,
  enableFlowTestMode: false,
  professionalQuestionMode: 'per-skill-default' as const,
  professionalQuestionCount: 3,
  projectQuestionCount: 2,
};

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe('interview-session-storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('returns null when no persisted session exists yet', () => {
    expect(readPersistedInterviewSession()).toBeNull();
    expect(hasRestorableInterviewSession()).toBe(false);
  });

  it('builds and saves a validated interview session snapshot', () => {
    const session = buildPersistedInterviewSession({
      threadId: 'thread-1',
      settings: baseSettings,
      interviewState: baseInterviewState,
      updatedAt: '2026-05-17T08:00:00.000Z',
    });

    savePersistedInterviewSession(session);

    expect(readPersistedInterviewSession()).toEqual({
      threadId: 'thread-1',
      settings: baseSettings,
      summary: {
        phase: 'interviewing',
        activeRoundType: 'professional-skills',
        finalReportReady: false,
        totalQuestionCount: 4,
        completedQuestionCount: 1,
        currentStage: 'main-question',
        currentQuestionIndex: 2,
        currentRoundType: 'professional-skills',
        currentFollowUpIndex: null,
        remainingQuestionCount: 3,
        currentQuestionText: '你如何处理 TypeScript 中的类型收窄？',
        assistantReply: '请先介绍一下你在这个项目里的职责。',
      },
      updatedAt: '2026-05-17T08:00:00.000Z',
    });
  });

  it('reports whether the latest session is still restorable', () => {
    savePersistedInterviewSession(
      buildPersistedInterviewSession({
        threadId: 'thread-2',
        settings: baseSettings,
        interviewState: baseInterviewState,
        updatedAt: '2026-05-17T09:00:00.000Z',
      }),
    );

    expect(hasRestorableInterviewSession()).toBe(true);

    savePersistedInterviewSession(
      buildPersistedInterviewSession({
        threadId: 'thread-3',
        settings: baseSettings,
        interviewState: {
          ...baseInterviewState,
          finalReportReady: true,
          progress: {
            ...baseInterviewState.progress,
            currentStage: 'completed',
            remainingQuestionCount: 0,
          },
        },
        updatedAt: '2026-05-17T09:30:00.000Z',
      }),
    );

    expect(hasRestorableInterviewSession()).toBe(false);
  });

  it('drops invalid payloads from localStorage', () => {
    window.localStorage.setItem(
      'frontend.recent-interview-session',
      JSON.stringify({
        threadId: '',
        settings: {},
      }),
    );

    expect(readPersistedInterviewSession()).toBeNull();
    expect(window.localStorage.getItem('frontend.recent-interview-session')).toBeNull();
  });

  it('drops malformed JSON payloads from localStorage', () => {
    window.localStorage.setItem('frontend.recent-interview-session', '{bad json');

    expect(readPersistedInterviewSession()).toBeNull();
    expect(window.localStorage.getItem('frontend.recent-interview-session')).toBeNull();
  });

  it('supports injected storage implementations', () => {
    const storage = createMemoryStorage();
    const session = buildPersistedInterviewSession({
      threadId: 'thread-5',
      settings: baseSettings,
      interviewState: baseInterviewState,
      updatedAt: '2026-05-17T10:00:00.000Z',
    });

    savePersistedInterviewSession(session, storage);

    expect(readPersistedInterviewSession(storage)?.threadId).toBe('thread-5');

    clearPersistedInterviewSession(storage);

    expect(readPersistedInterviewSession(storage)).toBeNull();
  });

  it('returns null when localStorage is unavailable', () => {
    const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });

    expect(readPersistedInterviewSession()).toBeNull();
    expect(hasRestorableInterviewSession()).toBe(false);
    expect(() =>
      savePersistedInterviewSession(
        buildPersistedInterviewSession({
          threadId: 'thread-unavailable',
          settings: baseSettings,
          interviewState: baseInterviewState,
        }),
      ),
    ).not.toThrow();
    expect(() => clearPersistedInterviewSession()).not.toThrow();

    if (localStorageDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor);
    }
  });

  it('ignores storage write failures', () => {
    const storage = {
      getItem() {
        return null;
      },
      removeItem() {
        return undefined;
      },
      setItem() {
        throw new Error('quota exceeded');
      },
    };

    expect(() =>
      savePersistedInterviewSession(
        buildPersistedInterviewSession({
          threadId: 'thread-6',
          settings: baseSettings,
          interviewState: baseInterviewState,
        }),
        storage,
      ),
    ).not.toThrow();
  });

  it('returns null when storage getItem throws', () => {
    const storage = {
      getItem() {
        throw new Error('blocked');
      },
      removeItem() {
        return undefined;
      },
      setItem() {
        return undefined;
      },
    };

    expect(readPersistedInterviewSession(storage)).toBeNull();
  });

  it('returns null when malformed-payload cleanup also fails', () => {
    const storage = {
      getItem() {
        return '{bad json';
      },
      removeItem() {
        throw new Error('cleanup blocked');
      },
      setItem() {
        return undefined;
      },
    };

    expect(readPersistedInterviewSession(storage)).toBeNull();
  });

  it('ignores explicit clear failures', () => {
    const storage = {
      getItem() {
        return null;
      },
      removeItem() {
        throw new Error('cleanup blocked');
      },
      setItem() {
        return undefined;
      },
    };

    expect(() => clearPersistedInterviewSession(storage)).not.toThrow();
  });

  it('clears the persisted session explicitly', () => {
    savePersistedInterviewSession(
      buildPersistedInterviewSession({
        threadId: 'thread-4',
        settings: baseSettings,
        interviewState: baseInterviewState,
      }),
    );

    clearPersistedInterviewSession();

    expect(readPersistedInterviewSession()).toBeNull();
  });
});
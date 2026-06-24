const DEFAULT_ENDPOINT = 'http://localhost:3000/api/agents/chat/stream';
const INTERVIEW_TOOL_NAME = 'interviewStateManagerTool';

export function parseSseDataLines(sseText) {
  return String(sseText)
    .split(/\r?\n\r?\n/)
    .flatMap((block) =>
      block
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .filter(Boolean),
    );
}

export function extractInterviewSnapshotFromSse(sseText) {
  const dataLines = parseSseDataLines(sseText);
  let streamedText = '';
  let finalSnapshot = null;
  let done = false;
  const errors = [];

  for (const dataLine of dataLines) {
    if (dataLine === '[DONE]') {
      done = true;
      continue;
    }

    let event;
    try {
      event = JSON.parse(dataLine);
    } catch (error) {
      errors.push(`Invalid SSE JSON data line: ${error.message}`);
      continue;
    }

    if (event?.type === 'text-delta' && typeof event?.payload?.text === 'string') {
      streamedText += event.payload.text;
      continue;
    }

    if (
      event?.type === 'tool-result' &&
      event?.payload?.toolName === INTERVIEW_TOOL_NAME &&
      event?.payload?.result
    ) {
      finalSnapshot = event.payload.result;
    }
  }

  return {
    done,
    streamedText,
    finalSnapshot,
    assistantReply: finalSnapshot?.assistantReply ?? (streamedText.trim() || null),
    errors,
  };
}

export async function callInterviewSseProvider(options = {}) {
  const endpoint = options.endpoint ?? process.env.PROMPTFOO_INTERVIEW_ENDPOINT ?? DEFAULT_ENDPOINT;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required to call the interview SSE provider.');
  }

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(options.headers ?? {}),
    },
    body: JSON.stringify(options.request ?? options.vars ?? {}),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`Interview SSE provider returned HTTP ${response.status}: ${bodyText}`);
  }

  return extractInterviewSnapshotFromSse(bodyText);
}

export async function callInterviewSseSequence(options = {}) {
  const requests = Array.isArray(options.requests)
    ? options.requests
    : [options.request ?? options.vars ?? {}];
  let latestResult = null;

  for (const request of requests) {
    latestResult = await callInterviewSseProvider({
      endpoint: options.endpoint,
      fetchImpl: options.fetchImpl,
      headers: options.headers,
      request,
    });
  }

  return latestResult ?? {
    done: false,
    streamedText: '',
    finalSnapshot: null,
    assistantReply: null,
    errors: ['No requests were provided.'],
  };
}

export default class InterviewSseProvider {
  constructor(options = {}) {
    this.providerId = options.id ?? 'interview-sse-provider';
    this.config = options.config ?? {};
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt, context = {}) {
    const request = context.vars?.request ?? context.vars ?? { message: prompt };
    const requests = context.vars?.requests;
    const result = await callInterviewSseSequence({
      endpoint: this.config.endpoint,
      headers: this.config.headers,
      request,
      requests,
    });

    return {
      output: JSON.stringify(result.finalSnapshot ?? { assistantReply: result.assistantReply }),
      metadata: {
        done: result.done,
        hasFinalSnapshot: result.finalSnapshot !== null,
        errors: result.errors,
      },
    };
  }
}

interface ErrorPayload {
  readonly message?: string | string[];
}

export interface ParsedHttpErrorPayload {
  readonly message: string;
  readonly details?: readonly string[];
}

export async function parseHttpErrorPayload(
  response: Response,
  options?: {
    readonly arrayMessageFallback?: string;
    readonly includeRawTextFallback?: boolean;
  },
): Promise<ParsedHttpErrorPayload> {
  const fallbackMessage = `Request failed with status ${response.status}.`;
  let rawText = '';

  try {
    rawText = await response.text();
  } catch {
    return {
      message: fallbackMessage,
    };
  }

  try {
    const payload = JSON.parse(rawText) as ErrorPayload;
    if (Array.isArray(payload.message)) {
      return {
        message: options?.arrayMessageFallback ?? payload.message[0] ?? fallbackMessage,
        details: payload.message,
      };
    }

    return {
      message: payload.message ?? fallbackMessage,
    };
  } catch {
    return {
      message: options?.includeRawTextFallback && rawText ? rawText : fallbackMessage,
    };
  }
}
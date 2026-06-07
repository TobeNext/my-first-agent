import { resolveInterviewE2eEnvironment } from './interview-e2e-environment';

export function createE2eMarkdownFile(fileName: string, markdown: string): File {
  return new File([markdown], fileName, {
    type: 'text/markdown',
  });
}

export async function withBffRelativeApiBase<T>(
  run: () => Promise<T>,
  baseUrl = resolveInterviewE2eEnvironment().bff.url,
): Promise<T> {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      return originalFetch(`${baseUrl}${input}`, init);
    }

    if (input instanceof URL && input.pathname.startsWith('/')) {
      return originalFetch(new URL(input.pathname + input.search, baseUrl), init);
    }

    if (input instanceof Request && input.url.startsWith('/')) {
      return originalFetch(new Request(`${baseUrl}${input.url}`, input), init);
    }

    return originalFetch(input, init);
  }) as typeof globalThis.fetch;

  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
export interface InterviewE2eServiceTarget {
  readonly name: string;
  readonly url: string;
  readonly probeUrl?: string;
}

export interface InterviewE2eEnvironment {
  readonly frontend: InterviewE2eServiceTarget;
  readonly bff: InterviewE2eServiceTarget;
  readonly mastra: InterviewE2eServiceTarget;
  readonly agentRuntime: InterviewE2eServiceTarget & {
    readonly provider: 'mastra' | 'python';
  };
}

export function resolveInterviewE2eEnvironment(): InterviewE2eEnvironment {
  const mastraUrl = process.env.INTERVIEW_E2E_MASTRA_URL ?? 'http://localhost:4111';
  const pythonUrl = process.env.INTERVIEW_E2E_PY_AGENT_URL ?? 'http://localhost:8011';
  const provider =
    process.env.INTERVIEW_E2E_AGENT_RUNTIME_PROVIDER === 'python' ? 'python' : 'mastra';
  const agentRuntime =
    provider === 'python'
      ? {
          name: 'python-agent',
          provider,
          url: pythonUrl,
          probeUrl: `${pythonUrl}/health`,
        }
      : {
          name: 'mastra',
          provider,
          url: mastraUrl,
          probeUrl: `${mastraUrl}/api`,
        };

  return {
    frontend: {
      name: 'frontend',
      url: process.env.INTERVIEW_E2E_FRONTEND_URL ?? 'http://localhost:4173',
    },
    bff: {
      name: 'bff',
      url: process.env.INTERVIEW_E2E_BFF_URL ?? 'http://localhost:3000',
    },
    mastra: {
      name: 'mastra',
      url: mastraUrl,
      probeUrl: `${mastraUrl}/api`,
    },
    agentRuntime,
  };
}

export async function assertInterviewE2eEnvironmentReady(
  environment: InterviewE2eEnvironment = resolveInterviewE2eEnvironment(),
): Promise<void> {
  for (const target of [environment.frontend, environment.bff, environment.agentRuntime]) {
    await assertServiceReachable(target);
  }
}

async function assertServiceReachable(target: InterviewE2eServiceTarget): Promise<void> {
  let response: Response;

  try {
    response = await fetch(target.probeUrl ?? target.url, {
      method: 'GET',
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `E2E service ${target.name} is unreachable at ${target.probeUrl ?? target.url}: ${reason}`,
    );
  }

  if (response.status >= 500) {
    throw new Error(
      `E2E service ${target.name} responded with status ${response.status} at ${target.probeUrl ?? target.url}.`,
    );
  }
}

import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  AGENT_RUNTIME_PROVIDER: z.enum(['mastra', 'python']).default('python'),
  MASTRA_BASE_URL: z.string().url().default('http://localhost:4111'),
  PY_AGENT_BASE_URL: z.string().url().default('http://localhost:8011'),
  RESUME_MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),
  DEMO_USERNAME: z.string().default('demo'),
  DEMO_PASSWORD: z.string().default('demo123'),
});

const parsedEnv = envSchema.parse({
  PORT: process.env['PORT'],
  AGENT_RUNTIME_PROVIDER: process.env['AGENT_RUNTIME_PROVIDER'],
  MASTRA_BASE_URL: process.env['MASTRA_BASE_URL'],
  PY_AGENT_BASE_URL: process.env['PY_AGENT_BASE_URL'],
  RESUME_MAX_FILE_SIZE_BYTES: process.env['RESUME_MAX_FILE_SIZE_BYTES'],
  DEMO_USERNAME: process.env['DEMO_USERNAME'],
  DEMO_PASSWORD: process.env['DEMO_PASSWORD'],
});

export const appConfig = {
  port: parsedEnv.PORT,
  agentRuntimeProvider: parsedEnv.AGENT_RUNTIME_PROVIDER,
  mastraBaseUrl: parsedEnv.MASTRA_BASE_URL,
  pyAgentBaseUrl: parsedEnv.PY_AGENT_BASE_URL,
  resumeMaxFileSizeBytes: parsedEnv.RESUME_MAX_FILE_SIZE_BYTES,
  demoUsername: parsedEnv.DEMO_USERNAME,
  demoPassword: parsedEnv.DEMO_PASSWORD,
} as const;

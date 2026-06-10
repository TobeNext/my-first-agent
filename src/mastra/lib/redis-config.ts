import { z } from 'zod';

import { ensureEnvironmentLoaded } from './load-env';

ensureEnvironmentLoaded();

const redisConfigSchema = z.object({
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
});

const parsedRedisConfig = redisConfigSchema.parse({
  REDIS_URL: process.env.REDIS_URL,
});

export const redisConfig = {
  url: parsedRedisConfig.REDIS_URL,
} as const;

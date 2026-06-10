import { createClient, type RedisClientType } from 'redis';

import { redisConfig } from './redis-config';
import {
  RedisAnswerEvaluationStore,
  type EvaluationRedisClient,
} from './redis-evaluation-store';

export class NodeRedisEvaluationClient implements EvaluationRedisClient {
  constructor(private readonly client: RedisClientType) {}

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string): Promise<unknown> {
    return this.client.set(key, value);
  }

  async rPush(key: string, value: string): Promise<unknown> {
    return this.client.rPush(key, value);
  }

  async lPop(key: string): Promise<string | null> {
    return this.client.lPop(key);
  }

  async sAdd(key: string, value: string): Promise<unknown> {
    return this.client.sAdd(key, value);
  }

  async sMembers(key: string): Promise<string[]> {
    return this.client.sMembers(key);
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
  }
}

export async function createRedisEvaluationClient(
  options: { readonly url?: string } = {},
): Promise<NodeRedisEvaluationClient> {
  const client = createClient({
    url: options.url ?? redisConfig.url,
  });

  client.on('error', (error) => {
    console.error('Redis client error:', error);
  });

  await client.connect();

  return new NodeRedisEvaluationClient(client as RedisClientType);
}

export function createRedisAnswerEvaluationStore(
  redisClient: EvaluationRedisClient,
): RedisAnswerEvaluationStore {
  return new RedisAnswerEvaluationStore(redisClient);
}

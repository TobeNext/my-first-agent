import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { ensureEnvironmentLoaded } from './load-env';

ensureEnvironmentLoaded();

const zhipu = createOpenAICompatible({
  name: 'zhipuai',
  baseURL: 'https://open.bigmodel.cn/api/paas/v4',
  apiKey: process.env.ZHIPU_API_KEY,
});

export const glmAirModel = zhipu('glm-4.5-air');
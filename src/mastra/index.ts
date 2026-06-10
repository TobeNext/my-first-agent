
import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { Observability, DefaultExporter, CloudExporter, SensitiveDataFilter } from '@mastra/observability';

import { answerEvaluationAgent } from './agents/answer-evaluation-agent';
import { interviewAgent } from './agents/interview-agent';
import { mastraLogger } from './lib/logger';

export const mastra = new Mastra({
  agents: { interviewAgent, answerEvaluationAgent },
  bundler: {
    sourcemap: true,
    externals: ['@zilliz/milvus2-sdk-node'],
  },
  storage: new LibSQLStore({
    id: 'mastra-storage',
    // stores observability, scores, ... into persistent file storage
    url: 'file:./mastra.db',
  }),
  logger: mastraLogger,
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new DefaultExporter(), // Persists traces to storage for Mastra Studio
          new CloudExporter(), // Sends traces to Mastra Cloud (if MASTRA_CLOUD_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});

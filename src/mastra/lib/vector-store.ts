import { LibSQLVector } from '@mastra/libsql';

import { ensureEnvironmentLoaded } from './load-env';

ensureEnvironmentLoaded();

export const vectorStore = new LibSQLVector({
  id: 'interview-vectors',
  url: process.env.VECTOR_DB_URL || 'file:./interview-vectors.db',
});

export const INTERVIEW_INDEX_NAME = 'interview_questions';
export const EMBEDDING_DIMENSION = 384; // fastembed (all-MiniLM-L6-v2) default dimension

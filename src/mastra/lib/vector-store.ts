import { ensureEnvironmentLoaded } from './load-env';
import { MilvusVectorStore } from './milvus-vector-store';

ensureEnvironmentLoaded();

export const vectorStore = new MilvusVectorStore({
  id: 'interview-vectors',
  address: process.env.MILVUS_ADDRESS || 'localhost:19530',
  username: process.env.MILVUS_USERNAME,
  password: process.env.MILVUS_PASSWORD,
  token: process.env.MILVUS_TOKEN,
  database: process.env.MILVUS_DATABASE,
  ssl: process.env.MILVUS_SSL === 'true',
});

export const INTERVIEW_INDEX_NAME = 'interview_questions';
export const EMBEDDING_DIMENSION = 384; // fastembed (all-MiniLM-L6-v2) default dimension

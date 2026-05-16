import { vectorStore, INTERVIEW_INDEX_NAME, EMBEDDING_DIMENSION } from './vector-store';

export async function initVectorIndex(): Promise<void> {
  const existingIndexes = await vectorStore.listIndexes();
  if (existingIndexes.includes(INTERVIEW_INDEX_NAME)) {
    return;
  }

  await vectorStore.createIndex({
    indexName: INTERVIEW_INDEX_NAME,
    dimension: EMBEDDING_DIMENSION,
  });
}

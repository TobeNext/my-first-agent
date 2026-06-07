import { EMBEDDING_DIMENSION, INTERVIEW_INDEX_NAME, vectorStore } from '../lib/vector-store';
import { ensureEnvironmentLoaded } from '../lib/load-env';
import { buildSkillAreaAudit, cleanInterviewQuestionMetadata } from '../lib/interview-question-metadata';

ensureEnvironmentLoaded();

const BATCH_SIZE = 50;

interface ExistingMilvusRow {
  readonly id: string;
  readonly vector: number[];
  readonly metadata: Record<string, unknown>;
}

async function readExistingRows(): Promise<ExistingMilvusRow[]> {
  const stats = await vectorStore.describeIndex({ indexName: INTERVIEW_INDEX_NAME });
  const rows = await vectorStore.query({
    indexName: INTERVIEW_INDEX_NAME,
    queryVector: undefined,
    topK: Math.max(stats.count, 1),
    includeVector: true,
  });

  return rows.map((row) => ({
    id: row.id,
    vector: row.vector ?? [],
    metadata: row.metadata ?? {},
  }));
}

async function recreateIndex(): Promise<void> {
  await vectorStore.deleteIndex({ indexName: INTERVIEW_INDEX_NAME });
  await vectorStore.createIndex({
    indexName: INTERVIEW_INDEX_NAME,
    dimension: EMBEDDING_DIMENSION,
    metric: 'cosine',
  });
}

async function writeRows(rows: readonly ExistingMilvusRow[]): Promise<void> {
  let written = 0;
  const cleanedRows = rows.map((row) => ({
    ...row,
    metadata: cleanInterviewQuestionMetadata(row.metadata),
  }));

  for (let offset = 0; offset < cleanedRows.length; offset += BATCH_SIZE) {
    const batch = cleanedRows.slice(offset, offset + BATCH_SIZE);
    await vectorStore.upsert({
      indexName: INTERVIEW_INDEX_NAME,
      ids: batch.map((row) => row.id),
      vectors: batch.map((row) => row.vector),
      metadata: batch.map((row) => row.metadata),
    });

    written += batch.length;
    console.log(`  Backfilled ${written}/${cleanedRows.length} vectors`);
  }

  console.log('  Skill area audit:');
  for (const [skill, count] of Object.entries(buildSkillAreaAudit(cleanedRows.map((row) => row.metadata)))) {
    console.log(`    ${skill}: ${count}`);
  }
}

async function main(): Promise<void> {
  console.log('===========================================');
  console.log('  Milvus interview metadata backfill');
  console.log('===========================================');
  console.log(`  Target: ${process.env.MILVUS_ADDRESS || 'localhost:19530'}/${INTERVIEW_INDEX_NAME}`);

  const rows = await readExistingRows();
  if (rows.length === 0) {
    throw new Error(`No vectors found in ${INTERVIEW_INDEX_NAME}.`);
  }

  const missingVector = rows.find((row) => row.vector.length !== EMBEDDING_DIMENSION);
  if (missingVector) {
    throw new Error(`Vector ${missingVector.id} is missing a ${EMBEDDING_DIMENSION}-dimension embedding.`);
  }

  console.log(`  Existing vectors: ${rows.length}`);
  await recreateIndex();
  await writeRows(rows);

  const stats = await vectorStore.describeIndex({ indexName: INTERVIEW_INDEX_NAME });
  console.log(`\nDone! Backfilled ${rows.length} vectors. Milvus now reports ${stats.count} rows.`);
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});

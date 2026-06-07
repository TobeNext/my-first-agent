import { createClient } from '@libsql/client';

import { EMBEDDING_DIMENSION, INTERVIEW_INDEX_NAME, vectorStore } from '../lib/vector-store';
import { ensureEnvironmentLoaded } from '../lib/load-env';
import {
  buildSkillAreaAudit,
  cleanInterviewQuestionMetadata,
  type InterviewQuestionScalarFields,
} from '../lib/interview-question-metadata';

ensureEnvironmentLoaded();

const DEFAULT_SOURCE_DB_URL = 'file:./interview-vectors.db';
const BATCH_SIZE = 50;

interface SourceVectorRow {
  readonly vector_id: string;
  readonly embedding: ArrayBuffer;
  readonly metadata: string;
}

function parseArgs(): { readonly recreate: boolean; readonly sourceUrl: string } {
  const sourceUrlArg = process.argv.find((arg) => arg.startsWith('--source='));

  return {
    recreate: process.argv.includes('--recreate'),
    sourceUrl:
      sourceUrlArg?.slice('--source='.length) ||
      process.env.LIBSQL_VECTOR_DB_URL ||
      process.env.SOURCE_VECTOR_DB_URL ||
      DEFAULT_SOURCE_DB_URL,
  };
}

function decodeF32Blob(blob: ArrayBuffer): number[] {
  if (blob.byteLength !== EMBEDDING_DIMENSION * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error(`Unexpected embedding byte length ${blob.byteLength}; expected ${EMBEDDING_DIMENSION * 4}.`);
  }

  return Array.from(new Float32Array(blob));
}

async function ensureMilvusIndex(recreate: boolean): Promise<void> {
  const indexes = await vectorStore.listIndexes();
  if (indexes.includes(INTERVIEW_INDEX_NAME)) {
    if (!recreate) {
      return;
    }

    await vectorStore.deleteIndex({ indexName: INTERVIEW_INDEX_NAME });
  }

  await vectorStore.createIndex({
    indexName: INTERVIEW_INDEX_NAME,
    dimension: EMBEDDING_DIMENSION,
    metric: 'cosine',
  });
}

async function readSourceRows(sourceUrl: string): Promise<SourceVectorRow[]> {
  const db = createClient({ url: sourceUrl });
  try {
    const result = await db.execute({
      sql: `select vector_id, embedding, metadata from ${INTERVIEW_INDEX_NAME} order by id`,
      args: [],
    });

    return result.rows.map((row) => ({
      vector_id: String(row.vector_id),
      embedding: row.embedding as ArrayBuffer,
      metadata: String(row.metadata ?? '{}'),
    }));
  } finally {
    db.close();
  }
}

async function migrateRows(rows: readonly SourceVectorRow[]): Promise<number> {
  let migrated = 0;
  const migratedScalars: InterviewQuestionScalarFields[] = [];

  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const metadata = batch.map((row) => cleanInterviewQuestionMetadata(JSON.parse(row.metadata) as Record<string, unknown>));
    migratedScalars.push(...metadata);

    await vectorStore.upsert({
      indexName: INTERVIEW_INDEX_NAME,
      ids: batch.map((row) => row.vector_id),
      vectors: batch.map((row) => decodeF32Blob(row.embedding)),
      metadata,
    });

    migrated += batch.length;
    console.log(`  Migrated ${migrated}/${rows.length} vectors`);
  }

  console.log('  Skill area audit:');
  for (const [skill, count] of Object.entries(buildSkillAreaAudit(migratedScalars))) {
    console.log(`    ${skill}: ${count}`);
  }

  return migrated;
}

async function main(): Promise<void> {
  const { recreate, sourceUrl } = parseArgs();

  console.log('===========================================');
  console.log('  LibSQL vectors -> Milvus migration');
  console.log('===========================================');
  console.log(`  Source: ${sourceUrl}`);
  console.log(`  Target: ${process.env.MILVUS_ADDRESS || 'localhost:19530'}/${INTERVIEW_INDEX_NAME}`);
  console.log(`  Recreate target: ${recreate ? 'yes' : 'no'}`);

  await ensureMilvusIndex(recreate);
  const rows = await readSourceRows(sourceUrl);
  if (rows.length === 0) {
    throw new Error(`No vectors found in ${sourceUrl}.`);
  }

  console.log(`  Source vectors: ${rows.length}`);
  const migrated = await migrateRows(rows);
  const stats = await vectorStore.describeIndex({ indexName: INTERVIEW_INDEX_NAME });

  console.log(`\nDone! Migrated ${migrated} vectors. Milvus now reports ${stats.count} rows.`);
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});

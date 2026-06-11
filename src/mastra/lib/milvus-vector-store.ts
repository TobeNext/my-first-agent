import {
  DataType,
  IndexType,
  MetricType,
  MilvusClient,
  type FieldType,
} from '@zilliz/milvus2-sdk-node';
import { MastraVector } from '@mastra/core/vector';
import type {
  CreateIndexParams,
  DeleteIndexParams,
  DeleteVectorParams,
  DeleteVectorsParams,
  DescribeIndexParams,
  IndexStats,
  QueryResult,
  QueryVectorParams,
  UpdateVectorParams,
  UpsertVectorParams,
} from '@mastra/core/vector';

type MilvusMetadataFilter =
  | Record<string, unknown>
  | {
      $and?: MilvusMetadataFilter[];
      $or?: MilvusMetadataFilter[];
    };

export interface MilvusVectorConfig {
  id: string;
  address: string;
  username?: string;
  password?: string;
  token?: string;
  database?: string;
  ssl?: boolean;
}

const VECTOR_FIELD = 'vector';
const METADATA_FIELD = 'metadata';
const ID_FIELD = 'id';
const ROLE_FIELD = 'role';
const DIFFICULTY_FIELD = 'difficulty';
const SKILL_AREA_FIELD = 'skillArea';
const DEFAULT_TOP_K = 10;

function toMilvusMetric(metric?: CreateIndexParams['metric']): MetricType {
  if (metric === 'euclidean') {
    return MetricType.L2;
  }

  if (metric === 'dotproduct') {
    return MetricType.IP;
  }

  return MetricType.COSINE;
}

function fromMilvusMetric(metric?: string): IndexStats['metric'] {
  if (metric === MetricType.L2) {
    return 'euclidean';
  }

  if (metric === MetricType.IP) {
    return 'dotproduct';
  }

  return 'cosine';
}

function quoteString(value: string): string {
  return JSON.stringify(value);
}

function toFilterExpression(filter?: MilvusMetadataFilter): string | undefined {
  if (!filter || Object.keys(filter).length === 0) {
    return undefined;
  }

  const parts = Object.entries(filter).flatMap(([key, value]) => {
    if (key === '$and' && Array.isArray(value)) {
      return [`(${value.map((item) => toFilterExpression(item)).filter(Boolean).join(' AND ')})`];
    }

    if (key === '$or' && Array.isArray(value)) {
      return [`(${value.map((item) => toFilterExpression(item)).filter(Boolean).join(' OR ')})`];
    }

    const field = `${METADATA_FIELD}[${quoteString(key)}]`;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.entries(value as Record<string, unknown>).flatMap(([operator, operand]) => {
        switch (operator) {
          case '$eq':
            return `${field} == ${formatFilterValue(operand)}`;
          case '$ne':
            return `${field} != ${formatFilterValue(operand)}`;
          case '$gt':
            return `${field} > ${formatFilterValue(operand)}`;
          case '$gte':
            return `${field} >= ${formatFilterValue(operand)}`;
          case '$lt':
            return `${field} < ${formatFilterValue(operand)}`;
          case '$lte':
            return `${field} <= ${formatFilterValue(operand)}`;
          case '$in':
            return Array.isArray(operand) ? `${field} IN ${formatFilterValue(operand)}` : [];
          default:
            return [];
        }
      });
    }

    return `${field} == ${formatFilterValue(value)}`;
  });

  return parts.length > 0 ? parts.join(' AND ') : undefined;
}

function formatFilterValue(value: unknown): string {
  if (typeof value === 'string') {
    return quoteString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(formatFilterValue).join(', ')}]`;
  }

  return quoteString(String(value));
}

function ensureMilvusSuccess(result: unknown, action: string): void {
  if (typeof result !== 'object' || result === null) {
    return;
  }

  const status = result as { code?: unknown; error_code?: unknown; reason?: unknown };
  const code = typeof status.code === 'number' ? status.code : undefined;
  const errorCode = typeof status.error_code === 'string' ? status.error_code : undefined;

  if (code === 0 || errorCode === 'Success') {
    return;
  }

  if (code !== undefined || errorCode !== undefined) {
    const reason =
      typeof status.reason === 'string' && status.reason.length > 0 ? status.reason : JSON.stringify(result);
    throw new Error(`Milvus ${action} failed: ${reason}`);
  }
}

function normalizeSearchRows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== 'object' || result === null || !('results' in result)) {
    return [];
  }

  const rows = (result as { results: unknown }).results;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

function normalizeQueryRows(result: unknown): Record<string, unknown>[] {
  if (typeof result !== 'object' || result === null || !('data' in result)) {
    return [];
  }

  const rows = (result as { data: unknown }).data;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeStringArray(value: unknown, fallback: readonly string[] = ['agent']): string[] {
  const source = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，\s]+/u) : [];
  const normalized = source
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  return normalized.length > 0 ? [...new Set(normalized)] : [...fallback];
}

function extractScalarFields(metadata: Record<string, unknown>): {
  readonly role: string;
  readonly difficulty: string;
  readonly skillArea: string[];
  readonly metadata: Record<string, unknown>;
} {
  const { role, difficulty, skillArea, ...jsonMetadata } = metadata;

  return {
    role: normalizeString(role, 'general'),
    difficulty: normalizeString(difficulty, 'medium'),
    skillArea: normalizeStringArray(skillArea),
    metadata: jsonMetadata,
  };
}

function mergeScalarFields(row: Record<string, unknown>): Record<string, unknown> {
  const metadata = (row[METADATA_FIELD] as Record<string, unknown>) ?? {};

  return {
    ...metadata,
    role: normalizeString(row[ROLE_FIELD], normalizeString(metadata.role, 'general')),
    difficulty: normalizeString(row[DIFFICULTY_FIELD], normalizeString(metadata.difficulty, 'medium')),
    skillArea: normalizeStringArray(row[SKILL_AREA_FIELD], normalizeStringArray(metadata.skillArea)),
  };
}

export class MilvusVectorStore extends MastraVector<MilvusMetadataFilter> {
  private client: MilvusClient | null = null;
  private readonly config: Omit<MilvusVectorConfig, 'id'>;
  private readonly collectionMetrics = new Map<string, IndexStats['metric']>();
  private readonly collectionFields = new Map<string, Set<string>>();

  constructor({ id, ...config }: MilvusVectorConfig) {
    super({ id });
    this.config = config;
  }

  private getClient(): MilvusClient {
    this.client ??= new MilvusClient(this.config);
    return this.client;
  }

  async createIndex({ indexName, dimension, metric }: CreateIndexParams): Promise<void> {
    const client = this.getClient();

    await client.connectPromise;
    const exists = await client.hasCollection({ collection_name: indexName });
    if ('value' in exists && exists.value) {
      this.collectionMetrics.set(indexName, metric ?? 'cosine');
      await this.cacheCollectionFields(indexName);
      return;
    }

    const fields: FieldType[] = [
      { name: ID_FIELD, data_type: DataType.VarChar, is_primary_key: true, max_length: 128 },
      { name: VECTOR_FIELD, data_type: DataType.FloatVector, dim: dimension },
      { name: ROLE_FIELD, data_type: DataType.VarChar, max_length: 128 },
      { name: DIFFICULTY_FIELD, data_type: DataType.VarChar, max_length: 32 },
      {
        name: SKILL_AREA_FIELD,
        data_type: DataType.Array,
        element_type: DataType.VarChar,
        max_capacity: 32,
        max_length: 64,
      },
      { name: METADATA_FIELD, data_type: DataType.JSON },
    ];

    ensureMilvusSuccess(
      await client.createCollection({
        collection_name: indexName,
        fields,
        index_params: [
          {
            field_name: VECTOR_FIELD,
            index_type: IndexType.HNSW,
            metric_type: toMilvusMetric(metric),
            params: { M: 16, efConstruction: 256 },
          },
        ],
      }),
      'createCollection',
    );
    ensureMilvusSuccess(await client.loadCollection({ collection_name: indexName }), 'loadCollection');
    this.collectionMetrics.set(indexName, metric ?? 'cosine');
    this.collectionFields.set(indexName, new Set(fields.map((field) => field.name)));
  }

  private async cacheCollectionFields(indexName: string): Promise<Set<string>> {
    const cached = this.collectionFields.get(indexName);
    if (cached) {
      return cached;
    }

    const collection = await this.getClient().describeCollection({ collection_name: indexName });
    const fields = 'schema' in collection ? collection.schema.fields : [];
    const fieldNames = new Set(fields.map((field) => field.name));
    this.collectionFields.set(indexName, fieldNames);

    return fieldNames;
  }

  private async buildOutputFields(indexName: string, includeVector: boolean): Promise<string[]> {
    const fieldNames = await this.cacheCollectionFields(indexName);
    const preferredFields = [ID_FIELD, ROLE_FIELD, DIFFICULTY_FIELD, SKILL_AREA_FIELD, METADATA_FIELD];
    const outputFields = preferredFields.filter((field) => fieldNames.has(field));

    if (includeVector && fieldNames.has(VECTOR_FIELD)) {
      outputFields.push(VECTOR_FIELD);
    }

    return outputFields;
  }

  async listIndexes(): Promise<string[]> {
    const client = this.getClient();

    await client.connectPromise;
    const result = await client.showCollections();
    const data = 'data' in result ? result.data : [];

    return Array.isArray(data) ? data.map((collection) => String(collection.name)) : [];
  }

  async describeIndex({ indexName }: DescribeIndexParams): Promise<IndexStats> {
    const client = this.getClient();

    await client.connectPromise;
    const [collection, count] = await Promise.all([
      client.describeCollection({ collection_name: indexName }),
      client.count({ collection_name: indexName }),
    ]);
    const fields = 'schema' in collection ? collection.schema.fields : [];
    const vectorField = fields.find((field) => field.name === VECTOR_FIELD);

    return {
      dimension: Number(vectorField?.type_params?.dim ?? 0),
      count: 'data' in count ? Number(count.data) : 0,
      metric: this.collectionMetrics.get(indexName) ?? fromMilvusMetric(undefined),
    };
  }

  async upsert({ indexName, vectors, metadata = [], ids, deleteFilter }: UpsertVectorParams<MilvusMetadataFilter>): Promise<string[]> {
    const client = this.getClient();

    await client.connectPromise;

    if (deleteFilter) {
      await this.deleteVectors({ indexName, filter: deleteFilter });
    }

    const vectorIds = ids ?? vectors.map(() => crypto.randomUUID());
    const data = vectors.map((vector, index) => {
      const scalarFields = extractScalarFields(metadata[index] ?? {});

      return {
        [ID_FIELD]: vectorIds[index],
        [VECTOR_FIELD]: vector,
        [ROLE_FIELD]: scalarFields.role,
        [DIFFICULTY_FIELD]: scalarFields.difficulty,
        [SKILL_AREA_FIELD]: scalarFields.skillArea,
        [METADATA_FIELD]: scalarFields.metadata,
      };
    });

    if (data.length === 0) {
      return [];
    }

    ensureMilvusSuccess(await client.upsert({ collection_name: indexName, data }), 'upsert');
    ensureMilvusSuccess(await client.flushSync({ collection_names: [indexName] }), 'flushSync');
    ensureMilvusSuccess(await client.loadCollection({ collection_name: indexName }), 'loadCollection');

    return vectorIds;
  }

  async query({
    indexName,
    queryVector,
    topK = DEFAULT_TOP_K,
    filter,
    includeVector = false,
  }: QueryVectorParams<MilvusMetadataFilter>): Promise<QueryResult[]> {
    const client = this.getClient();

    await client.connectPromise;
    const outputFields = await this.buildOutputFields(indexName, includeVector);
    const filterExpression = toFilterExpression(filter);

    if (!queryVector) {
      const result = await client.query({
        collection_name: indexName,
        filter: filterExpression ?? `${ID_FIELD} != ""`,
        output_fields: outputFields,
        limit: topK,
      });

      return normalizeQueryRows(result).map((row) => ({
        id: String(row[ID_FIELD]),
        score: 1,
        metadata: mergeScalarFields(row),
        vector: includeVector ? (row[VECTOR_FIELD] as number[]) : undefined,
      }));
    }

    const result = await client.search({
      collection_name: indexName,
      data: [queryVector],
      anns_field: VECTOR_FIELD,
      limit: topK,
      filter: filterExpression,
      output_fields: outputFields,
      metric_type: MetricType.COSINE,
      params: { ef: Math.max(topK, 64) },
    });

    return normalizeSearchRows(result).map((row) => ({
      id: String(row[ID_FIELD] ?? row.id),
      score: Number(row.score ?? row.distance ?? 0),
      metadata: mergeScalarFields(row),
      vector: includeVector ? (row[VECTOR_FIELD] as number[]) : undefined,
    }));
  }

  async updateVector({ indexName, id, filter, update }: UpdateVectorParams<MilvusMetadataFilter>): Promise<void> {
    if (!id && !filter) {
      throw new Error('MilvusVectorStore.updateVector requires id or filter.');
    }

    const rows = id
      ? [{ id }]
      : normalizeQueryRows(
          await this.getClient().query({
            collection_name: indexName,
            filter: toFilterExpression(filter) ?? `${ID_FIELD} != ""`,
            output_fields: await this.buildOutputFields(indexName, true),
          }),
        );
    const data = rows.map((row) => {
      const mergedMetadata = update.metadata ?? mergeScalarFields(row);
      const scalarFields = extractScalarFields(mergedMetadata);

      return {
        [ID_FIELD]: String(row.id),
        [VECTOR_FIELD]: update.vector ?? row[VECTOR_FIELD],
        [ROLE_FIELD]: scalarFields.role,
        [DIFFICULTY_FIELD]: scalarFields.difficulty,
        [SKILL_AREA_FIELD]: scalarFields.skillArea,
        [METADATA_FIELD]: scalarFields.metadata,
      };
    });

    if (data.length > 0) {
      ensureMilvusSuccess(await this.getClient().upsert({ collection_name: indexName, data }), 'updateVector');
    }
  }

  async deleteVector({ indexName, id }: DeleteVectorParams): Promise<void> {
    ensureMilvusSuccess(await this.getClient().delete({ collection_name: indexName, ids: [id] }), 'deleteVector');
  }

  async deleteVectors({ indexName, ids, filter }: DeleteVectorsParams<MilvusMetadataFilter>): Promise<void> {
    if (ids?.length) {
      ensureMilvusSuccess(await this.getClient().delete({ collection_name: indexName, ids }), 'deleteVectors');
      return;
    }

    const filterExpression = toFilterExpression(filter);
    if (!filterExpression) {
      throw new Error('MilvusVectorStore.deleteVectors requires ids or filter.');
    }

    ensureMilvusSuccess(await this.getClient().delete({ collection_name: indexName, filter: filterExpression }), 'deleteVectors');
  }

  async deleteIndex({ indexName }: DeleteIndexParams): Promise<void> {
    const client = this.getClient();

    await client.connectPromise;
    const exists = await client.hasCollection({ collection_name: indexName });
    if ('value' in exists && !exists.value) {
      return;
    }

    ensureMilvusSuccess(await client.dropCollection({ collection_name: indexName }), 'dropCollection');
    this.collectionMetrics.delete(indexName);
    this.collectionFields.delete(indexName);
  }

  async truncateIndex({ indexName }: DeleteIndexParams): Promise<void> {
    ensureMilvusSuccess(await this.getClient().truncateCollection({ collection_name: indexName }), 'truncateCollection');
  }
}

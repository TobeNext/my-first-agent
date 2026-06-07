export interface InterviewQuestionMetadata {
  readonly question: string;
  readonly answer: string;
  readonly questionType: string;
  readonly source: string;
  readonly sourceFile?: string;
  readonly text?: string;
}

export interface InterviewQuestionScalarFields {
  readonly role: string;
  readonly difficulty: string;
  readonly skillArea: readonly string[];
}

export interface InterviewQuestionVectorRecord extends InterviewQuestionScalarFields {
  readonly id: string;
  readonly vector: readonly number[];
  readonly metadata: InterviewQuestionMetadata;
}

export interface SkillAreaRule {
  readonly pattern: RegExp;
  readonly skill: string;
}

export const DEFAULT_SKILL_AREA = 'agent';

export const SKILL_AREA_RULES: readonly SkillAreaRule[] = [
  { pattern: /Java|后端|JVM/i, skill: 'java' },
  { pattern: /Spring(?:\s+Boot|\s+Cloud)?/i, skill: 'spring' },
  { pattern: /TypeScript|\bTS\b|Node(?:\.js)?|NestJS/i, skill: 'typescript' },
  { pattern: /Vue|前端/i, skill: 'vue' },
  { pattern: /Mastra/i, skill: 'mastra' },
  { pattern: /LangChain/i, skill: 'langchain' },
  { pattern: /CrewAI/i, skill: 'crewai' },
  { pattern: /RAG|检索|召回|向量/i, skill: 'rag' },
  { pattern: /Milvus|向量数据库|vector database/i, skill: 'milvus' },
  { pattern: /BM25|rerank|重排/i, skill: 'bm25' },
  { pattern: /Memory|记忆|上下文/i, skill: 'memory' },
  { pattern: /Tool|Function Call|MCP|工具调用/i, skill: 'tool-calling' },
  { pattern: /Multi-Agent|多\s*Agent|多智能体/i, skill: 'multi-agent' },
  { pattern: /Workflow|工作流/i, skill: 'workflow' },
  { pattern: /路由|fallback|成本|小模型|大模型/i, skill: 'model-routing' },
  { pattern: /Docker|Kubernetes|K8s/i, skill: 'docker' },
  { pattern: /微服务|API Gateway|网关/i, skill: 'microservices' },
  { pattern: /观测|日志|trace|监控/i, skill: 'observability' },
];

const REMOVED_METADATA_KEYS = new Set(['mainCategory', 'subCategory', 'company', 'tags']);

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeSkillToken(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSkillAreaValues(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeSkillToken(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function normalizeSkillAreaFromText(text: string): string[] {
  const matches = SKILL_AREA_RULES.flatMap((rule) => (rule.pattern.test(text) ? [rule.skill] : []));
  const normalized = normalizeSkillAreaValues(matches);

  return normalized.length > 0 ? normalized : [DEFAULT_SKILL_AREA];
}

export function normalizeSkillAreaFromMetadata(metadata: Record<string, unknown>): string[] {
  const explicitSkillArea = Array.isArray(metadata.skillArea)
    ? normalizeSkillAreaValues(metadata.skillArea)
    : normalizeSkillAreaValues(String(metadata.skillArea ?? '').split(/[,，\s]+/u));

  if (explicitSkillArea.length > 0) {
    return explicitSkillArea;
  }

  const backfillText = [
    metadata.question,
    metadata.answer,
    metadata.text,
    metadata.mainCategory,
    metadata.subCategory,
    Array.isArray(metadata.tags) ? metadata.tags.join('\n') : metadata.tags,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n');

  return normalizeSkillAreaFromText(backfillText);
}

export function cleanInterviewQuestionMetadata(
  metadata: Record<string, unknown>,
): InterviewQuestionMetadata & InterviewQuestionScalarFields {
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (REMOVED_METADATA_KEYS.has(key) || key === 'role' || key === 'difficulty' || key === 'skillArea') {
      continue;
    }

    cleaned[key] = value;
  }

  return {
    question: normalizeString(cleaned.question, normalizeString(cleaned.text)),
    answer: normalizeString(cleaned.answer),
    questionType: normalizeString(cleaned.questionType, 'knowledge-check'),
    source: normalizeString(cleaned.source, 'interview-question-bank'),
    sourceFile: normalizeString(cleaned.sourceFile) || undefined,
    text: normalizeString(cleaned.text) || undefined,
    role: normalizeString(metadata.role, 'general'),
    difficulty: normalizeString(metadata.difficulty, 'medium'),
    skillArea: normalizeSkillAreaFromMetadata(metadata),
  };
}

export function buildSkillAreaAudit(
  records: readonly { readonly skillArea: readonly string[] }[],
): Record<string, number> {
  const audit: Record<string, number> = {};

  for (const record of records) {
    for (const skill of record.skillArea) {
      audit[skill] = (audit[skill] ?? 0) + 1;
    }
  }

  return Object.fromEntries(Object.entries(audit).sort(([left], [right]) => left.localeCompare(right)));
}

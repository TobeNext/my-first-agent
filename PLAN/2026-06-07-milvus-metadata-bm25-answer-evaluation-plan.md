# Milvus Metadata, BM25 Rerank, And Answer Evaluation Plan

## Background

当前 `interview_questions` 向量库已经迁移到 Milvus。现有 metadata 仍沿用旧 LibSQL 导入结构，包含 `mainCategory`、`subCategory`、`company`、`tags` 等字段。后续目标是让检索链路更贴近真实面试流程：

1. 通过用户简历生成 query，向量召回 Top 20 问题。
2. 根据用户输入的 JD 做 BM25 rerank，但 rerank 只匹配题目涉及的 `skillArea`。
3. 每个问题保留 `answer` 回答要点，用于后续模型评判用户回答。
4. 将高价值字段提升为 Milvus scalar 字段，减少对 JSON metadata 的过度依赖。

## Goals

- 删除当前 metadata 中低价值或重复字段：`mainCategory`、`subCategory`、`company`、`tags`。
- 新增 `skillArea: string[]`，记录当前问题涉及的技能点，例如 `["java", "spring", "microservices"]`。
- BM25 rerank 阶段只基于 `skillArea` 与 JD 抽取出的技能信号匹配。
- 将 `skillArea`、`role`、`difficulty` 从 JSON metadata 提升为 Milvus scalar 字段。
- 设计 `answer` 参与用户回答评分链路的方案，先明确数据流、状态模型和 prompt contract，再进入代码实现。

## Non-Goals

- 本计划不立即实现完整代码。
- 本计划不重建整套题库内容来源。
- 本计划不改变 embedding 模型。
- 本计划不引入新的外部 BM25 服务；优先在当前 TypeScript 链路内完成 rerank。

## Current Field Assessment

### Keep

- `question`: 面试问题正文，必须保留。
- `answer`: 回答要点，必须保留，后续进入评分链路。
- `role`: 岗位维度，保留并提升为 Milvus scalar 字段。
- `difficulty`: 难度控制字段，保留并提升为 Milvus scalar 字段。
- `source`: 数据来源，保留在 JSON metadata 中，用于调试和溯源。
- `sourceFile`: 短期保留用于回溯；后续可替换为 `sourceDocId`。
- `text`: 短期保留为 embedding 原文 fallback；后续可重命名为 `embeddingText`。

### Remove Or Replace

- `mainCategory`: 删除。原本用于人工分类和 BM25 拼接，后续由 `skillArea` 替代。
- `subCategory`: 删除。原本用于人工分类和 BM25 拼接，后续由 `skillArea` 替代。
- `company`: 删除。当前全量为 `general`，没有 rerank 区分度。
- `tags`: 删除。当前混合了分类标题与关键词，语义不稳定，后续由 `skillArea` 替代。

### Add

- `skillArea: string[]`: 核心新增字段，记录题目涉及的技能点。

建议标准：

```ts
type SkillArea =
  | 'java'
  | 'spring'
  | 'typescript'
  | 'nestjs'
  | 'vue'
  | 'mastra'
  | 'langchain'
  | 'crewai'
  | 'rag'
  | 'milvus'
  | 'vector-database'
  | 'bm25'
  | 'agent'
  | 'workflow'
  | 'memory'
  | 'tool-calling'
  | 'mcp'
  | 'multi-agent'
  | 'model-routing'
  | 'observability'
  | 'docker'
  | 'kubernetes'
  | 'microservices';
```

实际实现时不要把 union 写死成唯一来源，可以先维护一个可扩展的归一化词典。

## Phase 1: Define Metadata Contract

### Tasks

- 定义新的题库 metadata contract。
- 明确 JSON metadata 与 Milvus scalar 字段边界。
- 更新导入脚本中生成 metadata 的逻辑。

### Proposed Shape

Milvus scalar fields:

```ts
{
  id: string;
  vector: FloatVector;
  role: string;
  difficulty: string;
  skillArea: string[];
  metadata: {
    question: string;
    answer: string;
    questionType: string;
    source: string;
    sourceFile?: string;
    text?: string;
  };
}
```

说明：

- `role`、`difficulty`、`skillArea` 作为 scalar 字段，方便过滤和 rerank 前置读取。
- `question`、`answer` 继续放在 metadata 中，避免 scalar schema 膨胀。
- `questionType` 暂时保留在 metadata 中；如果后续需要按题型配额，也可以提升为 scalar。

### Acceptance Criteria

- 有单一 TypeScript 类型描述新 metadata contract。
- 新导入数据不再包含 `mainCategory`、`subCategory`、`company`、`tags`。
- `skillArea` 在每条题目中至少有 1 个值。

## Phase 2: Build SkillArea Normalization And Backfill

### Tasks

- 为当前 125 条题目生成 `skillArea`。
- 建立关键词到标准 skillArea 的映射。
- 支持中英文混合关键词归一化。
- 写一次性 backfill 脚本，将当前 Milvus 数据重写为新结构。

### Suggested Mapping Strategy

先用规则映射覆盖当前题库：

```ts
const skillAreaRules = [
  { pattern: /Java|后端|JVM/i, skill: 'java' },
  { pattern: /Spring|Spring Boot|Spring Cloud/i, skill: 'spring' },
  { pattern: /TypeScript|TS|Node|NestJS/i, skill: 'typescript' },
  { pattern: /Vue|前端/i, skill: 'vue' },
  { pattern: /Mastra/i, skill: 'mastra' },
  { pattern: /LangChain/i, skill: 'langchain' },
  { pattern: /CrewAI/i, skill: 'crewai' },
  { pattern: /RAG|检索|召回|向量/i, skill: 'rag' },
  { pattern: /Milvus|向量数据库|vector database/i, skill: 'milvus' },
  { pattern: /BM25|rerank|重排/i, skill: 'bm25' },
  { pattern: /Memory|记忆|上下文/i, skill: 'memory' },
  { pattern: /Tool|Function Call|MCP|工具调用/i, skill: 'tool-calling' },
  { pattern: /Multi-Agent|多 Agent|多智能体/i, skill: 'multi-agent' },
  { pattern: /Workflow|工作流/i, skill: 'workflow' },
  { pattern: /路由|fallback|成本|小模型|大模型/i, skill: 'model-routing' },
  { pattern: /Docker|Kubernetes|K8s/i, skill: 'docker' },
  { pattern: /微服务|API Gateway|网关/i, skill: 'microservices' },
  { pattern: /观测|日志|trace|监控/i, skill: 'observability' },
];
```

匹配输入建议使用：

```ts
[
  question,
  answer,
  text,
].join('\n')
```

不再使用旧 `mainCategory`、`subCategory`、`tags` 作为长期数据来源，但 backfill 时可以临时参考它们提高覆盖率。

### Acceptance Criteria

- 当前 125 条题目均有 `skillArea`。
- 生成结果输出审计报告：每个 skillArea 覆盖多少题。
- 没有题目只得到过宽泛的 `agent`，除非确实无法细分。

## Phase 3: Promote Fields To Milvus Scalar Schema

### Tasks

- 修改 `MilvusVectorStore.createIndex` schema。
- 增加 scalar fields：`role`、`difficulty`、`skillArea`。
- 修改 `upsert`，将这些字段从 metadata 中抽出写入顶层字段。
- 修改 `query/search` 输出，将 scalar 字段合并回返回结果，保持上层调用兼容。
- 重建 Milvus collection 并重新导入数据。

### Milvus Schema Direction

建议 schema：

```ts
fields: [
  { name: 'id', data_type: DataType.VarChar, is_primary_key: true, max_length: 128 },
  { name: 'vector', data_type: DataType.FloatVector, dim: 384 },
  { name: 'role', data_type: DataType.VarChar, max_length: 128 },
  { name: 'difficulty', data_type: DataType.VarChar, max_length: 32 },
  {
    name: 'skillArea',
    data_type: DataType.Array,
    element_type: DataType.VarChar,
    max_capacity: 32,
    max_length: 64,
  },
  { name: 'metadata', data_type: DataType.JSON },
]
```

注意事项：

- 需要验证当前 `@zilliz/milvus2-sdk-node` 对 VarChar array 的字段参数格式。
- 如果 Array 字段创建存在 SDK/服务端兼容问题，fallback 是将 `skillArea` 以 JSON metadata 保留，同时新增 `skillAreaText` scalar string。

### Acceptance Criteria

- Milvus collection schema 中存在 `role`、`difficulty`、`skillArea`。
- `vectorStore.query()` 返回结果仍兼容现有 `InterviewQuestionCandidate`。
- `npm run build` 通过。

## Phase 4: Change BM25 Rerank To SkillArea-Only

### Current Behavior

当前 `interview-question-tool.ts` 的 BM25 文档文本包含：

```ts
question + answer + text + role + company + mainCategory + subCategory + tags
```

这会让长答案、旧分类标题和泛化标签影响 rerank。

### Target Behavior

JD rerank 只比较：

```ts
JD extracted skill signals <-> candidate.skillArea
```

建议流程：

1. 从 JD 中抽取技能关键词。
2. 归一化成同一套 `skillArea` vocabulary。
3. 对向量召回 Top 20 的候选题，计算 `skillArea` overlap BM25 或 weighted overlap。
4. 与 vector score 组合得到最终 hybrid score。

### Proposed Rerank Formula

```ts
hybridScore =
  normalizedVectorScore * 0.55 +
  normalizedSkillAreaScore * 0.45;
```

其中 `skillAreaScore` 可以先用简单可解释版本：

```ts
skillAreaScore =
  matchedSkillCount / Math.max(jdSkillArea.length, 1)
```

如果后续需要更像 BM25，再对 skill token 做 IDF：

```ts
score += idf(skill) * matchBoost;
```

### Acceptance Criteria

- `buildDocumentText()` 不再使用 `answer`、`text`、`mainCategory`、`subCategory`、`company`、`tags` 做 BM25 文档。
- rerank 输入变成 `jdSkillArea` 与 `candidate.skillArea`。
- RAG trace 中记录每个候选的 matched skillArea，方便调试。

## Phase 5: Answer Enters Evaluation Chain Design

### Problem

当前 `answer` 已经存在于向量 metadata，但召回结果最终只进入：

```ts
InterviewQuestionCandidate {
  id;
  text;
  score;
  role;
  company;
  questionType;
  difficulty;
  tags;
}
```

也就是说，`answer` 没有进入状态机节点，也没有进入回答评分 prompt。当前评分更多是规则和上下文启发式，而不是基于标准回答要点评判。

### Design Goal

让每个主问题节点携带参考答案：

```ts
{
  mainQuestion: string;
  referenceAnswer: string;
  evaluationPoints: string[];
}
```

后续用户回答时，评分逻辑使用：

```text
Question:
{mainQuestion}

Reference answer points:
{referenceAnswer}

Candidate answer:
{userAnswer}

Evaluate relevance, accuracy, depth, specificity, clarity.
Return strengths, missingPoints, incorrectPoints.
```

### Proposed Data Flow

1. `interview-question-tool.ts` 返回候选题时增加 `answer`。
2. `interviewQuestionCandidateSchema` 增加：

```ts
answer: z.string().optional()
```

3. 初始化 pipeline 选择问题后，把 `answer` 写入 generation trace 或 node 初始化输入。
4. `interviewTopicNodeStateSchema` 增加：

```ts
referenceAnswer: z.string().optional()
evaluationPoints: z.array(z.string()).optional()
```

5. `interview-state-manager-tool.ts` 在分析用户回答时，将 reference answer 传入 evaluation prompt。
6. 初期保持 fallback：如果旧节点没有 `referenceAnswer`，沿用当前规则评分。

### Evaluation Prompt Contract

建议模型返回结构：

```ts
{
  classification: 'direct-answer' | 'partial-answer' | 'deep-answer' | 'off-topic',
  score: {
    relevance: number,
    accuracy: number,
    depth: number,
    specificity: number,
    clarity: number
  },
  strengths: string[],
  missingPoints: string[],
  incorrectPoints: string[],
  shouldAskFollowUp: boolean,
  followUpFocus: string[]
}
```

### Safety And UX Rules

- 不向候选人展示完整 `answer`。
- 面试过程中不泄露标准答案。
- 最终报告中可以用 `missingPoints` 和 `improvementAdvice` 总结，不直接 dump reference answer。
- 如果 model evaluation 失败，回退到现有 heuristic scoring。

### Acceptance Criteria

- 被选中的每个主问题节点都保存 `referenceAnswer`。
- 用户回答评分能引用 `referenceAnswer`。
- `missingPoints` 能反映标准回答要点中未覆盖的内容。
- 旧会话恢复不因 schema 增加字段而失败。

## Phase 6: Tests And Verification

### Unit Tests

- skillArea 归一化规则测试。
- metadata 清理和新 schema 生成测试。
- JD skill extraction 到 rerank 输入测试。
- skillArea-only rerank 排序测试。
- answer evaluation prompt 构造测试。

### Integration Checks

- 从 markdown 导入题库后，每条记录有 `skillArea`。
- Milvus schema 包含 scalar 字段。
- 查询 Top 20 后 rerank trace 中包含 matched skill areas。
- 初始化面试后 working memory 节点中包含 `referenceAnswer`。

### Manual Smoke

1. 启动 Milvus：

```bash
docker compose up -d milvus
```

2. 重建题库：

```bash
npm run migrate:vectors:milvus
```

或后续新增专用命令：

```bash
npm run import:interview-questions:milvus
```

3. 构建：

```bash
npm run build
```

4. 使用一份包含 Java、Spring、微服务的 JD 验证 rerank 是否优先召回对应 skillArea 的问题。

## Implementation Order

1. 新增 metadata contract 和 skillArea 归一化 helper。
2. 修改导入脚本，生成新 metadata。
3. 写 backfill/重建脚本，给当前 125 条数据补 `skillArea`。
4. 修改 Milvus schema，提升 `skillArea`、`role`、`difficulty` 为 scalar。
5. 修改 query/upsert 兼容 scalar 字段。
6. 修改 BM25 rerank，只基于 `skillArea`。
7. 设计并实现 `answer` 进入候选题和状态机节点。
8. 设计并实现 model-based answer evaluation。
9. 补测试和 smoke 验证。

## Risks

- Milvus Array scalar 字段在当前 SDK 或服务端版本中参数要求可能和预期不同，需要先做最小 schema spike。
- 当前 125 条题目通过规则生成 `skillArea` 可能有误标，需要输出审计报告人工检查。
- 只用 `skillArea` 做 rerank 可能过窄，JD 没抽取出技能时需要 fallback 到 vector score。
- `answer` 进入评分链路后，模型可能过度按标准答案逐字匹配，需要 prompt 强调“等价表达也算覆盖”。
- working memory schema 变更可能影响旧会话恢复，需要 optional 字段和版本兼容。

## Open Questions

- `questionType` 是否也应该提升为 Milvus scalar 字段，用于题型配额？
- `skillArea` vocabulary 是否需要维护成配置文件，方便后续人工扩展？
- JD skill extraction 是继续用规则，还是引入模型结构化抽取？
- 最终报告中是否允许展示“参考答案要点”，还是只展示基于回答表现生成的改进建议？

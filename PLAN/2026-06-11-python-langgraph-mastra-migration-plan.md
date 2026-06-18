# Python + LangGraph/LangChain 重构 Mastra Agent 后台迁移方案

日期：2026-06-11

## 1. 迁移目标

把当前 `src/mastra/**` 中的 Mastra TypeScript runtime 逐步迁移为 Python 后台，优先采用 **LangGraph 作为状态编排内核**，LangChain 作为模型调用、工具封装、结构化输出和 RAG 组件层。

迁移实施时不在当前 repo 里新增长期承载目录，而是 **新建一个独立 LangGraph repo** 作为 Python agent runtime 的源代码、依赖锁、测试、Dockerfile 和 skills 承载物。当前 repo 只保留前端、BFF、现有 Mastra runtime、切流配置和迁移计划。

迁移完成后，系统应保持现有产品能力不倒退：

- 前端 `frontend/` 与 BFF `bff/` 的现有用户体验、`threadId` 会话语义、SSE 流式聊天接口保持兼容。
- 面试初始化链路继续支持结构化 startup payload：简历 Markdown、可选 JD、系统设置、标准化 resumeSections。
- 专业技能轮、项目经历轮、追问、跳题、flow-test mode、最终报告、用户反馈回写保持现有行为。
- Milvus 题库召回、Redis 异步答题评分、outcome artifact、RAG recall sample 继续可用。
- 迁移过程允许 TypeScript Mastra runtime 与 Python runtime 并行存在，通过 BFF 配置逐步切流。

## 2. 结论先行

迁移必须采用 **LangGraph-first**，而不是只用 LangChain AgentExecutor 重写。LangGraph 是新 runtime 的主承载框架；LangChain 只作为模型、工具、structured output、retriever 和 provider integration 的底层能力。

原因：

- 当前核心不是“模型自主调用工具”，而是显式状态机驱动的面试流程；LangGraph 更适合表达有状态、多节点、可恢复、可中断的流程。
- 当前 `interviewStateManagerTool` 已经把 LLM 降级为局部生成/评分能力，真正的主流程由 reducer、schema、Redis、Milvus 和 outcome writer 决定；这天然对应 LangGraph 的 graph state + node + checkpoint 模型。
- LangChain 仍然有价值，但应作为底层能力：ChatModel、structured output、tool/function calling、retriever、prompt、output parser。

目标形态：

```text
frontend Vue
  -> bff NestJS /api/agents/chat/stream
    -> new LangGraph runtime repo /api/agents/interview-agent/stream
      -> LangGraph interview graph
        -> state persistence/checkpoint
        -> RAG retrieval from Milvus
        -> local deterministic state reducers
        -> LangChain model calls for follow-up/evaluation/question rewrite
        -> Redis async answer-evaluation queue
        -> outcome artifacts
```

执行层面按“最小可验证单元”推进。详细任务拆分见同目录文档：

- `PLAN/2026-06-11-langgraph-migration-minimal-verifiable-units-plan.md`

## 3. 当前 Mastra 后台资产盘点

### 3.1 对外运行入口

- `src/mastra/index.ts`
  - 注册 `interviewAgent` 和 `answerEvaluationAgent`
  - 配置 LibSQLStore、observability、logger
  - Mastra API 当前由 `mastra dev/start` 暴露，BFF 调用 `/api/agents/interview-agent/stream`

### 3.2 主面试 Agent

- `src/mastra/agents/interview-agent.ts`
  - prompt 要求模型只调用 `interviewStateManagerTool`
  - 使用 `ReadOnlyThreadMemory`
  - 注册 `interviewStateManagerTool` 和 `waitAndReadInterviewEvaluationsTool`

迁移判断：这个 Mastra Agent 层应被 **Python FastAPI SSE endpoint + LangGraph invoke/stream** 替代。prompt 中的“必须调用工具”约束可以消失，因为 Python endpoint 可以直接调用 graph。

### 3.3 答题评分 Agent

- `src/mastra/agents/answer-evaluation-agent.ts`
- `src/mastra/lib/answer-evaluation-runner.ts`
- `src/mastra/scripts/run-answer-evaluation-worker.ts`

迁移判断：保留 Redis 任务模型，Python 新增独立 worker。评分调用用 LangChain ChatModel + structured output 复刻 `rawAnswerEvaluationOutputSchema`。

### 3.4 状态机和主流程

- `src/mastra/tools/interview-state-manager-tool.ts`
- `src/mastra/lib/interview-state-machine.ts`
- `src/mastra/lib/interview-state-machine-schema.ts`
- `src/mastra/lib/interview-initialization-pipeline.ts`
- `src/mastra/lib/interview-kickoff-recovery.ts`

迁移判断：这是优先级最高的迁移核心。应先把 schema 和 reducer 迁移为 Python `pydantic` model + pure function，再把初始化、处理回答、wrap-up 写成 LangGraph node。

### 3.5 RAG 与向量检索

- `src/mastra/tools/interview-question-tool.ts`
- `src/mastra/lib/interview-question-retriever.ts`
- `src/mastra/lib/professional-question-query.ts`
- `src/mastra/lib/project-question-query.ts`
- `src/mastra/lib/interview-question-metadata.ts`
- `src/mastra/lib/milvus-vector-store.ts`
- `src/mastra/lib/vector-store.ts`
- `src/mastra/lib/rag-pipeline.ts`

迁移判断：Milvus collection 和 metadata contract 应保持不变。Python 侧用 `pymilvus` 或 LangChain Milvus vector store 接入，但必须兼容现有字段：`id`、`vector`、`metadata`、`role`、`difficulty`、`skillArea`。

### 3.6 BFF/前端契约

- BFF：`bff/src/modules/agent/agent.service.ts`
  - 仍代理 `/api/agents/chat/stream`
  - 当前上游地址为 `${MASTRA_BASE_URL}/api/agents/interview-agent/stream`
  - 请求体使用 Mastra stream body：`messages`、`memory.thread`、`memory.resource`、`maxSteps`
- 前端：`frontend/src/services/agent-stream.ts`
  - 解析 SSE `text-delta`
  - 解析 `tool-result` 且 `toolName === "interviewStateManagerTool"` 的结构化状态

迁移判断：第一阶段为了最小化前端改动，Python runtime 应模拟当前 SSE event shape，继续输出：

```json
{"type":"text-delta","payload":{"text":"..."}}
{"type":"tool-result","payload":{"toolName":"interviewStateManagerTool","result":{...}}}
```

后续稳定后再考虑把命名从 `interviewStateManagerTool` 改成框架无关的 `interviewState`，但那属于破坏性契约变更，应单独排期。

## 4. 目标 Python 后台目录设计

必须新建独立 repo，而不是把 Python runtime 长期放进当前 Mastra repo。建议 repo 名称：

```text
my-first-agent-langgraph/
  pyproject.toml
  uv.lock 或 poetry.lock
  README.md
  .env.example
  Dockerfile
  docker-compose.override.example.yml
  .agents/
    skills/
      langgraph/
        SKILL.md
        references/
          official-docs.md
          persistence.md
          streaming.md
          human-in-the-loop.md
      langchain/
        SKILL.md
        references/
          official-docs.md
          structured-output.md
          tools.md
          chat-models.md
      migration-contract/
        SKILL.md
        references/
          mastra-sse-compat.md
          bff-contract.md
          redis-evaluation-contract.md
  src/
    app/
      main.py                    # FastAPI app
      config.py                  # env/config
      logging.py
      sse.py                     # Mastra-compatible SSE encoder
      schemas/
        api.py                   # BFF stream request/response schema
        interview_state.py       # 迁移自 interview-state-machine-schema.ts
        answer_evaluation.py     # 迁移自 answer-evaluation-schemas.ts
      graphs/
        interview_graph.py       # LangGraph graph definition
        nodes/
          initialize_session.py
          process_user_reply.py
          finalize_report.py
          recover_session.py
      domain/
        interview_state_machine.py
        interview_initialization_pipeline.py
        kickoff_recovery.py
        question_planner.py
        question_generator.py
        question_critic.py
        answer_evaluation.py
        interview_outcome.py
      integrations/
        models.py                # LangChain ChatModel factory
        embeddings.py
        milvus_store.py
        redis_evaluation_store.py
        checkpoint_store.py
      workers/
        answer_evaluation_worker.py
      scripts/
        migrate_vectors.py
        backfill_milvus_metadata.py
  tests/
    unit/
    integration/
    contract/
```

本地开发时可以把它放在当前项目同级目录，例如：

```text
G:/project/my-first-agent/my-first-agent
G:/project/my-first-agent/my-first-agent-langgraph
```

也可以使用 Git submodule 或 workspace 管理，但首选独立 repo，原因是：

- Python runtime 的依赖、发布节奏、CI、Docker 镜像和运行时生命周期与当前 TypeScript/Mastra repo 不同。
- LangGraph/LangChain 官方文档快照和 skills 可以直接随 Python repo 演进，不污染当前 Mastra repo。
- 双运行期可以更清楚地区分“旧 runtime 可回滚”和“新 runtime 持续开发”。

## 4.1 新 repo skills 设计

新 LangGraph repo 必须内置面向 coding agent 的 skills。至少包含三类：

### `langgraph` skill

用途：所有 LangGraph graph、checkpoint、thread、streaming、人机中断、部署相关开发前必须加载。

内容：

- `SKILL.md`：说明“不要凭缓存写 LangGraph API，先查 repo 内官方文档快照，再查在线官方文档”。
- `references/persistence.md`：保存 LangGraph persistence/checkpoint/thread 官方文档要点和来源 URL。
- `references/streaming.md`：保存 LangGraph streaming 官方文档要点和来源 URL。
- `references/human-in-the-loop.md`：如后续需要人工确认/暂停恢复，保存对应官方文档要点。

### `langchain` skill

用途：所有模型调用、structured output、tools、retriever、prompt 和 provider integration 开发前必须加载。

内容：

- `SKILL.md`：规定 LangChain API 必须以当前锁文件版本和官方文档为准。
- `references/structured-output.md`
- `references/tools.md`
- `references/chat-models.md`

### `migration-contract` skill

用途：所有涉及当前 repo 兼容边界的开发前必须加载。

内容：

- BFF 请求体：Mastra-compatible body，包括 `messages`、`memory.thread`、`memory.resource`、`maxSteps`。
- SSE 输出：继续模拟 `text-delta` 与 `tool-result`，其中 `toolName` 暂时保持 `interviewStateManagerTool`。
- Redis answer evaluation key/schema。
- Milvus collection/metadata contract。
- outcome artifact 路径和 JSON shape。

官方文档进入 skills 的方式：

1. 在新 repo 初始化时，用脚本从官方文档入口拉取当前版本文档。
2. 将用于实现的官方文档摘要或快照保存到 `.agents/skills/*/references/`。
3. 每份 reference 顶部记录：
   - source URL
   - fetchedAt
   - upstream title
   - applicable package/version
4. 不把大段无关文档全部塞入 skill；只保存迁移实现会频繁用到的官方页面和关键 API。
5. 新 repo 增加 `scripts/refresh-official-docs.py`，用于刷新 references，并在 PR 中显式 review 文档差异。

## 5. 目标运行时接口

### 5.1 Python Runtime HTTP

为兼容 BFF，Python runtime 先提供 Mastra 形状的 endpoint：

```http
POST /api/agents/interview-agent/stream
Accept: text/event-stream
Content-Type: application/json
```

请求体保持兼容：

```json
{
  "messages": [
    { "role": "user", "content": "serialized startup payload or candidate reply" }
  ],
  "memory": {
    "thread": "thread-id",
    "resource": "frontend-interview-thread-id"
  },
  "maxSteps": 5
}
```

Python 内部转换：

- `threadId = body.memory.thread`
- `resourceId = body.memory.resource`
- `userMessage = last user message content`
- 如果 `userMessage` 可解析为 structured start request，则走 initialize graph path
- 否则从 checkpoint/state store 读取 state，走 process reply path

### 5.2 SSE 兼容格式

先保持前端无需改动：

```text
data: {"type":"text-delta","payload":{"text":"请先介绍..."}}

data: {"type":"tool-result","payload":{"toolName":"interviewStateManagerTool","result":{"assistantReply":"请先介绍...","flowTestMockUserReply":null,"phase":"professional-skills-round","activeRoundType":"professional-skills","activeNodeTopic":"RAG","finalReportReady":false,"progress":{...}}}}

data: [DONE]
```

如果 Python graph 最终不是 token 级流式，第一版可以把完整 `assistantReply` 切成若干小片段作为 `text-delta`，再发送权威 `tool-result`。这能维持前端打字态和现有解析逻辑。

## 6. LangGraph 设计

### 6.1 State

LangGraph state 建议拆为两层：

- `InterviewGraphState`：运行图需要的 envelope，例如 `thread_id`、`resource_id`、`raw_user_message`、`action`、`events`、`error`
- `InterviewSessionState`：业务状态，迁移自当前 `interviewSessionStateSchema`

示例：

```python
class InterviewGraphState(BaseModel):
    thread_id: str
    resource_id: str | None = None
    raw_user_message: str
    action: Literal["initialize-session", "process-user-reply"]
    session: InterviewSessionState | None = None
    assistant_reply: str | None = None
    snapshot: InterviewStateSnapshot | None = None
    final_report_ready: bool = False
```

### 6.2 Graph Nodes

第一版 graph 保持简单、确定：

```text
entry
  -> route_action
    -> initialize_session
      -> persist_state
      -> emit_snapshot
    -> process_user_reply
      -> maybe_enqueue_answer_evaluation
      -> maybe_finalize_report
      -> persist_state
      -> emit_snapshot
```

后续可把初始化拆成更细 graph：

```text
parse_kickoff
  -> extract_jd_signals
  -> plan_questions
  -> retrieve_questions
  -> generate_questions
  -> judge_questions
  -> initialize_state_machine
```

### 6.3 Checkpoint / Thread

LangGraph 的 `thread_id` 应直接使用前端生成的 `threadId`。Python runtime 需要实现可持久化 checkpoint，建议优先级：

1. 开发期：SQLite checkpointer，便于本地调试。
2. 生产期：Postgres checkpointer 或 Redis/自定义 store。
3. 兼容期：额外写一份 JSON state 到现有 outcome/checkpoint 文件，便于和旧 Mastra state 对照。

注意：当前 Mastra 同时写 working memory 和 thread metadata。迁移后不要照搬 Mastra memory 概念；以 LangGraph checkpoint + 显式业务 state store 为准。

## 7. 分阶段迁移路线

### Phase 0：冻结契约与建立基线

目标：先知道“不能破”的行为。

任务：

- 固化 BFF 到 agent runtime 的请求契约样例。
- 固化 Python runtime 必须输出的 SSE event shape。
- 导出一批真实或测试用 kickoff payload、用户回复序列、最终 snapshot/outcome 作为 golden fixtures。
- 为当前 TypeScript runtime 增加或整理 contract tests，覆盖：
  - start interview
  - continue reply
  - flow-test skip
  - restore thread
  - final report ready
  - Redis evaluation timeout/failure

验收：

- `npm run test:workspace` 当前通过。
- `npm run test:e2e:interview:smoke` 当前通过。
- 有不少于 3 条完整面试 golden transcript，可供 Python 对齐。

### Phase 1：搭建 Python Runtime 骨架

目标：BFF 可以切到 Python runtime，但业务先返回 mock snapshot。

任务：

- 新建独立 repo `my-first-agent-langgraph/`，作为 Python LangGraph runtime 承载物。
- 引入 FastAPI、Uvicorn、Pydantic、LangChain、LangGraph、Redis、Milvus client、pytest。
- 在新 repo 内新增 `.agents/skills/langgraph`、`.agents/skills/langchain`、`.agents/skills/migration-contract`。
- 将 LangGraph/LangChain 官方文档中与 persistence、streaming、structured output、tools、chat models 相关的页面整理进新 repo skills references。
- 新增 `scripts/refresh-official-docs.py`，记录官方文档来源和刷新时间。
- 实现 `/health` 和 `/api/agents/interview-agent/stream`。
- 实现 Mastra-compatible SSE encoder。
- 添加 BFF 配置项：
  - `AGENT_RUNTIME_BASE_URL`
  - 保留 `MASTRA_BASE_URL` 作为兼容 fallback
- BFF `AgentService` 支持通过 env 切换上游。

验收：

- 新 LangGraph repo 可以独立 `pytest`、独立启动 Uvicorn、独立构建 Docker 镜像。
- 新 repo 的 coding agent instructions 明确要求实现 LangGraph/LangChain 前先加载本 repo skills。
- skills references 能追溯到官方文档 URL 和抓取日期。
- BFF 代理到 Python runtime 时，前端 `streamChatWithAgent` 测试无需改或只改命名。
- Python runtime contract test 能解析现有 BFF 发送的 Mastra body。

### Phase 2：迁移 Schema 与纯状态机

目标：先迁移最确定、最可测试的业务内核。

任务：

- 将 `interview-state-machine-schema.ts` 迁移为 Pydantic models。
- 将 `interview-state-machine.ts` 中纯函数迁移为 Python：
  - 初始化轮次/节点
  - progress summary
  - classifyByRules
  - applyUserReply
  - buildFinalInterviewStateFromEvaluations
  - validation helpers
- 迁移 `answer-evaluation-schemas.ts`。
- 编写 fixture-based parity tests，对比 TypeScript 结果和 Python 结果。

验收：

- Python unit tests 覆盖主要 reducer 分支。
- 同一输入下，关键字段与 TS 版本一致：`phase`、active node、progress、attempt、score、final report readiness。

### Phase 3：迁移初始化 Pipeline

目标：Python 能从 structured startup payload 初始化真实面试状态。

任务：

- 迁移 kickoff recovery：
  - structured JSON start request
  - legacy kickoff fallback
  - resumeSections 提取
- 迁移或共享 BFF resume parser 规则。
  - 短期：Python 复刻 parser，并用 fixtures 保持一致。
  - 中期更优：把 resume parser contract 固化，BFF 继续作为 canonical parser，Python 只信任 payload 中的 `resumeSections` 和 normalized fields。
- 迁移 JD signals、question planner、query builder。
- 迁移 question generator/critic 的 deterministic fallback。

验收：

- Python runtime 能完成 start interview，并返回真实第一问。
- 同一 kickoff payload 下，题数、轮次、主要 topic 和 progress 与 TS baseline 一致。

### Phase 4：迁移 Milvus RAG

目标：Python 初始化 pipeline 使用现有 Milvus 题库。

任务：

- 实现 `integrations/milvus_store.py`。
- 兼容现有 collection：
  - `interview_questions`
  - 384 维 embedding
  - scalar metadata：`role`、`difficulty`、`skillArea`
  - JSON metadata 合并规则
- 决定 embedding 模型：
  - 方案 A：继续使用当前 fastembed 模型，保证向量维度和召回稳定。
  - 方案 B：切到 Python fastembed，同样保持 384 维。
  - 不建议首版切换 embedding 模型，否则需要重建向量库和重做召回评估。
- 迁移 hybrid rerank：JD/query 提取 skillArea、候选题 skillArea 匹配、top-k 后随机抽取。
- 保留 RAG recall sample 输出格式。

验收：

- Python RAG 能读取现有 Milvus 数据，不需要重建 collection。
- RAG 不可用时返回空候选并走 fallback，不导致 runtime 崩溃。
- recall trace 字段可继续被 outcome writer 消费。

### Phase 5：迁移 LLM 调用与结构化输出

目标：所有原 Mastra model call 改为 LangChain。

任务：

- 实现 `models.py`，统一封装 Zhipu/OpenAI-compatible provider。
- 迁移 follow-up generation。
- 迁移 answer evaluation structured output。
- 温度、模型名、prompt version 保持与现有常量可追踪。
- 所有结构化输出必须经过 Pydantic schema 校验，失败进入 retry 或 fallback。

验收：

- answer evaluation worker 能产出与 `rawAnswerEvaluationOutputSchema` 等价的 JSON。
- follow-up generation 在失败时能回退到 deterministic follow-up。
- 不在日志/outcome 中泄露 reference answer 全文。

### Phase 6：迁移 Redis 异步答题评分

目标：Python worker 接管 Redis queue，主面试 graph 继续 fire-and-forget enqueue。

任务：

- 迁移 `redis-evaluation-store.ts` 到 Python。
- 保持 Redis key、manifest、task status、result schema 向后兼容。
- 实现 Python `answer_evaluation_worker.py`。
- 主 graph 在真实答题后 enqueue task。
- final report node 等待 sealed manifest 和完整 results；failed/timeout 行为与当前一致，不返回 partial report data。

验收：

- Python worker 可以消费 TS runtime 写入的旧任务。
- TS worker 可以在兼容期消费 Python runtime 写入的新任务，除非明确宣布切断兼容。
- async smoke test 覆盖 enqueue -> worker mock scoring -> wait/read -> final report。

### Phase 7：迁移 Outcome 与反馈闭环

目标：保持 `Interview outcome/` 数据结构和 BFF 反馈回写不变。

任务：

- 迁移 `interview-outcome.ts`。
- 继续写：
  - `Interview outcome/index/<threadId>.json`
  - timestamped outcome record
  - `selectorTraining`
  - `candidateImprovement`
- 确保 BFF `saveInterviewFeedback` 不需要大改。
- 若路径或格式必须变化，先让 BFF 支持双读，再切写入。

验收：

- 现有 BFF feedback tests 通过。
- E2E complete flow 能按 `threadId` 找到 outcome artifact。

### Phase 8：BFF 切流与双运行

目标：可以按环境变量在 Mastra 和 Python runtime 间切换。

任务：

- BFF 配置新增：
  - `AGENT_RUNTIME_PROVIDER=mastra|python`
  - `MASTRA_BASE_URL`
  - `PY_AGENT_BASE_URL`
- 本地脚本更新：
  - 当前 repo 的 `start:local` 支持启动或提示启动同级 LangGraph repo
  - 当前 repo 的 Docker Compose 增加 Python runtime service，build context 指向新 repo 或使用新 repo 发布的镜像
  - 兼容期可同时启动 Mastra 与 Python
- 新 LangGraph repo 提供自己的 `docker compose up` / `uvicorn` 本地启动方式。
- CI 增加 Python tests。
- E2E 增加 matrix：
  - provider=mastra
  - provider=python

验收：

- provider=python 下 smoke E2E 通过。
- provider=mastra 下旧链路仍可回滚。

### Phase 9：下线 Mastra Runtime

目标：确认 Python runtime 稳定后移除 Mastra runtime 运行依赖。

前置条件：

- Python provider 连续通过全量 E2E。
- 关键 golden transcripts 差异在可接受范围内。
- Redis/outcome/Milvus 数据兼容验证完成。
- BFF 与 frontend 不再依赖 Mastra event 命名，或已接受兼容命名长期保留。

任务：

- 从生产启动脚本移除 `mastra dev/start`。
- 移除或归档当前 repo 的 `src/mastra/**` 运行时代码。
- 将 Python runtime 的发布、镜像和部署说明全部转移到新 LangGraph repo。
- 保留必要迁移脚本或把它们迁到 Python。
- 更新 README、Dockerfile、docker-compose、GitHub Actions、architecture instructions。

验收：

- `npm run test:workspace` 或替代 workspace 命令覆盖 frontend + bff。
- Python `pytest` 全量通过。
- Docker Compose 一键启动新栈，且 Python service 来源明确指向新 LangGraph repo 或其镜像。

## 8. 数据与兼容策略

迁移铁律：**所有现有对外与持久化数据结构默认不允许变化**。任何字段增删、重命名、类型变化、路径变化、Redis key 变化、Milvus schema 变化、SSE event shape 变化，都必须视为 breaking change，不能混入主迁移。若未来确实需要演进，只能在 Python provider 全量稳定后单独立项，并先做双写/双读/版本字段兼容。

### 8.1 threadId

必须保持前端生成的 `threadId` 是全链路主键：

- SSE request
- LangGraph checkpoint config
- Redis manifest
- outcome index
- feedback 回写
- RAG recall sample

### 8.2 State

短期不迁移 Mastra LibSQL memory 历史。原因是当前产品更依赖结构化 `InterviewSessionState` 和 outcome，而不是自然语言聊天历史。

建议：

- 新会话直接使用 Python checkpoint。
- 兼容期如发现旧 thread 恢复需求，由 BFF 根据 provider 分流旧线程到 Mastra。
- 如果必须恢复旧 Mastra thread，只迁移 thread metadata 中的 `interviewSessionState` JSON，不迁移完整 Mastra memory。

### 8.3 Milvus

保持 collection 不变。不要在第一阶段切 embedding 模型或 metadata schema。

### 8.4 Redis

保持 key/schema 不变，确保 TS/Python worker 在兼容期互操作。

### 8.5 Outcome

保持文件路径和 JSON shape 不变。BFF feedback 依赖 `threadId` index，这个契约优先级很高。

### 8.6 不允许变化的数据结构清单

- BFF -> runtime stream request body：`messages`、`memory.thread`、`memory.resource`、`maxSteps`。
- runtime -> frontend SSE events：`text-delta`、`tool-result`、`payload.toolName === "interviewStateManagerTool"`、`payload.result` snapshot shape。
- `InterviewStateSnapshot`：`assistantReply`、`flowTestMockUserReply`、`phase`、`activeRoundType`、`activeNodeTopic`、`finalReportReady`、`progress`。
- `InterviewProgressSummary` 内全部字段和 enum 值。
- `InterviewSessionState` 业务状态 JSON shape。
- Redis answer evaluation task、manifest、task status、result schema 和 key 命名。
- Milvus `interview_questions` collection、384 维向量、`metadata` JSON 字段、`role`、`difficulty`、`skillArea` scalar 字段。
- `Interview outcome/` 下 index 与 outcome JSON shape，包括 `selectorTraining` 和 `candidateImprovement`。
- RAG recall sample JSON shape。

## 9. 测试计划

### 9.1 Python 单元测试

- schema validation
- kickoff parsing
- state reducer
- progress summary
- classification rules
- question planning
- Redis store fake client
- Milvus unavailable fallback
- outcome writer

### 9.2 Contract Tests

- BFF -> Python runtime request body
- Python runtime -> frontend SSE event shape
- `tool-result.payload.result` 必须满足前端 `interviewStateSnapshotSchema`
- Redis task/result schema 与 TS fixtures 一致
- outcome JSON 与 BFF feedback reader 一致

### 9.3 Golden Transcript Tests

用固定 kickoff + 用户回复序列，对比：

- 每轮 assistantReply 是否非空且符合阶段
- progress 是否一致
- finalReportReady 是否一致
- outcome 是否包含 selectorTraining/candidateImprovement

### 9.4 Live E2E

- start happy path
- complete flow
- edge scenarios
- feedback submission
- restore flow
- flow-test skip

## 10. 风险与应对

### 风险 1：LangGraph checkpoint 与现有 Mastra memory 语义不一致

应对：不要迁移 Mastra memory 抽象；把 `InterviewSessionState` 作为唯一业务状态源，checkpoint 只是持久化载体。

### 风险 2：SSE event shape 变化导致前端失效

应对：Python runtime 首版模拟当前 Mastra events；BFF 和前端单独排期做框架无关命名。

### 风险 3：RAG 召回漂移

应对：保持 Milvus collection、embedding 维度、metadata schema、rerank 规则不变；用 recall trace fixtures 做对比。

### 风险 4：LLM 结构化输出稳定性下降

应对：Pydantic 严格校验 + retry + deterministic fallback；评分 worker 不直接影响主面试响应。

### 风险 5：双运行期维护成本高

应对：双运行只保留到 Python provider 全量 E2E 连续通过；新增功能冻结在 Python runtime，Mastra 只接受 blocker 修复。

### 风险 6：TypeScript 与 Python parser 分叉

应对：BFF 继续作为 canonical resume parser；Python 优先消费 BFF 已补齐的 `resumeSections` 和 normalized data，减少二次解析。

## 11. 里程碑建议

| 里程碑 | 目标 | 建议验收 |
| --- | --- | --- |
| M0 | 契约冻结与 fixtures | TS 当前测试和 smoke E2E 通过 |
| M1 | Python runtime mock 可被 BFF 代理 | 前端能收到兼容 SSE |
| M2 | Python 状态机可跑通无 RAG 面试 | reducer/golden tests 通过 |
| M3 | Python 初始化 + Milvus RAG | start interview 返回真实题目 |
| M4 | Python Redis worker + final report | async smoke 闭环通过 |
| M5 | provider=python E2E 通过 | live smoke + complete flow |
| M6 | 默认切到 Python | Docker/local/CI 全部改造 |
| M7 | 下线 Mastra runtime | 文档、脚本、依赖清理完成 |

## 12. 推荐依赖

首版建议：

- Python 3.12+
- FastAPI + Uvicorn
- Pydantic v2
- LangGraph
- LangChain / langchain-core / provider-specific integration
- redis-py
- pymilvus
- pytest / pytest-asyncio
- ruff / mypy 或 pyright

依赖版本不要凭经验固定。实施前应按官方文档和锁文件确认当前推荐安装方式，并在新 LangGraph repo 的 `pyproject.toml` 中锁定可复现版本。

## 13. 官方文档参考

- LangGraph persistence/checkpoint/thread 概念：`https://docs.langchain.com/oss/python/langgraph/persistence`
- LangGraph streaming 概念：`https://docs.langchain.com/oss/python/langgraph/streaming`
- LangChain structured output：`https://docs.langchain.com/oss/python/langchain/structured-output`
- LangChain tools：`https://docs.langchain.com/oss/python/langchain/tools`
- LangChain/LangGraph 官方 agent-facing 文档入口可优先从官方 `llms.txt` / MCPDOC 入口获取，并把迁移相关页面沉淀到新 repo 的 `.agents/skills/*/references/`。

## 14. 第一批可执行任务清单

1. 新建独立 repo `my-first-agent-langgraph/`。
2. 在新 repo 中初始化 Python 项目、测试、Dockerfile、README、`.env.example`。
3. 在新 repo 中创建 `.agents/skills/langgraph`、`.agents/skills/langchain`、`.agents/skills/migration-contract`。
4. 将 LangGraph/LangChain 官方文档中与本迁移相关的页面保存进新 repo skills references，并记录 source URL / fetchedAt / applicable version。
5. 新增 Python `/api/agents/interview-agent/stream` mock endpoint，输出 Mastra-compatible SSE。
6. 给当前 repo 的 BFF 增加 runtime provider 配置，但默认仍指向 Mastra。
7. 抽取 3 组 golden transcript fixtures。
8. 迁移 `interview-state-machine-schema.ts` 到 Pydantic。
9. 迁移 `buildInterviewProgressSummary`、`validateInterviewState` 和主 reducer。
10. 建立 TS/Python parity tests。
11. 迁移 kickoff recovery 和 initialization pipeline。
12. 接入 Milvus 只读召回。
13. 迁移 Redis answer evaluation worker。

## 15. 暂不建议做的事

- 不建议一开始重写前端 SSE parser。
- 不建议一开始改 Redis schema。
- 不建议一开始重建 Milvus collection 或更换 embedding 模型。
- 不建议把 BFF 也一起改成 Python；BFF 当前承担的上传校验、代理和反馈回写边界清晰，先保持稳定。
- 不建议把所有 deterministic state machine 逻辑交给 LLM agent 自主决策；这会丢掉当前系统已经建立的可测试流程控制。
- 不建议把新 Python runtime 长期塞进当前 repo 子目录；当前 repo 可以保留临时适配和切流配置，但 LangGraph runtime 的源码、skills 和发布应由新 repo 承载。

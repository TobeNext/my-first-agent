# LangGraph 迁移最小可验证单元执行计划

日期：2026-06-11

## 1. 执行原则

本计划是 `2026-06-11-python-langgraph-mastra-migration-plan.md` 的执行拆分。迁移以 LangGraph 为主，不以 LangChain AgentExecutor 重写主流程。LangGraph 负责 graph state、node、checkpoint、thread、streaming orchestration；LangChain 只负责模型调用、structured output、tools、retriever 和 provider integration。

数据结构保证不发生改变。当前 repo 中前端、BFF、Redis、Milvus、outcome、RAG trace 依赖的结构都视为外部契约。每个最小单元完成后，都必须用测试或 fixture 证明“行为可用、结构未变、可回滚”。

## 2. 不变契约

以下结构在主迁移期间不得改名、删字段、改 enum、改类型、改路径或改 key：

- BFF stream request body：`messages`、`memory.thread`、`memory.resource`、`maxSteps`。
- SSE event：`text-delta`、`tool-result`、`payload.toolName === "interviewStateManagerTool"`、`payload.result`。
- `InterviewStateSnapshot` 和 `InterviewProgressSummary`。
- `InterviewSessionState` JSON shape。
- Redis answer evaluation task、manifest、status、result 和 key layout。
- Milvus `interview_questions` collection：384 维向量、`metadata`、`role`、`difficulty`、`skillArea`。
- `Interview outcome/index/<threadId>.json` 和 outcome record shape。
- `selectorTraining`、`candidateImprovement`、RAG recall sample JSON。

## 3. 最小可验证单元

### Unit 00：建立迁移基线

工作内容：

- 在当前 repo 记录 Mastra runtime、BFF、frontend 的当前测试命令和通过状态。
- 收集 3 组 golden transcript fixture：基础启动、含 JD 启动、flow-test skip。
- 每组 fixture 保存 kickoff payload、用户回复序列、期望 snapshot 摘要、期望 outcome 关键字段。

验收：

- 当前 `npm run test:workspace` 或已知可运行子集有记录。
- 当前 `npm run test:e2e:interview:smoke` 有记录。
- fixtures 能被后续 Python tests 直接读取。

产出：

- 当前 repo `PLAN/fixtures/` 或新 LangGraph repo `tests/fixtures/contracts/` 中的 golden fixtures。

### Unit 01：新建独立 LangGraph repo

工作内容：

- 新建同级 repo `G:/project/my-first-agent/my-first-agent-langgraph`。
- 初始化 Python 3.12+ 项目，包含 `pyproject.toml`、lockfile、`README.md`、`.env.example`、`Dockerfile`。
- 建立 `src/app` 和 `tests` 基础目录。
- 加入 `ruff`、`pytest`、`pytest-asyncio`。

验收：

- `pytest` 空项目通过。
- `ruff check` 通过。
- Docker image 能构建。

产出：

- 独立可运行的新 repo。

### Unit 02：沉淀 LangGraph/LangChain 官方文档到新 repo skills

工作内容：

- 创建 `.agents/skills/langgraph/SKILL.md`。
- 创建 `.agents/skills/langchain/SKILL.md`。
- 创建 `.agents/skills/migration-contract/SKILL.md`。
- 将 LangGraph persistence、streaming、checkpoint/thread 相关官方文档整理到 `langgraph/references/`。
- 将 LangChain structured output、tools、chat models 相关官方文档整理到 `langchain/references/`。
- 将当前 repo 的 BFF/SSE/Redis/Milvus/outcome 契约整理到 `migration-contract/references/`。
- 每份 reference 顶部写明 `source URL`、`fetchedAt`、`applicable package/version`。

验收：

- 新 repo 中任何 LangGraph/LangChain 开发说明都要求先加载对应 skill。
- references 能追溯到官方文档，不依赖记忆。

产出：

- 新 repo `.agents/skills/**`。
- `scripts/refresh-official-docs.py` 草案或正式脚本。

### Unit 03：实现 Python 配置和健康检查

工作内容：

- 实现 `src/app/config.py`，读取模型、Redis、Milvus、checkpoint、outcome root 等 env。
- 实现 `src/app/main.py`，提供 FastAPI app。
- 实现 `GET /health`。
- 加入结构化日志。

验收：

- `uvicorn app.main:app` 可启动。
- `GET /health` 返回 200 和 runtime/provider 信息。
- 缺少非必要依赖服务时 app 不崩溃。

产出：

- Python runtime 基础 app。

### Unit 04：实现 Mastra-compatible stream request schema

工作内容：

- 用 Pydantic 定义现有 BFF 上游请求体：
  - `messages`
  - `memory.thread`
  - `memory.resource`
  - `maxSteps`
- 实现 last user message 提取。
- 实现 `threadId` 和 `resourceId` 解析。
- 加入 contract tests，使用当前 BFF 生成的请求 fixture。

验收：

- 现有 BFF request fixture 能无损 parse。
- 无效 body 返回与 BFF 可理解的 4xx JSON。

产出：

- `src/app/schemas/api.py`。
- `tests/contract/test_mastra_stream_request.py`。

### Unit 05：实现 Mastra-compatible SSE encoder

工作内容：

- 实现 `text-delta` event 编码。
- 实现 `tool-result` event 编码，`toolName` 固定为 `interviewStateManagerTool`。
- 实现 `[DONE]` 结束事件。
- 支持把完整 assistant reply 切分成多个 delta。

验收：

- Python SSE fixture 能被当前 `frontend/src/services/agent-stream.ts` 测试逻辑解析。
- `tool-result.payload.result` shape 不变。

产出：

- `src/app/sse.py`。
- `tests/contract/test_mastra_sse_compat.py`。

### Unit 06：实现 mock stream endpoint

工作内容：

- 实现 `POST /api/agents/interview-agent/stream`。
- 暂时不接业务状态机，只返回固定合法 snapshot。
- snapshot 字段完全匹配前端 `interviewStateSnapshotSchema`。

验收：

- BFF 代理到 Python runtime 时前端 stream parser 能拿到 `authoritativeAssistantReply`。
- 当前 repo 可通过 env 切到 Python mock runtime 做 smoke。

产出：

- Python mock endpoint。
- BFF 切流前的最小联通证明。

### Unit 07：当前 BFF 增加 runtime provider 配置

工作内容：

- 在当前 repo BFF 中新增 `AGENT_RUNTIME_PROVIDER=mastra|python`。
- 新增 `PY_AGENT_BASE_URL`，保留 `MASTRA_BASE_URL`。
- `AgentService.streamChat` 按 provider 选择上游。
- 默认仍为 Mastra。
- 更新 BFF unit tests。

验收：

- provider=mastra 时现有测试不变。
- provider=python 时请求 URL 指向 Python runtime。
- 请求 body 不变。

产出：

- 当前 repo BFF 配置与测试改动。

### Unit 08：迁移 API snapshot schema

工作内容：

- 将前端消费的 `InterviewStateSnapshot` 和 `InterviewProgressSummary` 转为 Pydantic model。
- enum 值必须逐字一致。
- 写 round-trip tests，确保 Python dump 出来的 JSON 能被前端 Zod schema 接受。

验收：

- 所有 snapshot/progress fixtures 通过 Python validation。
- Python 输出 JSON 与 TS fixture 字段集合一致。

产出：

- `src/app/schemas/interview_snapshot.py`。

### Unit 09：迁移 InterviewSessionState schema

工作内容：

- 将 `interview-state-machine-schema.ts` 迁移为 Pydantic model。
- 保留字段名、nullable、默认值、数组 shape、enum 字面值。
- 将 TS fixture 中的完整 state JSON 导入 Python validation。

验收：

- TS state fixtures 均可被 Python model parse。
- Python model dump 后字段名和嵌套结构不变。

产出：

- `src/app/schemas/interview_state.py`。
- schema parity tests。

### Unit 10：迁移 progress summary 纯函数

工作内容：

- 迁移 `buildInterviewProgressSummary`。
- 只依赖 `InterviewSessionState`，不接 LangGraph、不接 LLM。
- 用 TS fixture 对比输出。

验收：

- 初始化、主问题、追问、跨轮、完成态 fixtures 输出一致。

产出：

- `src/app/domain/interview_state_machine.py` 中 progress 逻辑。

### Unit 11：迁移状态校验和基础 reducer

工作内容：

- 迁移 `validateInterviewState` 等校验 helper。
- 迁移节点查找、轮次推进、完成判断等不依赖 LLM 的 helper。
- 建立 Python unit tests。

验收：

- 无效 state 被拒绝。
- 有效 TS fixtures 全部通过。
- reducer helper 对主路径 fixtures 输出一致。

产出：

- 状态机基础 helper。

### Unit 12：迁移规则分类与回答应用

工作内容：

- 迁移 `classifyByRules`。
- 迁移 `applyUserReply` 中不依赖外部服务的逻辑。
- 保持 flow-test skip marker 行为。
- 保持 score、missingPoints、incorrectPoints、follow-up intent 字段结构。

验收：

- direct answer、partial answer、off-topic、skip、stop、clarification fixtures 通过。
- flow-test skip 能推进状态且输出结构不变。

产出：

- Python 状态机可处理单轮用户回复。

### Unit 13：建立 LangGraph 最小 graph 壳

工作内容：

- 定义 `InterviewGraphState` envelope。
- 创建 LangGraph graph：
  - route action
  - initialize mock node
  - process reply node
  - emit snapshot node
- graph 内必须调用前面迁移的纯函数，不把流程写进 LLM prompt。

验收：

- graph 可用 `thread_id` invoke。
- start 和 continue 都能返回合法 snapshot。
- 不接 Milvus、Redis、LLM 时测试通过。

产出：

- `src/app/graphs/interview_graph.py`。

### Unit 14：接入 LangGraph checkpoint

工作内容：

- 开发期先接 SQLite checkpointer。
- `thread_id` 使用前端 `threadId`。
- checkpoint 中保存 graph state，业务 state 保持 `InterviewSessionState` shape。
- 提供清理测试 checkpoint 的 helper。

验收：

- 同一 `threadId` 第二次请求能恢复上一次 state。
- 不同 `threadId` 隔离。
- checkpoint 不改变业务 state JSON shape。

产出：

- `src/app/integrations/checkpoint_store.py`。

### Unit 15：迁移 structured startup payload 解析

工作内容：

- 迁移 `interview-start-contract` 相关解析逻辑到 Python，或用 fixture 固化 BFF payload。
- 迁移 `extractStructuredInterviewStartRequest`。
- Python 优先信任 BFF 传入的 `resumeSections`，不创造第二套权威 parser。

验收：

- 当前 BFF 生成的 startup payload fixtures 可解析。
- legacy kickoff fixtures 可解析，但优先级低于 structured payload。

产出：

- `src/app/domain/kickoff_recovery.py`。

### Unit 16：迁移初始化 question planner

工作内容：

- 迁移 professional question mode、question count、skip round 设置解析。
- 迁移 professional question plan。
- 迁移 project topic fallback。
- 不接 Milvus，只输出 plan。

验收：

- per-skill-default、自定义题数、跳过专业轮、跳过项目轮 fixtures 输出一致。

产出：

- `src/app/domain/question_planner.py`。

### Unit 17：迁移 query builder 和 metadata 规范化

工作内容：

- 迁移 professional/project query text builder。
- 迁移 `skillArea` 提取和 normalize。
- 保持 recall trace 中 skill 标签结构。

验收：

- query fixtures 与 TS baseline 一致或等价。
- metadata normalize fixtures 输出一致。

产出：

- `src/app/domain/question_query.py`。
- `src/app/domain/question_metadata.py`。

### Unit 18：接入 Milvus 只读检索

工作内容：

- 实现 `pymilvus` 连接。
- 读取现有 `interview_questions` collection。
- 保持字段：`id`、`vector`、`metadata`、`role`、`difficulty`、`skillArea`。
- Milvus 不可用时返回空候选，不抛到 endpoint。

验收：

- 有 Milvus 时能召回候选。
- 无 Milvus 时 fallback path 测试通过。
- 不创建、不改写 collection schema。

产出：

- `src/app/integrations/milvus_store.py`。

### Unit 19：接入 embedding

工作内容：

- 使用与现有向量库兼容的 384 维 embedding。
- 首版不更换 Milvus collection，不重建向量。
- 对 embedding 失败做 fallback。

验收：

- embedding 输出维度为 384。
- 使用现有 query 可检索 Milvus。
- 失败不影响初始化 fallback。

产出：

- `src/app/integrations/embeddings.py`。

### Unit 20：迁移 RAG retriever 和 hybrid rerank

工作内容：

- 迁移候选聚合、top-k、skillArea rerank、随机抽取规则。
- 生成与旧结构一致的 `RagRecallTrace`。
- 不改变 recall sample JSON shape。

验收：

- recall trace fixture 字段集合一致。
- RAG available/unavailable 两种路径通过。

产出：

- `src/app/domain/question_retriever.py`。

### Unit 21：迁移初始化 question generator deterministic 部分

工作内容：

- 迁移从召回候选生成最终题集的确定性适配。
- 迁移 deterministic fallback。
- 暂不接 LLM rewrite，先保证可用问题进入状态机。

验收：

- 无 RAG 候选时仍能初始化问题。
- 题目数量、round type、topic 字段符合 schema。

产出：

- `src/app/domain/question_generator.py`。

### Unit 22：迁移 question critic

工作内容：

- 迁移空题、重复题、目标错位、scenario/project shape 检查。
- 不通过时使用 deterministic fallback。

验收：

- critic fixtures 覆盖 pass/fail。
- fail 后输出题目 schema 不变。

产出：

- `src/app/domain/question_critic.py`。

### Unit 23：实现真实 initialize_session LangGraph node

工作内容：

- graph node 调用 kickoff recovery、planner、retriever、generator、critic。
- 初始化 `InterviewSessionState`。
- 返回第一条 assistant reply 和 snapshot。
- 写 checkpoint。

验收：

- start interview fixture 能得到真实第一问。
- progress 和 active round 与 TS baseline 对齐。
- 不接 Redis/LLM 时可通过。

产出：

- `graphs/nodes/initialize_session.py`。

### Unit 24：迁移 follow-up generation 的 deterministic fallback

工作内容：

- 先实现不依赖 LLM 的追问 fallback。
- 保持 followUpState、followUpFocus、assistantReply 字段结构。

验收：

- 需要追问的 answer fixture 产生合法追问。
- 追问次数上限与 TS 一致。

产出：

- 可无 LLM 跑完整短面试。

### Unit 25：接入 LangChain ChatModel factory

工作内容：

- 实现统一模型工厂，支持当前 OpenAI-compatible/Zhipu 配置。
- 不在业务节点直接散落 provider 初始化。
- 所有模型调用支持 timeout、retry、temperature 配置。

验收：

- mock model tests 通过。
- 无 API key 时 runtime 可启动，真实 LLM tests 自动 skip。

产出：

- `src/app/integrations/models.py`。

### Unit 26：迁移 LLM follow-up generation

工作内容：

- 用 LangChain model 调用生成追问。
- 失败时回落 Unit 24 deterministic fallback。
- 不改变输出结构。

验收：

- mock LLM 输出通过 schema。
- LLM 失败路径通过。

产出：

- LLM follow-up node/helper。

### Unit 27：迁移 answer evaluation schema

工作内容：

- 将 `answer-evaluation-schemas.ts` 和 `rawAnswerEvaluationOutputSchema` 迁移到 Pydantic。
- 保持 classification enum、score 维度、result 字段不变。

验收：

- TS Redis result fixtures 可 parse。
- Python dump 后 key 和类型一致。

产出：

- `src/app/schemas/answer_evaluation.py`。

### Unit 28：迁移 Redis evaluation store

工作内容：

- 迁移 Redis key、manifest、pending queue、status、result 读写。
- 使用 fake Redis client 做 unit tests。
- 确保能读 TS 写入的 fixture 数据。

验收：

- enqueue、claim、retry、markSucceeded、markFailed、seal、wait/read 全部通过。
- Redis key 不变。

产出：

- `src/app/integrations/redis_evaluation_store.py`。

### Unit 29：实现 Python answer evaluation worker

工作内容：

- 实现 worker loop。
- 用 LangChain structured output 调评分模型。
- promptVersion、modelName 保持可追踪。
- structured output 校验失败进入 retry。

验收：

- mock evaluator smoke：enqueue -> claim -> markSucceeded。
- 失败重试和最终 failed 状态通过。
- result schema 与 TS baseline 一致。

产出：

- `src/app/workers/answer_evaluation_worker.py`。

### Unit 30：主 graph 接入异步评分 enqueue

工作内容：

- 在真实用户回答后 fire-and-forget enqueue。
- Redis 写入失败只记录日志，不阻塞 assistant reply。
- flow-test skip 不写真实评分任务，保持当前行为。

验收：

- enqueue 成功时 manifest 有 task。
- Redis 不可用时面试继续。
- task body 与 TS task schema 一致。

产出：

- process reply node 接入 Redis enqueue。

### Unit 31：迁移 wait/read evaluations

工作内容：

- 迁移 `waitAndReadInterviewEvaluationsTool` 等价逻辑。
- 等待 sealed manifest 和全部 task 完成。
- failed/timeout 不返回 partial report data。

验收：

- complete、failed、timeout fixtures 通过。
- timeout 行为与 TS baseline 一致。

产出：

- `src/app/domain/evaluation_report_reader.py`。

### Unit 32：迁移 final report reducer

工作内容：

- 迁移 `buildFinalInterviewStateFromEvaluations`。
- Redis LLM result 覆盖本地规则评分。
- 重新计算 node summary 和 final report。

验收：

- async smoke fixture 生成 finalReportReady。
- final report snapshot shape 不变。

产出：

- final report 生成能力。

### Unit 33：迁移 outcome writer

工作内容：

- 迁移 `interview-outcome.ts`。
- 保持 `Interview outcome/index/<threadId>.json`。
- 保持 outcome record 中 `selectorTraining` 和 `candidateImprovement` shape。
- 路径默认指向当前 repo 的 outcome root 或共享 volume。

验收：

- BFF feedback reader 能读取 Python 写入的 outcome。
- outcome fixture 与 TS 字段集合一致。

产出：

- `src/app/domain/interview_outcome.py`。

### Unit 34：迁移 RAG recall sample writer

工作内容：

- 迁移 recall sample 写入路径和 JSON shape。
- 更新 answer performance 时保持字段不变。

验收：

- 旧分析脚本能读取 Python 写入的 recall sample。

产出：

- `src/app/domain/rag_recall_sample.py`。

### Unit 35：真实 process_user_reply LangGraph node

工作内容：

- 从 checkpoint 读取 `InterviewSessionState`。
- 调用规则分类、follow-up、状态推进、enqueue、outcome update。
- 返回 assistant reply 和 snapshot。

验收：

- start -> answer -> follow-up/next question fixture 通过。
- progress 正确更新。
- checkpoint 恢复后继续推进。

产出：

- `graphs/nodes/process_user_reply.py`。

### Unit 36：完整短流程 golden test

工作内容：

- 使用最短题数设置跑完整面试。
- 用 mock RAG、mock LLM、fake Redis。
- 验证最终 snapshot、outcome、evaluation flow。

验收：

- Python 单进程测试不依赖外部服务即可通过。

产出：

- `tests/integration/test_interview_short_flow.py`。

### Unit 37：真实依赖 integration smoke

工作内容：

- 使用 Docker Redis/Milvus。
- 使用 mock LLM 或可选真实 LLM。
- 跑 start + one answer + enqueue。

验收：

- Milvus 可用时召回真实候选。
- Redis 可用时写入真实 task。

产出：

- `tests/integration/test_runtime_dependencies_smoke.py`。

### Unit 38：当前 repo Docker Compose 接入新 repo

工作内容：

- 当前 repo Docker Compose 增加 Python runtime service。
- build context 指向同级 `my-first-agent-langgraph` 或使用镜像。
- 配置 BFF provider=python。
- 不移除 Mastra service。

验收：

- compose 可同时启动 Mastra、Python、BFF、frontend、Redis、Milvus。
- provider 可切换。

产出：

- 当前 repo compose/script 更新。

### Unit 39：provider=python 前端 smoke

工作内容：

- 启动新 LangGraph runtime。
- 当前前端通过 BFF 发起 start interview。
- 验证 UI 能显示第一问和 progress。

验收：

- 不改前端 parser 即可工作。
- 浏览器控制台无 stream parse error。

产出：

- 手工或 Playwright smoke 记录。

### Unit 40：provider=python E2E smoke

工作内容：

- 在当前 repo E2E 中加入 provider=python 配置。
- 跑最小 upload-resume-to-start-interview path。

验收：

- `test:e2e:interview:smoke` 等价场景通过。

产出：

- CI/local E2E provider matrix 初版。

### Unit 41：provider=python complete flow E2E

工作内容：

- 跑完整面试、最终报告、outcome 写入。
- 提交反馈并由 BFF 回写。

验收：

- complete flow 通过。
- outcome 和 feedback shape 不变。

产出：

- provider=python complete E2E。

### Unit 42：双运行回滚演练

工作内容：

- provider=python 跑一组 smoke。
- 切回 provider=mastra。
- 再跑同一 BFF/前端 smoke。

验收：

- 切换只依赖 env，不需要改代码。
- 旧 Mastra runtime 仍可用。

产出：

- 回滚步骤记录。

### Unit 43：默认 provider 切到 Python

工作内容：

- 在本地脚本和 Docker Compose 中把默认 provider 改为 Python。
- CI 主路径切到 Python。
- Mastra provider 保留备用。

验收：

- Python provider 全量测试通过。
- Mastra provider smoke 仍通过。

产出：

- 默认运行链路切换。

### Unit 44：冻结 Mastra runtime 新功能

工作内容：

- README/AGENTS/architecture instructions 标明新功能进入 LangGraph repo。
- 当前 `src/mastra/**` 只接受回滚 blocker 修复。

验收：

- 文档指向清楚。
- 后续任务不会继续在 Mastra runtime 扩展主能力。

产出：

- 维护策略文档更新。

### Unit 45：下线 Mastra runtime

工作内容：

- 在 Python provider 全量稳定后，移除生产脚本中的 Mastra runtime。
- 归档或删除 `src/mastra/**` 运行时代码。
- 保留必要历史 fixture 和迁移文档。

验收：

- 当前 repo 前端+BFF 测试通过。
- 新 LangGraph repo Python 测试通过。
- Docker/CI 不再依赖 Mastra runtime。

产出：

- Mastra runtime 下线 PR。

## 4. 执行顺序约束

- Unit 00 到 Unit 07 是切流基础，必须最先完成。
- Unit 08 到 Unit 12 是数据结构和纯状态机基础，不能跳过。
- Unit 13 到 Unit 14 确立 LangGraph 主框架，后续业务必须接入 graph node。
- Unit 15 到 Unit 23 完成真实初始化。
- Unit 24 到 Unit 32 完成回答、LLM 和异步评分闭环。
- Unit 33 到 Unit 34 保证 outcome 和 RAG trace 不变。
- Unit 35 到 Unit 41 才进入完整联调和 E2E。
- Unit 42 到 Unit 45 是切默认和下线阶段。

## 5. 每个 Unit 的完成定义

每个最小单元都必须满足：

- 有明确代码产出或 fixture 产出。
- 有自动化测试，或有可复现手工验证记录。
- 没有改变不变契约中的数据结构。
- 能独立 review，不依赖一个巨大 PR。
- 如涉及当前 repo 代码改动，必须完成 project-architecture-sync 检查。

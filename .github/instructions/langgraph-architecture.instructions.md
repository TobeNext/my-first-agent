---
applyTo: "../my-first-agent-langgraph/src/**/*.py,../my-first-agent-langgraph/tests/**/*.py,../my-first-agent-langgraph/scripts/**/*.py"
description: "Use when coding in the sibling Python LangGraph runtime. Captures the default interview runtime architecture, FastAPI/LangGraph boundaries, Mastra-compatible contract, persistence/artifact responsibilities, and the required post-edit project-architecture-sync skill in the frontend/BFF host."
---

# LangGraph Runtime Architecture

本 instruction 适用于同级仓库 `../my-first-agent-langgraph` 下的 Python 代码。该仓库是 interview system 的默认 agent runtime provider，负责承接 BFF 透传的结构化 interview contract，运行 LangGraph 面试状态机，并输出与 legacy Mastra provider 兼容的 SSE、checkpoint、outcome 和 RAG artifact。

## Mandatory Pre-Edit Load

- 每次对 `../my-first-agent-langgraph` 进行任何代码、测试、脚本、运行逻辑、数据流、contract、配置或架构相关改动前，必须先完整加载并阅读本文件。
- 只有在读完本文件并确认当前改动应遵守的 LangGraph runtime 边界后，才能开始查看实现细节、制定方案或编辑文件。
- 如果同一轮任务会分多条“建议实施顺序”连续推进，每一条开始前都要重新加载/核对本文件；不能依赖上一条任务的记忆。
- 如果用户要求先从某个计划文件或具体源码开始，也仍要先加载本文件，再读取计划或源码。

## Source Of Truth

- LangGraph 运行时现状以 `../my-first-agent-langgraph/src/app/**`、`../my-first-agent-langgraph/pyproject.toml` 和 `../my-first-agent-langgraph/README.md` 为准。
- 默认 provider 切换与前端/BFF 编排以本仓库 `bff/**`、`frontend/**`、`docker-compose.yml` 和 `docs/RUNTIME_PROVIDER_CUTOVER.md` 为参考。
- legacy Mastra runtime under `src/mastra/**` 只作为 rollback provider 保留；新的 interview runtime 能力应优先在 `../my-first-agent-langgraph` 实现。
- 如果 Python runtime 代码、host repo 文档和历史规划冲突，先按代码理解当前可运行能力，再决定是否同步 instruction 或架构文档。

## Current Responsibilities

- `app.main`: FastAPI 入口；暴露 `/health`、`/api/agents/interview-agent/stream` 和 interview report status/markdown/read API；把 BFF 传入的 Mastra-style stream request 转成 LangGraph 调用，并为报告通知/下载提供 Python runtime 侧 HTTP 边界。
- `app.graphs.interview_graph`: LangGraph 编排入口；按 checkpoint 中是否存在 session 路由到初始化或用户答题处理，并统一产出 snapshot。
- `app.graphs.nodes`: LangGraph 节点实现；当前 `process_user_reply` 负责后续答题推进。
- `app.schemas`: Pydantic contract；维护 Mastra stream request、interview start、state、snapshot、answer evaluation、interview report 和 report generation 等结构化边界。
- `app.domain`: 面试业务逻辑；包含 kickoff recovery、简历/JD 信号解析、问题规划、RAG 召回、问题生成/裁决、状态机、追问、outcome、RAG sample、异步答题评分 enqueue/read、report generation enqueue/prompt/status 解析。
- `app.integrations`: 外部基础设施适配；包含模型、embedding、Milvus、Redis、checkpoint store、Redis evaluation store、report DB repository 和 Redis report generation store。
- `app.sse`: Mastra-compatible SSE 编码；输出 `text-delta`、`tool-result` 和 `[DONE]`，供现有 BFF/frontend 继续复用同一消费路径。
- `app.workers` 与 `scripts/run_answer_evaluation_worker.py`: 异步答题评分 worker；从 Redis-compatible store 消费任务并写回结构化评估结果。
- `app.workers.report_generation_worker` 与 `scripts/run_report_generation_worker.py`: report-generation worker；当前负责 claim report-generation task、等待 evaluation manifest sealed 且全部 expected task 有 result、遇到 failed evaluation task 时标记 report failed、构造 report prompt、调用模型生成 `ReportGenerationOutput`、事务写入 report DB，并且只在 DB 写入成功后把 Redis report manifest 标记为 succeeded。输出校验失败、evaluation pending 或 DB 写入失败会进入 retry/failed 路径，避免 Redis 提前显示 `markdownAvailable=true`。

## Module Boundaries

- FastAPI handler 只负责 HTTP 边界、schema 接收和流式响应包装；不要把 interview 状态推进、召回或评分逻辑写进 `app.main`。
- LangGraph graph 负责节点路由、checkpoint 接线和 graph state 聚合；复杂业务规则应下沉到 `app.domain` 或具体 node。
- Pydantic schema 是跨 BFF/runtime/frontend contract 的 Python 侧边界；新增或修改请求、snapshot、state 字段时，同步检查 BFF 和前端共享 schema 是否需要调整。
- `app.domain.interview_state_machine` 应保持为主要的纯状态推进层；流程推进、切题、追问槽位、flow-test skip、最终报告聚合等规则优先放在这里或相邻 domain helper。
- RAG 查询构造、召回 trace、问题生成和质量闸门应分别放在 `question_query`、`question_retriever`、`question_generator`、`question_critic` 等 domain 模块，避免重新塞回 graph 或 API handler。
- 外部系统连接统一通过 `app.integrations` 和 `app.config.Settings` 管理；不要在 domain 逻辑中散落读取环境变量或直接创建长期客户端。
- `tests/contract` 保护与 host repo / legacy Mastra 的 stream contract；`tests/unit` 保护 domain 和 schema；`tests/integration` 保护 runtime dependency smoke 和短流程。

## Contract And Validation Boundaries

- BFF 仍负责登录、上传、结构化 start payload 归一和前置校验；Python runtime 仍必须用 Pydantic 对收到的 Mastra-style request 做自己的边界解析。
- `/api/agents/interview-agent/stream` 当前接收 `messages`、`memory.thread`、`memory.resource` 和可选 `maxSteps`；业务 thread id 以 `memory.thread` 为准。
- `/api/interviews/{thread_id}/report/status`、`/api/interviews/{thread_id}/report/markdown` 和 `/api/interviews/{thread_id}/report/read` 是 Python runtime 侧报告状态、markdown 下载和已读回执 API；status 读取 Redis report manifest、answer evaluation manifest、DB report 和 DB read receipt，markdown 只从 report DB 读取。
- 初始化时，最后一条 user message 包含 BFF 透传的 structured kickoff payload；runtime 负责恢复 structured / legacy kickoff，并自行完成题目规划、召回、生成、裁决和状态初始化。
- 后续答题时，runtime 通过 checkpoint 中的 thread state 恢复 session；前端本地历史和 BFF 转发内容不能替代 checkpoint state。
- SSE 必须保持 Mastra-compatible：先逐段输出 `text-delta`，再输出 tool name 为 `interviewStateManagerTool` 的 `tool-result` snapshot，最后输出 `[DONE]`。
- `tool-result.result` 必须继续包含前端依赖的 `assistantReply`、`phase`、`activeRoundType`、`activeNodeTopic`、`finalReportReady` 和 `progress` 等字段。
- flow-test mode 的 skip marker 应在状态机/domain 内被识别和推进，不应只在 API 层或前端模拟完成。

## Persistence And Artifact Boundaries

- LangGraph checkpoint 默认由 `CHECKPOINT_URL` 配置，当前默认 SQLite 文件为 `./checkpoints.db`；graph 调用必须通过 `thread_id` 传入 configurable checkpoint key。
- Outcome 默认写入 host repo 的 `../my-first-agent/Interview outcome`，RAG recall sample 默认写入 `../my-first-agent/RAG LOG INFO`；路径来自 `OUTCOME_ROOT` 和 `RAG_LOG_ROOT`。
- 初始化阶段会写入 outcome snapshot 和 RAG recall sample；写 artifact 失败不应阻断基本面试响应，但需要保持可观测性和测试覆盖。
- Report DB 由 `REPORT_DATABASE_URL` 配置，当前默认 SQLite 文件为 `./interview_reports.db`；`app.integrations.report_repository` 负责自动初始化 `interview_reports`、`interview_report_items` 和 `interview_report_reads`，最终 markdown 与结构化 report JSON 以 DB 为持久化真源，不应写入 checkpoint DB。
- Redis 由 `REDIS_URL` 及超时配置控制，用于异步 answer evaluation task/status/result，以及 report-generation task/status/manifest/read notification 状态；worker 和 enqueue/read 逻辑必须保持 Redis-compatible store 边界。当前 report-generation Redis 基础层已落地在 `app.integrations.redis_report_generation_store`，使用 `report-generation:pending` 和 `interview:{interviewId}:report:*` key 空间；`app.domain.report_generation_enqueue` 负责构造 report-generation task，`process_user_reply` 在面试完成时 seal evaluation manifest、enqueue report task，并向前端返回“报告生成中”的短提示。report-generation worker 会先读取 answer-evaluation manifest/results/tasks，未完成时不生成 partial report，有 failed evaluation task 时标记 report failed，DB 写入成功后才更新 Redis succeeded manifest。
- Milvus 由 `MILVUS_ADDRESS` 和 embedding 配置驱动；默认 hash embedding 允许无 key 启动，真实 provider embedding 必须与 collection dimension 匹配。
- 模型 provider 默认 `mock`，真实 follow-up / evaluation 生成通过 OpenAI-compatible LangChain factory；模型失败应保留 deterministic fallback，不应让本地无 key 开发流程崩溃。

## Coding Boundaries

- 开始任何 `../my-first-agent-langgraph` 代码或逻辑改动前，先加载本 instruction；这是前置步骤，不是收尾检查。
- 新的 interview runtime 能力优先放在 `../my-first-agent-langgraph/src/app/domain`、`graphs`、`schemas` 或 `integrations` 的既有分层中。
- 不要把新的 Python runtime 行为实现回 host repo 的 `src/mastra/**`；Mastra 只接受 rollback blocker、安全、构建或兼容性修复。
- 修改 stream contract、snapshot 字段、artifact shape、evaluation result shape 或 checkpoint state 时，同时检查 `tests/contract/**`、host BFF 代理和前端 SSE 消费逻辑。
- 修改问题规划、RAG、JD 信号或评分逻辑时，优先补充 unit test；修改 provider wiring 或 FastAPI endpoint 时，优先补充 contract/integration test。
- Python 代码遵循 `pyproject.toml`：Python `>=3.12`、Ruff line length 100、pytest `tests`、`pythonpath = ["src"]`。
- 常用验证命令：
  - `.venv\Scripts\pytest`
  - `.venv\Scripts\ruff check .`
  - `.venv\Scripts\uvicorn app.main:app --host 0.0.0.0 --port 8011`
  - `.venv\Scripts\python scripts\run_answer_evaluation_worker.py`

## Shared Governance

- LangGraph runtime 是 host repo 的默认 provider，但 instruction 文件维护在 host repo 的 `.github/instructions/` 下，便于前端、BFF、Mastra rollback 和 Python runtime 共用同一套架构约束。
- 涉及默认 provider、BFF proxy、Docker Compose、E2E harness 或 rollback gate 的改动，需要同时检查本仓库 `.github/instructions/project-architecture.instructions.md` 是否仍准确。
- 涉及 Python runtime 内部模块职责、contract、artifact 或数据流的改动，需要同步检查本文件是否仍准确。

## Required Post-Edit Skill

- 本文件的“Mandatory Pre-Edit Load”是进入 LangGraph runtime 工作前的必做步骤；`project-architecture-sync` 是完成改动后的必做步骤，两者都不能省略。
- 完成 `../my-first-agent-langgraph` runtime 代码改动后，在 host repo 执行 `project-architecture-sync` skill，核对项目级 architecture instruction 与本 LangGraph instruction 是否需要更新。
- 完成核对后，在 host repo 执行 `node .github/hooks/scripts/project-architecture-sync-guard.mjs record`。
- 如果只是修改本 instruction，仍需记录已完成架构核对，避免后续 hook 误判本次架构维护未完成。

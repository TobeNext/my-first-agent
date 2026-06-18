# LangGraph 迁移缺口审计与重新实施计划

日期：2026-06-14

## 1. 审计结论

本文件对照 `PLAN/2026-06-11-langgraph-migration-minimal-verifiable-units-plan.md` 和当前两个仓库的代码状态，统一记录尚未迁移、部分迁移、以及需要重新排序的工作。

核心结论：

- Python LangGraph runtime 已经具备 FastAPI 入口、Mastra-compatible SSE、checkpoint、多轮状态推进、初始化 RAG 基础链路、outcome/RAG artifact 写入基础能力。
- 当前默认 provider 已切到 Python，Docker Compose/BFF/local startup 也已经接线到 Python runtime。
- 但回答阶段的 LLM 能力闭环没有完成：LLM follow-up generation、answer evaluation schema/store/worker/enqueue、wait/read evaluations、final report reducer 都缺失或只是 smoke。
- 当前 `followUpQuestion` 字段存在并被状态机消费，但没有任何 Python 代码负责用 LLM 生成并填充它；实际追问来自 deterministic fallback。
- 当前 Python final report 仍由本地规则分数模板生成，没有接入 Redis 中的异步 LLM 评分结果。
- 当前切默认比能力闭环更早发生，后续计划必须优先补齐 runtime 行为，而不是继续推进下线 Mastra。

## 2. 逐 Unit 对照

状态说明：

- `DONE`：代码和测试/记录已基本落地。
- `PARTIAL`：有代码或接线，但没有满足原验收。
- `MISSING`：未看到对应实现。
- `DEFER`：计划中后置/下线类事项，当前不应继续推进。

| Unit | 原计划主题 | 当前状态 | 证据与缺口 |
| --- | --- | --- | --- |
| 00 | 建立迁移基线 | PARTIAL | 有 `PLAN/fixtures/contracts/unit00-baseline-record.md`，但没有确认 3 组 golden transcript fixture 完整覆盖基础启动、含 JD、flow-test skip。 |
| 01 | 新建独立 LangGraph repo | DONE | `../my-first-agent-langgraph` 已存在，含 `pyproject.toml`、`Dockerfile`、`src/`、`tests/`。 |
| 02 | 沉淀 LangGraph/LangChain/migration-contract skills | DONE | 新 repo 有 `.agents/skills/langgraph`、`langchain`、`migration-contract` 及 references。 |
| 03 | Python 配置和健康检查 | DONE | `src/app/config.py`、`src/app/main.py`、`GET /health` 已存在。 |
| 04 | Mastra-compatible stream request schema | DONE | `src/app/schemas/api.py` 与 `tests/contract/test_mastra_stream_request.py` 已存在。 |
| 05 | Mastra-compatible SSE encoder | DONE | `src/app/sse.py` 固定输出 `toolName: interviewStateManagerTool`，有 contract test。 |
| 06 | Mock stream endpoint | SUPERSEDED | endpoint 已经接入真实 graph，不再只是 mock；早期验收被后续实现覆盖。 |
| 07 | BFF runtime provider 配置 | DONE | 当前 repo 有 `AGENT_RUNTIME_PROVIDER`、`PY_AGENT_BASE_URL`、BFF tests、默认 Python 配置。 |
| 08 | API snapshot schema | DONE | `src/app/schemas/interview_snapshot.py` 与 schema tests 已存在。 |
| 09 | InterviewSessionState schema | DONE | `src/app/schemas/interview_state.py` 与 schema tests 已存在。 |
| 10 | Progress summary 纯函数 | DONE | `build_interview_progress_summary` 已迁移并有 state-machine tests。 |
| 11 | 状态校验和基础 reducer | DONE | 状态查找、推进、完成判断等 helper 已在 `interview_state_machine.py`。 |
| 12 | 规则分类与回答应用 | DONE | `build_rule_evaluation`、`apply_user_reply` 已迁移；当前仍是规则评分。 |
| 13 | LangGraph 最小 graph 壳 | DONE | `src/app/graphs/interview_graph.py` 已有 route/init/process/emit 节点。 |
| 14 | LangGraph checkpoint | DONE | `src/app/integrations/checkpoint_store.py` 与 checkpoint unit test 已存在。 |
| 15 | Structured startup payload 解析 | DONE | `kickoff_recovery.py`、`interview_start.py`、初始化 tests 已存在。 |
| 16 | 初始化 question planner | DONE | `question_planner.py` 已存在并被 initialization pipeline 调用。 |
| 17 | Query builder 和 metadata 规范化 | PARTIAL | `question_query.py` 已存在；未看到独立 `question_metadata.py`，metadata 规范化可能被简化/内联，需要与 TS baseline 对齐。 |
| 18 | Milvus 只读检索 | PARTIAL | `milvus_store.py` 已存在，但 integration smoke 只验证服务可写入，不证明读取现有 `interview_questions` schema 和查询结果等价。 |
| 19 | Embedding | PARTIAL | `embeddings.py` 当前是 deterministic hash embedding，不是与现有向量库真实兼容的 provider embedding。 |
| 20 | RAG retriever 和 hybrid rerank | PARTIAL | `question_retriever.py` 已有召回和 skill rerank；BM25/hybrid trace 当前 `bm25Score=0`，未完整迁移 hybrid rerank。 |
| 21 | 初始化 question generator deterministic 部分 | DONE | `question_generator.py` 已存在，初始化可生成 fallback 问题。 |
| 22 | Question critic | PARTIAL | `question_critic.py` 已存在；需要补充与 TS baseline 的 pass/fail fixture 对齐。 |
| 23 | 真实 initialize_session LangGraph node | PARTIAL | `initialize_session_node` 已在 graph 中调用 pipeline，但没有独立 `graphs/nodes/initialize_session.py`；真实初始化可用，模块边界未按计划拆分。 |
| 24 | Follow-up deterministic fallback | DONE | `build_follow_up_question` 已实现模板 fallback，短流程可无 LLM 跑通。 |
| 25 | LangChain ChatModel factory | MISSING | `pyproject.toml` 未包含 `langchain`/provider 包；未看到 `src/app/integrations/models.py`。 |
| 26 | LLM follow-up generation | MISSING | 没有 Python helper 调模型生成 `AnswerEvaluationResult.followUpQuestion`；当前字段一直由默认 `None` 进入 fallback。 |
| 27 | Answer evaluation schema | MISSING | 未看到 `src/app/schemas/answer_evaluation.py`。 |
| 28 | Redis evaluation store | MISSING | 未看到 `src/app/integrations/redis_evaluation_store.py`；现有 Redis smoke 只是 SET/GET。 |
| 29 | Python answer evaluation worker | MISSING | 未看到 `src/app/workers/answer_evaluation_worker.py`。 |
| 30 | 主 graph 接入异步评分 enqueue | MISSING | `process_user_reply_node` 没有 Redis enqueue；只调用规则评价和 artifact update。 |
| 31 | Wait/read evaluations | MISSING | 未看到 `evaluation_report_reader.py` 或等价 wait/read 逻辑。 |
| 32 | Final report reducer | MISSING | 当前 `finalize_interview` 直接用本地 state 渲染模板报告，没有 Redis LLM result 覆盖。 |
| 33 | Outcome writer | DONE | `interview_outcome.py` 已存在并在 initialize/process 阶段写入/更新。 |
| 34 | RAG recall sample writer | DONE | `rag_recall_sample.py` 已存在并在 initialize/process 阶段写入/更新。 |
| 35 | 真实 process_user_reply node | PARTIAL | `graphs/nodes/process_user_reply.py` 已存在，但缺少 enqueue 和 LLM evaluation 集成。 |
| 36 | 完整短流程 golden test | PARTIAL | `tests/integration/test_interview_short_flow.py` 已存在，但使用规则/fallback，不覆盖 LLM、Redis evaluation flow。 |
| 37 | 真实依赖 integration smoke | PARTIAL | `test_runtime_dependencies_smoke.py` 验证 Milvus/Redis 基础连通，不验证真实召回、enqueue、worker。 |
| 38 | Docker Compose 接入新 repo | DONE | 当前 `docker-compose.yml` 已包含 `python-agent`，BFF 指向 Python。 |
| 39 | Provider=python 前端 smoke | PARTIAL | 有默认 provider 和 E2E 支持文件；需要保留可复现 smoke 记录或 Playwright 结果。 |
| 40 | Provider=python E2E smoke | PARTIAL | 有 provider runner 和 E2E env 支持；需要确认 Python provider smoke 当前通过。 |
| 41 | Provider=python complete flow E2E | PARTIAL | 有 complete flow 路径意图，但 Python 缺 Redis/LLM final report reducer，完整等价 flow 不成立。 |
| 42 | 双运行回滚演练 | PARTIAL | 有 `scripts/run-provider-rollback-smoke.ps1` 和文档；需要实际运行记录。 |
| 43 | 默认 provider 切到 Python | DONE-BUT-RISKY | 当前默认已是 Python；由于 Unit 25-32 缺失，这个状态存在能力不等价风险。 |
| 44 | 冻结 Mastra runtime 新功能 | DONE | README/AGENTS 已标明新功能进入 LangGraph repo，Mastra 仅保留 rollback。 |
| 45 | 下线 Mastra runtime | DEFER | 不应推进，直到 Unit 25-32、40-42 全部完成并验证。 |

## 3. 统一未迁移清单

以下是需要统一补齐的真实缺口，按实现依赖排序：

1. 真实模型接入基础
   - 新增 `src/app/integrations/models.py`。
   - 增加 LangChain 和当前 OpenAI-compatible/Zhipu provider 依赖。
   - 支持 mock model、timeout、retry、temperature、无 key 启动。

2. LLM 追问生成
   - 新增 Python 版 follow-up prompt builder。
   - 普通回答时生成 structured `{"followUpQuestion": "..."}`。
   - 把结果填入 `AnswerEvaluationResult.followUpQuestion`。
   - LLM 失败、空输出、非法 JSON 时回落 deterministic fallback。

3. Answer evaluation schema
   - 迁移 TS `answer-evaluation-schemas.ts` 到 `src/app/schemas/answer_evaluation.py`。
   - 保持 classification、score、strengths、missingPoints、incorrectPoints、recommendedIntent、followUpQuestion 等字段兼容。

4. Redis evaluation store
   - 迁移 key layout、manifest、pending queue、status、result、seal、wait/read。
   - 用 fake Redis 单测覆盖 enqueue、claim、retry、mark succeeded/failed、seal、wait/read。

5. Python answer evaluation worker
   - 实现 worker loop。
   - 使用 LangChain structured output 调评分模型。
   - 写入与 TS worker 兼容的 result。
   - structured output 校验失败进入 retry/failed。

6. Process reply 接入异步评分
   - `process_user_reply_node` 在真实用户回答后 fire-and-forget enqueue。
   - Redis 不可用时记录日志但不阻塞面试。
   - flow-test skip 不写真实评分任务。

7. Wait/read evaluations 与 final report reducer
   - 面试结束时 seal manifest。
   - 等待全部 expected task 完成。
   - failed/timeout 不返回 partial report。
   - 用 Redis LLM result 覆盖本地规则评分，重算 node summary 和 final report。

8. RAG/embedding 等价性补强
   - 替换 hash embedding 或明确其只是 fallback。
   - 验证 384 维 provider embedding 能检索现有 Milvus collection。
   - 补齐 BM25/hybrid rerank 或把当前简化行为标为临时 fallback。
   - 补充 metadata normalize 与 TS fixture 对齐。

9. Golden/E2E 证明
   - 补齐 3 组 golden transcript fixtures。
   - Provider=python smoke 和 complete flow E2E 必须实际跑通并记录。
   - 双 provider rollback smoke 必须实际跑通并记录。

10. 切默认风险收敛
    - 保留当前 Python 默认，但在文档中标注 LLM/evaluation 缺口。
    - 在 Unit 25-32 完成前，不推进 Unit 45 下线 Mastra。

## 4. 重新实施计划

### Phase A：冻结现状与补齐测试基线

目标：先阻止“默认已切 Python = 迁移已完成”的误判。

任务：

- A1. 在新 repo README 或当前 cutover 文档中标明 Python provider 当前 LLM/evaluation 缺口。
- A2. 补齐 Unit 00 三组 golden transcript fixtures。
- A3. 为当前 deterministic short flow 固化 baseline，说明它不覆盖 LLM evaluation。

验收：

- 运行 Python `pytest`。
- 当前文档能清楚区分 `runtime wiring complete` 和 `behavior parity complete`。

执行记录（2026-06-15）：

- DONE A1：在 `../my-first-agent-langgraph/README.md` 和 `docs/RUNTIME_PROVIDER_CUTOVER.md`
  明确标注 Python provider 当前仅代表 runtime wiring complete，LLM follow-up、
  Redis async evaluation、worker、final report reducer 和 RAG/embedding parity 仍未闭环。
- DONE A2：保留并确认三组 Unit 00 golden transcript fixtures：
  `unit00-basic-start.json`、`unit00-start-with-jd.json`、`unit00-flow-test-skip.json`。
- DONE A3：新增 `../my-first-agent-langgraph/tests/contract/test_unit00_golden_transcripts.py`，
  自动加载三组 fixture，验证启动 snapshot，并验证第一条用户回复进入当前 deterministic
  follow-up baseline；`PLAN/fixtures/contracts/unit00-baseline-record.md` 已记录该 baseline
  不覆盖 LLM evaluation。
- 验证：`python -m pytest tests/contract/test_unit00_golden_transcripts.py` 通过；`python -m pytest`
  通过（35 passed, 1 skipped）。

### Phase B：模型工厂与 LLM 追问

目标：完成 Unit 25-26。

任务：

- B1. 新增 `integrations/models.py`，接入 LangChain ChatModel factory。
- B2. 新增 follow-up generation helper，复刻 Mastra `ensureGeneratedFollowUpQuestion` 行为。
- B3. 修改 `process_user_reply_node` 或新增 answer analysis helper，让普通回答先得到带 `followUpQuestion` 的 evaluation。
- B4. 补 mock LLM 成功、空输出、非法 JSON、异常 fallback 单测。

验收：

- LLM 生成的问题被写入 `FollowUpState.question`。
- LLM 失败时 deterministic fallback 与当前行为一致。

执行记录（2026-06-15）：

- DONE B1：新增 `../my-first-agent-langgraph/src/app/integrations/models.py`，
  支持 `MODEL_PROVIDER=mock`、OpenAI-compatible provider、Zhipu/OpenAI-compatible
  base URL、timeout、retry、temperature、无 key 启动 fallback；根 `.env.example`、
  Python `.env.example` 和 Docker Compose 已补充/透传对应模型环境变量。
- DONE B2：新增 `../my-first-agent-langgraph/src/app/domain/follow_up_generation.py`，
  复刻 Mastra `ensureGeneratedFollowUpQuestion` 的生成门槛、prompt、Pydantic
  structured output 校验，以及空输出/非法 JSON/异常 fallback。
- DONE B3：`process_user_reply_node` 在规则评价后尝试填充
  `AnswerEvaluationResult.followUpQuestion`；状态机继续通过既有
  `generated_question` 路径写入 `FollowUpState.question`。
- DONE B4：新增 `test_follow_up_generation.py`、`test_models.py`，并扩展
  `test_interview_graph.py`，覆盖 mock LLM 成功、raw fenced JSON、空输出、
  非法 JSON、异常 fallback，以及 graph 层 LLM 追问落入下一条 follow-up。
- 验证：`python -m pip install -e ".[dev]"` 成功；真实 provider 分支可构造
  `ChatOpenAI` 并支持 structured output；`python -m pytest` 通过（43 passed,
  1 skipped）；`docker compose config --quiet` 通过。

### Phase C：异步评分数据契约

目标：完成 Unit 27-28。

任务：

- C1. 迁移 answer evaluation Pydantic schema。
- C2. 实现 Redis evaluation store。
- C3. 增加 TS fixture 兼容测试，证明 Python 可读写旧 key/result shape。

验收：

- fake Redis 单测覆盖完整状态转换。
- Python dump 与 TS result key/type 一致。

执行记录（2026-06-15）：

- DONE C1：新增 `../my-first-agent-langgraph/src/app/schemas/answer_evaluation.py`，
  迁移 TS `answer-evaluation-schemas.ts` 的 task、status、LLM result、manifest
  Pydantic schema，保留 schemaVersion=1、camelCase 字段、literal union 和默认数组。
- DONE C2：新增 `../my-first-agent-langgraph/src/app/integrations/redis_evaluation_store.py`，
  保持 TS key layout：`answer-evaluation:pending`、
  `answer-evaluation:task-interview:{taskId}`、
  `interview:{interviewId}:evaluation:{manifest|tasks|task|status|result}`。
  已实现 enqueue、claim、mark running/succeeded/failed、retry、seal、read task/status/
  manifest/results。
- DONE C3：新增 `test_answer_evaluation_schema.py` 和 `test_redis_evaluation_store.py`。
  fake Redis 单测覆盖完整状态转换，并直接断言原始 Redis key/value JSON shape
  与 TS store contract 一致。
- 验证：限定 Phase C 文件 `ruff check` 通过；`python -m pytest` 通过（52 passed,
  1 skipped）。

### Phase D：Worker 与主 graph enqueue

目标：完成 Unit 29-30。

任务：

- D1. 实现 Python answer evaluation worker。
- D2. process reply 后 enqueue answer evaluation task。
- D3. Redis 不可用、flow-test skip、重复调用等路径不阻塞面试。

验收：

- enqueue -> claim -> model evaluate -> mark succeeded smoke 通过。
- Redis 失败时用户仍收到下一题/追问。

执行记录（2026-06-15）：

- DONE D1：新增 `../my-first-agent-langgraph/src/app/workers/answer_evaluation_worker.py`
  和 `scripts/run_answer_evaluation_worker.py`。Worker 支持 prompt builder、Pydantic
  structured output、固定 weightedTotal 公式、`run_once`、`run_forever`、默认 3 次重试、
  succeeded/retrying/failed tick result。
- DONE D2：新增 `../my-first-agent-langgraph/src/app/domain/answer_evaluation_enqueue.py`，
  从 `before_state`/`after_state` 找新增 scored answer attempt，构造 TS 兼容
  `AnswerEvaluationTask`，并在 `process_user_reply_node` 真实用户回答后 best-effort enqueue。
- DONE D3：新增 `../my-first-agent-langgraph/src/app/integrations/redis_client.py`，
  接真实 `redis.asyncio` client；Redis connect/socket timeout 默认 0.2s，Redis 不可用时
  enqueue 只记录 warning，不阻塞面试。flow-test skip 不写真实评分任务。
- 测试覆盖：`test_answer_evaluation_enqueue.py` 覆盖 task snapshot、detour/control skip、
  injected store enqueue、store failure safe path；`test_answer_evaluation_worker.py` 覆盖
  prompt、weighted total、claim->evaluate->succeeded、retry 后成功、maxAttempts failed、
  no-task；`test_interview_graph.py` 覆盖主 graph enqueue 与 flow-test skip 不 enqueue。
- 验证：`python -m pip install -e ".[dev]"` 成功并安装 `redis==8.0.0`；
  `python -m ruff check src/app tests scripts/run_answer_evaluation_worker.py` 通过；
  `python -m pytest` 通过（64 passed, 1 skipped）；`docker compose config --quiet` 通过。

### Phase E：最终报告等价闭环

目标：完成 Unit 31-32。

任务：

- E1. 实现 wait/read evaluations。
- E2. 面试结束时 seal manifest 并等待完整 result。
- E3. 实现 final report reducer，用 LLM result 覆盖规则评分并重算 summary/report。
- E4. failed/timeout 不展示 partial report。

验收：

- complete、failed、timeout fixtures 通过。
- final snapshot 中 `finalReportReady` 只在完整 evaluation dataset 可用时为 true。

执行记录（2026-06-15）：

- DONE E1：新增 `../my-first-agent-langgraph/src/app/domain/evaluation_report_reader.py`，
  实现 wait/read evaluations：manifest-missing、not-sealed、pending、failed、timeout
  阻塞原因；按 manifest.expectedTaskIds 顺序返回完整 evaluations；不返回 partial data；
  manifest thread mismatch 直接报错。
- DONE E2：`process_user_reply_node` 在本地状态机完成面试后调用
  `complete_final_report_with_async_evaluations`，先检查 expected task 数、seal manifest，
  再等待完整 result；pending/failed/timeout 会把 state 回退到 wrap-up pending，且
  `finalReportReady=false`、`finalReport=null`。
- DONE E3：`interview_state_machine.py` 新增 `build_final_interview_state_from_evaluations`，
  以 Redis LLM result 覆盖 answer attempt classification/score/strengths/missing/
  incorrect points，重算 node summary 和 final report。
- DONE E4：`test_interview_short_flow.py` 已从“无 worker 也返回规则报告”改为 Phase E
  baseline：普通短流程完成题目后等待异步评分，artifact 不展示 partial final report。
- 测试覆盖：`test_evaluation_report_reader.py` 覆盖 complete order、partial pending、
  failed、manifest missing、thread mismatch；`test_final_report_completion.py` 覆盖 complete、
  failed、pending；`test_interview_state_machine.py` 覆盖 LLM result reducer。
- 验证：`python -m ruff check src/app tests scripts/run_answer_evaluation_worker.py` 通过；
  `python -m pytest` 通过（72 passed, 1 skipped）。

### Phase F：RAG 与真实依赖等价性

目标：补齐 Unit 17-20、22、37 的未验证部分。

任务：

- F1. 补 metadata normalize parity tests。
- F2. 接真实 provider embedding，hash embedding 降为 fallback。
- F3. 补 Milvus existing collection read smoke。
- F4. 补 hybrid rerank/BM25 等价或文档化临时差异。
- F5. 补 question critic TS baseline fixtures。

验收：

- 有 Milvus/embedding 时召回真实候选。
- 无依赖时 fallback 仍通过。

执行记录（2026-06-15）：

- DONE F1：新增 `../my-first-agent-langgraph/src/app/domain/question_metadata.py`
  和 `tests/unit/test_question_metadata.py`，按 Mastra `interview-question-metadata.ts`
  覆盖 skillArea 规则、legacy metadata 清理、显式 skillArea 优先、audit 计数。
- DONE F2：`embeddings.py` 新增 embedding provider 工厂；默认
  `EMBEDDING_PROVIDER=hash` 保留 384 维 deterministic fallback，配置
  OpenAI-compatible provider 和 key 时使用 `langchain_openai.OpenAIEmbeddings`。
  根 `.env.example`、Python `.env.example`、Docker Compose 已补环境变量。
- DONE F3：`test_runtime_dependencies_smoke.py` 新增现有
  `interview_questions` collection 只读 smoke；依赖 smoke 仍受
  `RUN_RUNTIME_DEPENDENCY_SMOKE=1` 门控，collection 不存在时 skip。
- DONE F4：`question_retriever.py` 迁移 TS hybrid rerank 权重与 trace 字段；
  `bm25Score` 保留兼容字段名，但当前等价对象是 skillArea match score，
  不是真正 lexical BM25，差异已写入 README/cutover 文档。
- DONE F5：新增 `tests/unit/test_question_critic.py`，覆盖 TS baseline 的
  scenario shape mismatch、duplicate question、project shape mismatch fallback；
  同步修正无 plan 专业题 fallback 文案。
- 验证：`python -m ruff check src/app tests scripts/run_answer_evaluation_worker.py`
  通过；`python -m pytest` 通过（82 passed, 2 skipped）。

### Phase G：Provider smoke、complete flow、rollback

目标：完成 Unit 39-42，并为默认 Python 提供可信证明。

任务：

- G1. 跑 provider=python 前端 smoke，记录结果。
- G2. 跑 provider=python complete flow E2E。
- G3. 跑 provider=python -> provider=mastra rollback smoke。
- G4. 失败项回写到本计划或 cutover 文档。

验收：

- Python 和 Mastra provider 都能通过 smoke。
- Python complete flow 能生成 outcome、final report、feedback 兼容结果。

执行记录（2026-06-15）：

- DONE G1：本地启动 Python runtime、BFF、frontend 后运行
  `npm run test:e2e:interview:smoke:python`，通过（2 files / 2 tests）。
- DONE G2：为无 Docker/无本机 Redis 环境新增
  `scripts/run-e2e-redis-fake.mjs`，提供 E2E 所需的最小 Redis-compatible
  `GET/SET/RPUSH/LPOP/SADD/SMEMBERS` 与 RESP3 handshake；启动 Python
  answer evaluation worker 后运行 `npm run test:e2e:interview:complete:python`，
  通过（2 files / 2 tests），final report ready、outcome artifact 和 feedback
  写回均通过断言。随后运行 `npm run test:e2e:interview:python`，通过
  （5 files / 8 tests）。
- DONE G3：Docker 版 `docker compose up -d --build` / rollback smoke 当前环境
  阻塞，原因是 Docker Desktop daemon 未运行：
  `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`。
  已执行本地等价切换验证：BFF 切回 `AGENT_RUNTIME_PROVIDER=mastra`，启动
  Mastra dev server 后运行 `npm run test:e2e:interview:smoke:mastra`，通过
  （2 files / 2 tests）。因此 provider 双运行 smoke 在本地进程模式下通过，
  Docker rollback smoke 需在 Docker Desktop 可用环境补跑。
- DONE G4：同步修正 `e2e/interview-edge-scenarios.test.ts`，将过时的
  “非标准英文简历应失败”断言更新为当前 BFF parser contract：兼容接受并返回
  3 个技能组；Docker rollback 环境阻塞已记录在本计划与 cutover 文档。

### Phase H：下线前门禁

目标：只在行为等价后再考虑 Unit 45。

门禁：

- Unit 25-32 全部 DONE。
- Unit 39-42 全部 DONE。
- 当前 repo 和新 repo 测试通过。
- Mastra rollback smoke 最近一次通过。

未满足以上门禁前，Unit 45 保持 `DEFER`。

## 5. 近期优先级

立即优先级：

1. Phase B：模型工厂与 LLM 追问。
2. Phase C：answer evaluation schema/store。
3. Phase D：worker 和 enqueue。
4. Phase E：wait/read 与 final report reducer。

原因：

- 这些是 Mastra 旧运行时和 Python 当前运行时之间最大的行为差异。
- 它们直接影响模拟面试质量、评分可信度、最终报告完整性。
- 当前默认 provider 已是 Python，越早补齐越能降低切流风险。

## 6. 明确不做

- 不把主流程改回 LangChain AgentExecutor。
- 不让 LLM 直接决定面试状态迁移。
- 不改 SSE `toolName: interviewStateManagerTool` 兼容契约。
- 不在 Unit 25-32 完成前下线 Mastra runtime。

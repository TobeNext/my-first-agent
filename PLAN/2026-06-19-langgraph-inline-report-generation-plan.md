# LangGraph Inline Report Generation Plan

## 背景

当前 Python LangGraph runtime 的面试结束报告链路依赖两个外部 worker：

```text
面试结束
-> enqueue answer-evaluation task
-> scripts/run_answer_evaluation_worker.py 消费评分任务
-> enqueue report-generation task
-> scripts/run_report_generation_worker.py 消费报告任务
-> 写 interview_reports.db
```

这会导致本地只启动 `npm run start:local` 时，面试已经进入 `wrap-up`，Redis 中也已经有 evaluation/report pending task，但因为 worker 没启动，最终 markdown 报告一直无法生成。

用户目标不是通过额外启动 worker 补齐流程，而是把报告生成作为 LangGraph 面试图的一条正式条件链路，由 LangGraph 在面试结束后完成：

```text
面试结束
-> evaluate_answers_node
-> generate_report_node
-> persist_report_node
-> completed
```

不新增 `report_reviewer_agent`。第一版保持与原 worker 逻辑最接近，只把执行位置从外部 Redis worker 移入 LangGraph 条件分支。

本计划更新后的明确约束：当前报告生成主流程不再使用 Redis，因此需要删除 LangGraph runtime 中与 answer evaluation / report generation Redis 队列、worker、enqueue 相关的主流程代码与测试引用。Redis 不再作为报告生成依据、中转或状态真源。

## 目标方案

### 目标行为

1. 用户回答完最后一题后，LangGraph 判断面试完成。
2. 主图进入报告生成条件分支。
3. `evaluate_answers_node` 对当前 session 中所有 answer attempts 批量生成结构化评分结果。
4. `generate_report_node` 复用现有 report prompt/schema 生成最终 markdown 与结构化 report output。
5. `persist_report_node` 写入 `interview_reports.db`。
6. 成功后 session 进入 `completed`，`finalReportReady = true`。
7. 前端 bell 在面试结束后短轮询 `/report/status`。
8. Report status API 只查 `interview_reports.db`。
9. 查到 succeeded report 后，bell 自动变为 ready 并允许下载 markdown。
10. 不再需要手动启动 `scripts/run_answer_evaluation_worker.py` 或 `scripts/run_report_generation_worker.py` 才能完成主流程报告生成。

### 非目标

- 第一版不新增 `report_reviewer_agent`。
- 第一版沿用现有 bell 交互模型：面试结束后前端短轮询 `/report/status`，status API 查 DB。
- 第一版不引入 LangGraph Platform 或外部 durable run 服务。
- 第一版不把完整 markdown 塞回聊天消息，报告仍以 DB/API 为真源。

### 删除目标

需要从默认 LangGraph runtime 中删除或彻底断开：

- `answer-evaluation:pending` Redis queue 依赖。
- `report-generation:pending` Redis queue 依赖。
- `RedisAnswerEvaluationStore` / `RedisReportGenerationStore` 的主流程引用。
- `scripts/run_answer_evaluation_worker.py`。
- `scripts/run_report_generation_worker.py`。
- `src/app/workers/answer_evaluation_worker.py`。
- `src/app/workers/report_generation_worker.py`。
- `src/app/domain/answer_evaluation_enqueue.py`。
- `src/app/domain/report_generation_enqueue.py`。
- 与上述 Redis worker/queue 专属行为绑定的单元测试。

`AnswerEvaluationTask` 语义绑定 Redis 异步任务队列，脱离 Redis 后不再适合作为内部上下文模型，需要删除。新同步流程应使用新的内部模型，例如 `AnswerEvaluationContext`，用于表达“某次回答评分所需的题目、回答、参考答案和节点上下文”。`LlmAnswerEvaluationResult`、`ReportGenerationOutput`、`InterviewReportWrite` 如不绑定 Redis task 语义，可以继续保留。

## 当前链路参考

LangGraph runtime 位于：

```text
../my-first-agent-langgraph
```

重点文件：

- `src/app/graphs/interview_graph.py`
  - 当前主图入口。
  - 需要新增面试结束后的条件分支。

- `src/app/graphs/nodes/process_user_reply.py`
  - 当前答题推进节点。
  - 当前在面试结束时 seal evaluation manifest 并 enqueue report task。
  - 改造后删除 seal/enqueue 逻辑，面试结束只进入 `wrap-up`，由主图条件分支继续生成报告。

- `src/app/workers/answer_evaluation_worker.py`
  - 只作为迁移参考。
  - 迁移完成后删除。

- `src/app/workers/report_generation_worker.py`
  - 只作为迁移参考。
  - 迁移完成后删除。

- `src/app/domain/report_generation.py`
  - 现有报告 prompt 和模型生成能力。

- `src/app/integrations/report_repository.py`
  - 报告 DB 写入真源。

- `src/app/domain/report_status.py`
  - report status API 的 DB-only 查询逻辑。

## 设计原则

1. LangGraph 主图拥有报告生成流程，不依赖外部 worker 才能完成。
2. 每个任务控制在约 200 行代码改动以内，方便逐步验收。
3. 删除 Redis worker/enqueue 主流程与相关死代码，避免继续误导本地启动和报告状态判断。
4. 复用已有 schema、prompt、repository，避免重写评分/报告模型 contract。
5. `persist_report_node` 成功写 DB 后，report status API 才能返回 ready。
6. 模型失败不重试；记录失败状态与错误原因，不写 succeeded report。
7. 删除 Redis store 前必须审计非报告功能是否仍有 Redis 依赖，避免误删其他业务。
8. 报告状态和结果以 DB 为唯一真源，status API 不读 Redis，也不依赖 checkpoint 判断成功态。

## 建议实施顺序

### 1. 抽取 answer evaluation 可同步调用的 domain service

状态：已完成（2026-06-20）。已新增 `src/app/domain/answer_evaluation_runtime.py`，用 `AnswerEvaluationContext` 从 session answer attempts 构造同步评分上下文，并提供批量 evaluation runtime；对应单测覆盖 context 构造、fake evaluator 批量返回和无 Redis 依赖。

预计改动：约 150-200 行。

目标：把 `answer_evaluation_worker.py` 中“给单次回答调模型并返回 `LlmAnswerEvaluationResult`”的核心逻辑迁移到 domain/service，供 LangGraph node 同步调用。迁移后 worker 文件和 `AnswerEvaluationTask` schema 会在后续步骤删除。

建议新增/修改：

- 新增 `src/app/domain/answer_evaluation_runtime.py`
  - `AnswerEvaluationContext`
  - `build_answer_evaluation_contexts_from_state(state, resource_id)`
  - `evaluate_answer_context(context)`
  - `evaluate_answer_contexts(contexts)`
  - 模型失败时返回可控失败结果或抛出可被 graph node 捕获的异常。

验收标准：

- 不接主图。
- 单测覆盖从 session answer attempts 构造 evaluation contexts。
- 单测覆盖 fake evaluator 批量返回 results。
- 新 service 不依赖 Redis。
- 不再新增或复用 `AnswerEvaluationTask`。

### 2. 抽取 report generation 可同步调用的 domain service

状态：已完成（2026-06-20）。已新增 `src/app/domain/report_generation_runtime.py`，复用现有 report prompt/schema 生成 `ReportGenerationOutput`，并构造可写入 `InterviewReportRepository` 的 `InterviewReportWrite`；对应单测覆盖 fake evaluation results 生成报告和 DB write payload 构造。

预计改动：约 150-200 行。

目标：把 `report_generation_worker.py` 中“根据 evaluation tasks/results 生成 report output 并构造 DB write payload”的核心逻辑迁移到可复用 service。迁移后 worker 文件会在后续步骤删除。

建议新增/修改：

- 新增 `src/app/domain/report_generation_runtime.py`
  - `build_report_prompt_from_session(...)`
  - `generate_report_from_evaluations(...)`
  - `build_report_write_from_output(...)`

验收标准：

- 不接主图。
- 单测用 fake evaluation results 生成 `ReportGenerationOutput`。
- 单测验证构造出的 `InterviewReportWrite` 可被 repository 接收。
- 新 service 不依赖 Redis。

### 3. 新增 report graph nodes，但暂不接入主图条件分支

状态：已完成（2026-06-20）。已新增 `src/app/graphs/nodes/report_generation.py`，提供 `evaluate_answers_node`、`generate_report_node` 和 `persist_report_node`；node 单测用 fake session/evaluator/temp DB 验证 state 写入、report output 和 succeeded report persistence。

预计改动：约 120-180 行。

目标：在 `src/app/graphs/nodes` 下新增三个 LangGraph node 的纯函数实现。

建议新增：

- `src/app/graphs/nodes/report_generation.py`
  - `evaluate_answers_node(state)`
  - `generate_report_node(state)`
  - `persist_report_node(state)`

建议状态字段：

```python
evaluation_results: list[dict[str, Any]]
evaluation_tasks: list[dict[str, Any]]
report_output: dict[str, Any] | None
report_id: str | None
report_status: str | None
report_error: str | None
report_markdown_available: bool
```

验收标准：

- 只测试 node，不改 graph route。
- fake session + fake evaluator + temp DB 可完成：
  - evaluation results 写入 graph state
  - report output 写入 graph state
  - DB 中出现 succeeded report

### 4. 改造 `interview_graph.py`，新增面试结束后的条件链路

状态：已完成（2026-06-20）。`interview_graph.py` 已接入 `evaluate_answers -> generate_report -> persist_report -> emit_snapshot` 条件链路；`route_after_reply_node` 在 `session.phase == "wrap-up"` 且 `finalReportReady == false` 时触发内联报告生成，初始化和普通答题推进不会触发该分支。

预计改动：约 120-180 行。

目标：把报告生成节点接入主图。

当前：

```text
START
-> route_action
-> initialize_session / process_user_reply
-> emit_snapshot
-> END
```

目标：

```text
START
-> route_action
-> initialize_session / process_user_reply
-> route_after_reply
   -> emit_snapshot
   -> evaluate_answers
      -> generate_report
      -> persist_report
      -> emit_snapshot
-> END
```

建议条件：

```python
session.phase == "wrap-up" and not session.finalReportReady
```

验收标准：

- 初始化不触发报告生成。
- 普通答题推进不触发报告生成。
- 最后一题完成后触发三段 report nodes。
- graph 最终 snapshot：
  - `phase == "completed"`
  - `finalReportReady is True`

### 5. 改造 `process_user_reply.py`，删除主流程 Redis enqueue

状态：已完成（2026-06-20）。`process_user_reply.py` 已删除主流程 Redis enqueue/seal/report task 逻辑；面试结束时只把 completed/final report 状态转换为 `wrap-up` 和 `finalReportReady=false`，交由 LangGraph 主图条件分支继续生成报告。

预计改动：约 80-150 行。

目标：面试完成时不再 seal/enqueue 外部 evaluation/report task。

建议处理：

- 删除 `_seal_and_enqueue_report_generation(...)` 在主流程中的调用。
- 删除 answer evaluation enqueue 的主流程 hook。
- 面试结束时只把 session 推到 `wrap-up`，让 graph 条件分支接手。

验收标准：

- 不启动 Redis worker 时，完整面试仍能生成 DB report。
- Redis 不可用时，主流程报告生成仍可完成。
- 原 flow-test skip 行为不被破坏。

### 6. 改造 report status，只读取 DB；前端短轮询

状态：已完成（2026-06-20）。`report_status.py` 和 report API 已改为只读取 `interview_reports.db` / read receipt：DB 有 succeeded markdown 返回 ready，DB 有 failed report 返回 failed，DB 无 report 返回 generating/pending；前端/BFF E2E 支撑已改为 DB-backed status 和 markdown 下载。

预计改动：约 120-200 行。

目标：status API 不再读取 Redis report manifest、evaluation manifest 或 checkpoint。报告是否生成以 `interview_reports.db` 为唯一真源；前端在面试结束后短轮询 `/report/status`，直到 DB 中出现 succeeded/failed report。

建议逻辑：

1. DB 有 succeeded report 且 markdown 非空：
   - `status = succeeded`
   - `markdownAvailable = true`

2. DB 有 failed report：
   - `status = failed`
   - `markdownAvailable = false`
   - 返回 `lastError`

3. DB 没有 report：
   - `status = pending` 或 `running`
   - `markdownAvailable = false`

验收标准：

- 面试结束后前端 bell 每隔几秒调用 `/report/status`。
- `/report/markdown` 仍只从 DB 读 markdown。
- 没有 Redis 时 report status 不直接 500。
- status API 通过 DB 判断 succeeded/failed/pending。
- 查到 succeeded report 后 bell 自动变 ready。

### 7. 删除 Redis worker/enqueue 代码与测试引用

状态：已完成（2026-06-20）。已删除 Python runtime 的 answer/report Redis worker、enqueue、store/client glue、Redis task schema 与绑定测试；同步 report runtime 改为使用 `ReportGenerationContext`；`python -m ruff check src tests scripts`、`python -m pytest tests\unit -q`、`python -m pytest tests\integration\test_report_api.py tests\integration\test_runtime_dependencies_smoke.py -q` 通过，其中 runtime dependency smoke 按环境变量跳过 Milvus 用例。

预计改动：约 150-200 行。

目标：清理已经不属于当前方案的 Redis 异步评分/报告代码，避免后续误用。

建议删除：

- `src/app/workers/answer_evaluation_worker.py`
- `src/app/workers/report_generation_worker.py`
- `scripts/run_answer_evaluation_worker.py`
- `scripts/run_report_generation_worker.py`
- `src/app/domain/answer_evaluation_enqueue.py`
- `src/app/domain/report_generation_enqueue.py`
- `src/app/integrations/redis_evaluation_store.py`
- `src/app/integrations/redis_report_generation_store.py`
- `src/app/integrations/redis_client.py` 中仅服务上述 store 的 factory。
- `AnswerEvaluationTask` schema 及其 Redis task 语义相关字段。

建议同步删除/改写：

- `tests/unit/test_answer_evaluation_worker.py`
- `tests/unit/test_report_generation_worker.py`
- `tests/unit/test_redis_evaluation_store.py`
- `tests/unit/test_redis_report_generation_store.py`
- `tests/unit/test_report_generation_enqueue.py`
- 与 Redis evaluation/report manifest 强绑定的 report status 测试。
- 与 `AnswerEvaluationTask` 直接绑定的 schema 测试。

验收标准：

- `rg "redis_evaluation|redis_report_generation|answer-evaluation:pending|report-generation:pending|run_answer_evaluation_worker|run_report_generation_worker" src tests scripts` 无主流程引用。
- Python unit tests 不再依赖 Redis worker/store。
- 如仍保留 Redis 用于其他非报告能力，必须明确其用途并避免混入报告链路。
- 删除前必须执行依赖审计：

```powershell
rg "Redis|create_redis|redis_" src tests scripts
rg "AnswerEvaluationTask|answer-evaluation|report-generation" src tests scripts
```

### 8. 补充端到端级别的 Python 测试

状态：已完成（2026-06-20）。新增 `tests/integration/test_interview_inline_report_generation.py`，使用临时 checkpoint DB 和临时 report DB，通过真实 LangGraph 报告条件分支验证最后一答后可内联生成并持久化 markdown report；测试明确断言无需 Redis settings/worker。`python -m pytest tests\unit -q`、`python -m pytest tests\integration\test_report_api.py tests\integration\test_interview_inline_report_generation.py -q`、`python -m ruff check src tests scripts` 通过。

预计改动：约 150-200 行。

目标：证明“不启动 worker，只跑 LangGraph 主图”也能完成报告生成。

建议新增/修改：

- `tests/unit/test_interview_graph.py`
  - mock evaluator/model/repository，验证 graph 完成后 `finalReportReady=True`。

- `tests/integration/test_interview_inline_report_generation.py`
  - 使用 temp SQLite report DB。
  - 不启动 Redis。
  - 完整短流程推进到 completed。
  - 查询 report DB 有 markdown。

验收标准：

- `python -m pytest tests/unit -q`
- report API integration tests 通过。
- 新 integration test 明确断言无需 Redis/worker。

### 9. 本地真实流程验证与文档更新

状态：已完成（2026-06-20）。已更新 host README、`docs/RUNTIME_PROVIDER_CUTOVER.md`、`.github/instructions/project-architecture.instructions.md` 和 E2E complete flow，默认 Python provider 文档明确报告由 LangGraph 内联生成、report status/markdown/read 以 report DB 为真源，Redis/worker 仅属于 legacy Mastra rollback 背景。已用隐藏后台服务启动 Python Agent、BFF、Frontend 三个本地服务并运行 `npm run test:e2e:interview:complete:python`，验证完整面试后 `finalReportReady=true`、BFF report status ready、markdown 下载、read receipt 和临时 report DB succeeded report/items；未启动 Redis 或 Python answer/report worker，验证后 8011/3000/4173 端口已清理。

预计改动：约 80-150 行。

目标：更新本地启动/架构说明，避免后续继续误以为必须手动启动 worker。

建议修改：

- `../my-first-agent-langgraph/README.md`
  - 删除或改写 answer/report worker 启动说明。
  - 标注报告完成通知使用前端短轮询 report status API。

- `.github/instructions/langgraph-architecture.instructions.md`
  - 更新 Current Responsibilities 与 Persistence 边界：
    - 主流程报告生成由 LangGraph 条件分支完成。
    - Redis 不再承载 answer evaluation / report generation 队列和报告状态。
    - report status API 以 report DB 为唯一真源，前端 bell 通过短轮询获知完成状态。

- 宿主 repo `.github/instructions/project-architecture.instructions.md`
  - 如涉及默认 provider 数据流描述，也同步改。

验收标准：

- 不启动 Redis/worker，仅运行：

```powershell
npm run start:local
```

- 完成一轮短面试后：
  - `interview_reports.db` 有 report。
  - `/api/interviews/{thread_id}/report/status` 返回 ready/succeeded。
  - 前端 bell 通过短轮询自动变 ready，并可下载 markdown。

### 10. 删除旧异步 Redis 报告方案遗留的冗余代码

状态：已完成（2026-06-20）。Python runtime 的 worker、启动脚本、enqueue/domain helper、Redis store/client glue、Redis task schema、旧 report status 聚合逻辑和绑定单测已删除；host E2E complete flow 已改为 DB-backed inline report 断言，`scripts/run-e2e-redis-fake.mjs` 已删除；默认 Python `start:all` 和 Docker `python-agent` 已从 Redis 依赖中解耦，Redis 仅保留给 legacy Mastra rollback。最终审计确认旧 Python Redis queue/worker/schema 关键词不再出现在 runtime code、tests、scripts、E2E 或架构 instruction 中。验证：`python -m pytest tests\unit -q`、`python -m ruff check src tests scripts`、`docker compose config --quiet`、`start-local.ps1` PowerShell AST parse、BFF/Frontend report tests 均通过。

预计改动：每组约 80-200 行，按文件簇分批删除，避免一次性改动过大。

目标：完成内联 LangGraph report flow 后，删除之前错误方向中为 Redis worker / Redis report manifest / Redis evaluation manifest 新增的冗余代码，保证仓库只剩一条默认报告生成路径。

#### 10.1 删除 worker 与启动脚本

删除范围：

- `../my-first-agent-langgraph/scripts/run_answer_evaluation_worker.py`
- `../my-first-agent-langgraph/scripts/run_report_generation_worker.py`
- `../my-first-agent-langgraph/src/app/workers/answer_evaluation_worker.py`
- `../my-first-agent-langgraph/src/app/workers/report_generation_worker.py`

验收：

- `rg "run_answer_evaluation_worker|run_report_generation_worker|answer_evaluation_worker|report_generation_worker" ../my-first-agent-langgraph/src ../my-first-agent-langgraph/scripts ../my-first-agent-langgraph/tests` 不再命中有效引用。

#### 10.2 删除 Redis enqueue/domain helper

删除范围：

- `../my-first-agent-langgraph/src/app/domain/answer_evaluation_enqueue.py`
- `../my-first-agent-langgraph/src/app/domain/report_generation_enqueue.py`
- `process_user_reply.py` 中所有 enqueue/seal/report task 相关调用、helper 和 import。

验收：

- `process_user_reply.py` 只负责推进面试状态到 `wrap-up`，不写 Redis，不 seal manifest，不 enqueue report task。
- `rg "enqueue_answer|enqueue_report|seal_interview|evaluation_manifest" ../my-first-agent-langgraph/src/app` 不再命中主流程代码。

#### 10.3 删除 Redis store 与 client glue

删除范围：

- `../my-first-agent-langgraph/src/app/integrations/redis_evaluation_store.py`
- `../my-first-agent-langgraph/src/app/integrations/redis_report_generation_store.py`
- `../my-first-agent-langgraph/src/app/integrations/redis_client.py` 中仅服务 evaluation/report store 的内容。
- `src/app/config.py` 中仅服务 Redis report/evaluation 的配置项，如确认无其他用途则删除。

验收：

- 删除前先执行：

```powershell
rg "Redis|create_redis|redis_" ../my-first-agent-langgraph/src ../my-first-agent-langgraph/tests ../my-first-agent-langgraph/scripts
```

- 确认没有非报告功能依赖 Redis 后再删除。
- 删除后上述搜索不再命中 answer/report generation 主链路。

#### 10.4 删除 `AnswerEvaluationTask` 及 Redis task schema

删除范围：

- `../my-first-agent-langgraph/src/app/schemas/answer_evaluation.py` 中的 `AnswerEvaluationTask`、task status、manifest 等 Redis task 专属 schema。
- 保留或迁移不绑定 Redis 的结果模型，例如 `LlmAnswerEvaluationResult`。
- 如结果模型仍引用 `taskId`，改为更中性的 `evaluationId` 或由 `AnswerEvaluationContext` 提供稳定 id。

验收：

- `rg "AnswerEvaluationTask|InterviewEvaluationManifest|AnswerEvaluationTaskStatus" ../my-first-agent-langgraph/src ../my-first-agent-langgraph/tests` 不再命中。
- 新的 `AnswerEvaluationContext` 只表达评分上下文，不表达队列任务。

#### 10.5 删除旧 Redis report status 聚合逻辑

删除范围：

- `../my-first-agent-langgraph/src/app/domain/report_status.py` 中读取 Redis report manifest / evaluation manifest 的逻辑。
- report API 中注入 Redis store 的代码路径。
- 与 Redis manifest count/status 绑定的 schema 字段，如不再用于 DB-backed status。

验收：

- report status API 只查 DB。
- DB 有 succeeded report 返回 ready。
- DB 有 failed report 返回 failed。
- DB 没有 report 返回 pending/running。
- `rg "manifest|evaluationExpectedCount|evaluationCompletedCount|evaluationFailedCount" ../my-first-agent-langgraph/src/app/domain/report_status.py ../my-first-agent-langgraph/tests` 不再命中旧 Redis 状态逻辑。

#### 10.6 删除旧测试与 E2E 假 Redis 支撑

删除或改写范围：

- `../my-first-agent-langgraph/tests/unit/test_answer_evaluation_worker.py`
- `../my-first-agent-langgraph/tests/unit/test_report_generation_worker.py`
- `../my-first-agent-langgraph/tests/unit/test_redis_evaluation_store.py`
- `../my-first-agent-langgraph/tests/unit/test_redis_report_generation_store.py`
- `../my-first-agent-langgraph/tests/unit/test_report_generation_enqueue.py`
- 宿主 repo 中仅为 Redis async report/evaluation E2E 准备的 fake Redis 脚本或测试 fixture，如确认只服务旧方案则删除。

验收：

- 新测试覆盖 LangGraph 内联报告流程。
- 不再需要 fake Redis 才能跑 complete interview E2E。
- `python -m pytest tests/unit -q` 通过。

#### 10.7 删除文档、启动脚本和 compose 中的旧说明

删除或改写范围：

- `../my-first-agent-langgraph/README.md` 中 answer/report worker 启动说明。
- 宿主 repo `README.md`、`docker-compose.yml`、`scripts/start-local.ps1`、`.github/instructions/*.md` 中关于 Redis answer evaluation / report generation worker 的描述。
- 如果 Redis service 仅用于旧报告链路，确认无其他用途后从 compose/local 启动依赖中移除。

验收：

- 本地启动说明不再要求 Redis 或 worker。
- 架构说明明确：报告由 LangGraph 条件分支生成，状态由 DB-backed report status API 提供，前端 bell 短轮询。

#### 10.8 最终冗余引用审计

完成以上删除后执行：

```powershell
rg "answer-evaluation:pending|report-generation:pending|RedisAnswerEvaluationStore|RedisReportGenerationStore|run_answer_evaluation_worker|run_report_generation_worker" ../my-first-agent-langgraph ../my-first-agent
rg "AnswerEvaluationTask|InterviewEvaluationManifest|ReportGenerationTask|InterviewReportManifest" ../my-first-agent-langgraph/src ../my-first-agent-langgraph/tests
```

验收：

- 搜索结果只允许出现在历史计划文档中，不允许出现在运行时代码、测试、启动脚本或架构 instruction 中。
- 如果仍有命中，必须逐一判断是保留、改名、迁移还是删除，不能留下模糊兼容路径。

## 关键实现细节

### evaluate_answers_node

输入：

- `InterviewGraphState.session`
- `resource_id`

输出：

- `evaluation_contexts`
- `evaluation_results`
- `report_status = "evaluated"`

职责：

- 从所有 answer attempts 构造 evaluation context。
- 调用 answer evaluation model。
- 对 skipped/flow-test answer 可以走 deterministic evaluation。
- LLM 超时或失败时记录 `report_status = "failed"` 与 `report_error`，不重试。
- 不写 Redis。

### generate_report_node

输入：

- session
- evaluation contexts
- evaluation results

输出：

- `report_output`
- `report_status = "generated"`

职责：

- 复用 `build_report_generation_prompt`。
- 调用 `generate_report_with_model`。
- 校验 `ReportGenerationOutput`。
- 模型失败、超时或输出不合法时记录 `report_status = "failed"` 与 `report_error`，不重试，不写 succeeded report。

### 最终报告 Markdown 模板

两次 LLM 调用的结果必须整合为一份 markdown report：

1. `evaluate_answers_node` 负责输出每次回答的结构化评估。
2. `generate_report_node` 负责基于结构化评估、简历/JD、问题/回答和 metadata 生成最终 markdown。
3. `persist_report_node` 只保存这一份最终 markdown 和对应结构化 JSON。

最终 markdown 必须遵循以下模板：

```markdown
# 面试评估报告

## 整体评价

本次面试中，候选人整体表现为：{overallSummary}

优势主要体现在：

- {strength1}
- {strength2}
- {strength3}

需要改进的地方：

- {weakness1}
- {weakness2}
- {weakness3}

综合来看，{overallConclusion}

## 综合评分

| 维度 | 评分 | 说明 |
| --- | ---: | --- |
| 技术理解 | {technicalUnderstandingScore} / 100 | {technicalUnderstandingComment} |
| 工程落地 | {engineeringExecutionScore} / 100 | {engineeringExecutionComment} |
| 问题分析 | {problemAnalysisScore} / 100 | {problemAnalysisComment} |
| 表达结构 | {communicationStructureScore} / 100 | {communicationStructureComment} |
| 岗位匹配度 | {roleFitScore} / 100 | {roleFitComment} |

**整体建议评分：{overallScore} / 100**

---

# 逐题点评

## {questionIndex}. {questionTypeLabel}：{questionText}

### 用户回答摘要

{answerSummary}

### 评估要点

{evaluationCriteriaIntro}

- {criterion1}
- {criterion2}
- {criterion3}
- {criterion4}

### 回答评价

{answerReview}

### 遗漏内容

- {missingPoint1}
- {missingPoint2}
- {missingPoint3}

### 错误或风险点

{incorrectOrRiskyPoints}

### 改进建议

{improvementAdvice}

### 单题评分

**{questionScore} / 100**

---

# 主要优势

- {globalStrength1}
- {globalStrength2}
- {globalStrength3}
- {globalStrength4}

# 主要短板

- {globalWeakness1}
- {globalWeakness2}
- {globalWeakness3}
- {globalWeakness4}

# 建议补强方向

1. {recommendation1}
2. {recommendation2}
3. {recommendation3}
4. {recommendation4}
5. {recommendation5}

# 总结建议

{finalAdvice}
```

逐题点评规则：

- 每一次用户回答都必须生成一个 `{questionIndex}` 小节。
- 主问题使用 label：`主问题`。
- 追问使用 label：`追问`。
- 主问题必须结合召回 metadata / evaluationPoints 进行评估。
- 追问必须按统一四个维度评估：
  - 是否正面回答追问问题。
  - 是否结合原主问题上下文。
  - 是否提供具体实现细节。
  - 是否体现工程取舍、风险或排障经验。
- 每题必须包含：
  - 用户回答摘要。
  - 评估要点。
  - 回答评价。
  - 遗漏内容。
  - 错误或风险点。
  - 改进建议。
  - 单题评分。
- 点评必须结合用户具体回答，不允许只写泛泛建议。
- 如果没有发现明确错误，要写“未发现明显错误”，但仍需说明回答风险或不足。
- 最终报告开头必须先给整体评价，再进入逐题点评。

### persist_report_node

输入：

- session
- evaluation contexts
- evaluation results
- report output

输出：

- `report_id`
- `report_markdown_available = true`
- `report_status = "succeeded"`
- 更新 session：
  - `phase = "completed"`
  - `finalReportReady = true`
  - `finalReport = report markdown or short ready message`

职责：

- 使用 `InterviewReportRepository.write_report` 写 DB。
- DB 写成功后，report status API 下一次轮询即可返回 ready。
- DB 写失败或模型失败时，写入 failed report record 或等价 DB 失败记录，供 status API 返回 failed。

## 风险与取舍

### 最后一轮响应耗时变长

第一版同步执行 report generation，最后一次回答请求会等待评分和报告生成。

缓解：

- 先接受这个行为，确保不依赖 worker 的闭环跑通。
- 后续如耗时明显，再升级为“status API resume report graph”的 LangGraph 内部异步方案。

### 模型调用失败

风险：

- report generation model 输出不合法。
- answer evaluation model 超时。

缓解：

- `evaluate_answers_node` 对 flow-test/skip 可使用 deterministic evaluation。
- 真实 LLM 调用超时、失败或输出不合法时不重试。
- `generate_report_node` 失败时把 graph state 标为 `failed`，status API 可展示失败原因。
- 不把 DB 标记为 succeeded，避免假 ready。

### 删除 Redis 代码带来的兼容风险

风险：

- 旧测试、旧脚本、旧文档可能还引用 Redis evaluation/report store。
- 已经在 Redis 中排队但尚未生成的历史报告任务不会被新系统消费。

缓解：

- 删除或改写所有相关测试和文档引用。
- 历史未生成报告不做队列迁移；如果需要补生成，必须通过 checkpoint/session 重新触发新 LangGraph report flow。
- report status 只认 DB/checkpoint，避免同时存在两套状态真源。

### Response latency 风险需要正式接受

风险：

- 同步内联生成报告会让最后一次 SSE 请求等待更久。
- 如果 evaluation/report 两次模型调用总耗时超过前端或 BFF 超时阈值，会出现请求失败但 graph 可能已经部分执行的问题。

改进方式：

- 第一版先实现同步闭环，验证正确性。
- 如果真实耗时不可接受，第二版改为“status API 触发/恢复 LangGraph report flow”，仍不使用 Redis worker。
- 为 `evaluate_answers_node` 和 `generate_report_node` 增加幂等检查：DB 已有 succeeded report 时直接跳过。

### Report status 触达方式

风险：

- 如果只靠用户手动点击刷新，用户可能不知道报告何时完成。
- 如果失败状态不写 DB，status API 无法解释生成失败。

改进方式：

- 生成成功以 DB 为真源。
- 生成失败也写 DB failed record 或等价失败记录。
- `persist_report_node` 写 DB 成功后再更新 session `finalReportReady=true`。
- `generate_report_node` 失败时写入 DB failed 状态，前端下一次轮询即可展示失败。
- 前端继续使用短轮询是第一版方案：最后一轮结束后每隔数秒调用 report status API，API 查询 DB 是否已有 succeeded/failed report。
- 如果后续要避免轮询，可新增 SSE/WebSocket/Server-Sent notification，但这需要 BFF/frontend 增加持久连接，不属于第一版最小改造。

## 方案复审结论

### 确定可行

- 报告生成依据应来自 `InterviewSessionState`，不是 Redis。
- 最终报告真源应是 `interview_reports.db`。
- `evaluate_answers_node -> generate_report_node -> persist_report_node` 能覆盖原两个 worker 的核心职责。
- 删除 Redis worker/enqueue 能解决“任务入队但没人消费”的根因。

### 当前不确定点

1. `AnswerEvaluationTask` schema 是否完全适合脱离 Redis 后继续作为内部 evaluation context。
   - 已确定不适合。
   - 删除 `AnswerEvaluationTask`。
   - 新增更中性的 `AnswerEvaluationContext`，再从 context 生成 `LlmAnswerEvaluationResult`。

2. Report status API 如何展示生成完成。
   - 成功状态直接读取 DB。
   - 前端短轮询时，API 只要查 DB 是否有 succeeded report 即可判断完成。
   - 失败状态写入 DB failed record 或等价 DB 失败记录，API 不读 checkpoint。
   - 如果不想依赖轮询，后续可做 SSE/WebSocket 通知，但需要新增连接管理和前端订阅，不建议放入第一版。

3. 最后一轮同步生成报告是否会超过 BFF/frontend 超时。
   - 需要用真实模型跑一次计时。
   - 如果超时，本次要求是记录失败，不重试。
   - 后续如果要优化体验，可以升级为“status API resume graph”的非 Redis 异步执行。

4. 删除 Redis store 是否影响非报告功能。
   - 当前计划只删除 answer evaluation / report generation 相关 Redis 代码。
   - 实施前必须用 `rg "create_redis|Redis"` 确认没有其他业务依赖被误删。

### 需要修正的原计划点

1. “保留 worker legacy 代码”不符合当前用户目标。
   - 已修正为删除 Redis worker/enqueue/store 及相关测试引用。

2. “report status Redis legacy 兜底”会保留第二套状态真源。
   - 已修正为 DB/checkpoint-only。

3. “抽取 service 后让 worker 复用”会增加迁移中间层。
   - 已修正为把 worker 逻辑迁移到 domain service，随后删除 worker。

4. “Redis 不可用时进入可解释失败状态”不够彻底。
   - 已修正为报告主流程不依赖 Redis，因此 Redis 不可用不应影响报告生成。

## 最小验收口径

完成本计划后，应满足：

1. 不启动 Redis。
2. 不启动 answer/report worker。
3. 只启动 Python Agent、BFF、Frontend。
4. 完成一轮面试。
5. LangGraph 自动执行：

```text
evaluate_answers_node
-> generate_report_node
-> persist_report_node
```

6. `interview_reports.db` 出现 succeeded report。
7. report status API 返回 `markdownAvailable = true`。
8. 前端 bell 通过短轮询自动变 ready，并可以下载 markdown。
9. `rg "answer-evaluation:pending|report-generation:pending" ../my-first-agent-langgraph/src ../my-first-agent-langgraph/tests ../my-first-agent-langgraph/scripts` 不再命中主流程代码。

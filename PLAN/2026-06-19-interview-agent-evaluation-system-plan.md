# Interview Agent Evaluation System Plan

## 目标

为当前 interview agent system 建立可运行、可回归、可扩展的评测体系。

当前架构下，默认 agent runtime 是同级 Python LangGraph 仓库：

- Host / Frontend / BFF: `G:/project/my-first-agent/my-first-agent`
- Default runtime: `G:/project/my-first-agent/my-first-agent-langgraph`
- Rollback runtime: `G:/project/my-first-agent/my-first-agent/src/mastra/**`

评测体系采用分层组合：

```text
L0 Existing Regression: pytest/vitest/e2e 保护协议、schema、SSE、BFF、frontend
L1 Runtime Eval Harness: Python LangGraph 本地 deterministic eval target
L2 LangSmith + AgentEvals: graph run、节点轨迹、最终输出质量
L3 RAG Eval: question planner / retriever / Milvus 召回专项
L4 Black-box Gates: Promptfoo / DeepEval 小样本 PR gate
L5 Feedback Loop: outcome、RAG sample、report DB、用户反馈回流为 eval case
```

## 当前架构约束

- 新 interview runtime 能力和 Python eval harness 优先落在 `../my-first-agent-langgraph`。
- 本仓库负责 BFF、frontend、provider e2e、Promptfoo 黑盒 gate、CI/本地编排脚本。
- `src/mastra/**` 只作为 rollback provider，除 rollback blocker、安全、构建或兼容性修复外，不新增评测主能力。
- Python runtime 的报告生成已经由 FastAPI background task 调用 LangGraph report runner；不再依赖 Redis worker、queue task、evaluation manifest sealed 或 checkpoint 内最终报告真源。
- 报告状态、markdown、read receipt 的真源是 Python report DB：`/api/interviews/{thread_id}/report/status`、`/markdown`、`/read`。
- SSE 必须保持 Mastra-compatible：`text-delta`、`tool-result`、`[DONE]`。
- 所有 LangSmith、Ragas、DeepEval、Promptfoo 外发或持久评测样本必须脱敏，并记录 `redaction_version`。
- 每次开始修改 `../my-first-agent-langgraph` 的代码、测试、脚本、contract 或架构相关文件前，先重新读取本仓库 `.github/instructions/langgraph-architecture.instructions.md`。
- 完成 LangGraph runtime 代码改动后，执行 `project-architecture-sync` skill，并在 host repo 记录 guard：`node .github/hooks/scripts/project-architecture-sync-guard.mjs record`。

## 拆分原则

每个实施单元必须满足：

- 改动范围能在一次会话内完成，通常只碰 1 到 4 个主题相关文件。
- 有本地自检命令；没有外部 API key 时也能通过 deterministic / skipped 结果自检。
- 失败时能从 summary、pytest failure 或 fixture test 定位到具体层。
- 不把 dependency、dataset、runner、CI、外部平台接入混在同一个单元里。

## 推荐目录

```text
my-first-agent/
  evals/promptfoo/interview-smoke.yaml
  evals/promptfoo/sse-provider.js
  evals/promptfoo/sse-provider.test.ts
  scripts/run-evaluation-baseline.ps1
  scripts/run-evaluation-ci-gate.ps1
  scripts/export-eval-case-from-outcome.ps1

my-first-agent-langgraph/
  tests/evals/datasets/interview_cases.jsonl
  tests/evals/datasets/rag_cases.jsonl
  tests/evals/datasets/safety_cases.jsonl
  tests/evals/evaluators/trajectory.py
  tests/evals/evaluators/rag_metrics.py
  tests/evals/test_eval_dataset_schema.py
  tests/evals/test_eval_target_contract.py
  tests/evals/test_trajectory_evaluator.py
  tests/evals/test_rag_metrics.py
  tests/evals/test_deepeval_gate.py
  tests/evals/run_interview_eval_target.py
  tests/evals/run_langsmith_interview_eval.py
  tests/evals/run_rag_eval.py
```

## 统一数据集 contract

`interview_cases.jsonl` 字段：

- `case_id`
- `redaction_version`
- `source_type`
- `source_thread_id_hash`
- `resume_markdown`
- `job_description_markdown`
- `settings`
- `turns`
- `expected_stage_path`
- `expected_required_skills`
- `must_not_claim`
- `rubric`

`rag_cases.jsonl` 字段：

- `case_id`
- `redaction_version`
- `source_type`
- `source_thread_id_hash`
- `query`
- `round_type`
- `resume_signals`
- `jd_signals`
- `expected_question_ids`
- `acceptable_skill_areas`
- `negative_question_ids`

`safety_cases.jsonl` 字段：

- `case_id`
- `redaction_version`
- `source_type`
- `input_kind`
- `payload`
- `forbidden_patterns`
- `expected_safe_behavior`

## 实施单元 0：计划与架构基线

目标：

- 固定评测计划的当前架构口径。
- 防止后续实现继续沿用 Redis manifest 或 Mastra-first 的旧假设。

范围：

- 只更新本计划。
- 不新增代码，不执行计划中的实现步骤。

自检：

- 计划中不再把 Redis evaluation manifest 作为 Python 默认 runtime 的报告完成前置条件。
- 计划中明确 Python report DB/status/markdown/read API 是默认 provider 报告边界。
- 每个后续单元都有独立验收命令。

验收：

```powershell
Select-String -Path .\PLAN\2026-06-19-interview-agent-evaluation-system-plan.md -Pattern "Redis evaluation manifest"
Select-String -Path .\PLAN\2026-06-19-interview-agent-evaluation-system-plan.md -Pattern "report DB"
```

## 实施单元 1：Python eval optional extra

目标：

- 给 Python runtime 增加可选 eval 依赖入口，不影响默认开发安装。

范围：

- `../my-first-agent-langgraph/pyproject.toml`
- 仅新增 `[project.optional-dependencies].eval`

建议依赖：

- `agentevals`
- `ragas`
- `deepeval`
- 如当前 `dependencies` 已包含 `langsmith`，不要重复迁移主依赖，除非确认 runtime 不再需要它。

自检：

- 无 eval extra 时现有 unit/contract 测试继续可跑。
- 安装 eval extra 后能 import 新依赖。

验收：

```powershell
cd ..\my-first-agent-langgraph
.\.venv\Scripts\python -m pytest tests\unit\test_langsmith_tracing.py
.\.venv\Scripts\python -c "import agentevals, ragas, deepeval"
```

## 实施单元 2：数据集目录与 schema 校验

目标：

- 建立 eval case 的最小数据 contract。
- 先用 schema/rule gate 保护数据质量，不引入外部平台。

范围：

- `../my-first-agent-langgraph/tests/evals/datasets/*.jsonl`
- `../my-first-agent-langgraph/tests/evals/test_eval_dataset_schema.py`

最小样本：

- 3 条 interview case。
- 5 条 RAG case。
- 2 条 safety case。

规则：

- 每条样本必须有 `case_id`、`redaction_version`、`source_type`。
- 真实来源样本必须只存脱敏内容。
- `source_thread_id_hash` 只能是 hash，不能是原始 thread id。
- PII pattern check 至少覆盖邮箱、手机号、明显身份证/社保号形态。

自检：

- JSONL 每行可解析。
- schema 字段完整。
- PII pattern check 通过。

验收：

```powershell
cd ..\my-first-agent-langgraph
.\.venv\Scripts\python -m pytest tests\evals\test_eval_dataset_schema.py
.\.venv\Scripts\ruff check tests\evals
```

## 实施单元 3：Python 本地 eval target contract

目标：

- 在接 LangSmith / AgentEvals 之前，先有一个本地 deterministic target。
- 统一后续评测看到的输出形状。

范围：

- `../my-first-agent-langgraph/tests/evals/run_interview_eval_target.py`
- `../my-first-agent-langgraph/tests/evals/test_eval_target_contract.py`

target 输入：

- 单条 `interview_cases.jsonl` case。
- `--limit`
- `--output`
- `--mock-model` 或沿用当前 runtime mock provider。

target 输出：

- `case_id`
- `final_snapshot`
- `assistant_reply`
- `trajectory`
- `report_status`
- `report_markdown_available`
- `duration_seconds`
- `redaction_version`
- `skipped`
- `errors`

架构要求：

- 优先通过 FastAPI test client 或现有 graph API 触发默认 Python runtime contract。
- 必须覆盖 wrap-up 后 background report runner 与 report status 边界，不能回到 Redis worker 假设。
- trajectory 只记录阶段、节点、round、工具/步骤名和状态，不记录简历、JD、回答或报告正文。

自检：

- 1 条 short-flow case 可在无外部模型 key 环境跑完。
- 输出 JSON schema 稳定。
- `final_snapshot` 包含前端依赖字段：`assistantReply`、`phase`、`activeRoundType`、`activeNodeTopic`、`finalReportReady`、`progress`。

验收：

```powershell
cd ..\my-first-agent-langgraph
.\.venv\Scripts\python -m pytest tests\evals\test_eval_target_contract.py
.\.venv\Scripts\python tests\evals\run_interview_eval_target.py --limit 1 --output .tmp\interview-eval-target-summary.json
```

## 实施单元 4：现有回归 baseline runner

目标：

- 把 deterministic 回归固定为评测体系第一层。
- 防止 LLM judge 掩盖协议、schema、状态机、BFF/frontend 错误。

范围：

- `scripts/run-evaluation-baseline.ps1`
- 必要时新增一个很薄的 npm script。

runner 顺序：

- Host workspace: `npm run test:workspace`
- Python scoped tests: `.\.venv\Scripts\python -m pytest tests`
- Python smoke: `npm run test:e2e:interview:smoke:python`
- Docker 可用时 optional rollback smoke: `npm run test:e2e:interview:rollback-smoke`

输出：

- `evaluation-baseline-summary.json`
- 每个 step 包含 `name`、`status`、`durationSeconds`、`logPath`、`skippedReason`

自检：

- 单命令生成 summary。
- 即使 rollback smoke 被跳过，summary 也明确标注 skipped。
- 失败时脚本返回非 0。

验收：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-evaluation-baseline.ps1
```

## 实施单元 5：LangSmith experiment runner

目标：

- 将 Python LangGraph runtime 的 eval target 纳入 LangSmith experiment。
- 复用实施单元 3 的 target 输出，避免重复实现运行逻辑。

范围：

- `../my-first-agent-langgraph/tests/evals/run_langsmith_interview_eval.py`
- 如有需要，补充 `tests/evals/test_langsmith_eval_mapping.py`

环境：

- `LANGSMITH_TRACING=true`
- `LANGSMITH_API_KEY`
- `LANGSMITH_PROJECT=interview-agent-evals`
- `LANGSMITH_ENDPOINT`
- `LANGSMITH_DATA_MODE=redacted`

评估维度：

- `flow_success`
- `stage_path_match`
- `state_schema_validity`
- `latency_seconds`
- `report_status_ready`
- `must_not_claim_absence`

自检：

- 无 `LANGSMITH_API_KEY` 时本地 mapping tests 通过，runner 给出明确 skipped。
- 有 key 时 1 条 deterministic case 能产生 `experiment_id` 或 `experiment_url`。
- run metadata 包含 `case_id`、`provider=python`、`runtime=langgraph`、`redaction_version`，不包含正文。

验收：

```powershell
cd ..\my-first-agent-langgraph
.\.venv\Scripts\python -m pytest tests\evals\test_langsmith_eval_mapping.py
.\.venv\Scripts\python tests\evals\run_langsmith_interview_eval.py --limit 1
```

## 实施单元 6：Trajectory rule evaluator

目标：

- 先用本地规则评估 agent 中间过程，再接 AgentEvals LLM judge。
- 保护阶段路径、追问依据、检索使用、报告生成边界。

范围：

- `../my-first-agent-langgraph/tests/evals/evaluators/trajectory.py`
- `../my-first-agent-langgraph/tests/evals/test_trajectory_evaluator.py`
- 可小幅扩展 `run_interview_eval_target.py` 输出 trajectory event。

规则：

- start request 应进入初始化路径。
- structured kickoff payload 应被 runtime 解析。
- 不跳过专业技能轮时，应产生专业技能问题。
- 项目题应标记项目经历 round/topic。
- follow-up event 应关联当前题和上一轮回答的分析结果，但不记录回答正文。
- wrap-up 后应出现 background report generation / report status 相关事件。
- final report ready 应来自 report DB status，而不是 Redis manifest。

自检：

- 1 条正确 short-flow case 输出 `trajectory_score`。
- 1 条人为错误路径 fixture 能触发 `failed_rules`。
- event 中不包含 resume/JD/answer/report markdown 正文。

验收：

```powershell
cd ..\my-first-agent-langgraph
.\.venv\Scripts\python -m pytest tests\evals\test_trajectory_evaluator.py
.\.venv\Scripts\python tests\evals\run_interview_eval_target.py --limit 1 --include-trajectory --output .tmp\trajectory-summary.json
```

## 实施单元 7：AgentEvals 接入

目标：

- 在 LangSmith experiment 中增加 AgentEvals trajectory 评分。
- 保留实施单元 6 的本地 rule evaluator 作为稳定底线。

范围：

- `../my-first-agent-langgraph/tests/evals/run_langsmith_interview_eval.py`
- `../my-first-agent-langgraph/tests/evals/evaluators/trajectory.py`

自检：

- 无 eval model key 时 AgentEvals LLM judge 标记 skipped，本地 rules 仍运行。
- 有 key 时输出 `trajectory_score`、`failed_rules`、`judge_feedback`。
- summary 同时保留 rule 分和 LLM judge 分，不互相覆盖。

验收：

```powershell
cd ..\my-first-agent-langgraph
.\.venv\Scripts\python tests\evals\run_langsmith_interview_eval.py --limit 1 --include-trajectory
```

## 实施单元 8：RAG deterministic metrics

目标：

- 独立评估 question planner / query / retriever / Milvus 召回质量。
- PR 默认只跑 deterministic metrics，避免 LLM 成本和波动。

范围：

- `../my-first-agent-langgraph/tests/evals/evaluators/rag_metrics.py`
- `../my-first-agent-langgraph/tests/evals/run_rag_eval.py`
- `../my-first-agent-langgraph/tests/evals/test_rag_metrics.py`

指标：

- `hit_rate@k`
- `MRR`
- `NDCG`
- `negative_question_exclusion`
- `skill_area_coverage`
- `rerank_top_k_stability`

架构要求：

- 复用 `src/app/domain/question_query.py`、`question_retriever.py`、`question_planner.py` 的既有边界。
- Milvus 不可用时可以用 fixture candidates 跑 metrics unit test；真实 retriever run 标记 skipped 或 requires-integration。
- summary 不记录 query 原文之外的敏感简历/JD 正文；如果 query 来自真实样本，必须脱敏。

自检：

- 5 条 RAG case 离线跑完 deterministic metrics。
- 任意一条 case 可打印候选 id、score、命中解释，不打印题目全文。
- 人为负例 fixture 能让 `negative_question_exclusion` 失败。

验收：

```powershell
cd ..\my-first-agent-langgraph
.\.venv\Scripts\python -m pytest tests\evals\test_rag_metrics.py
.\.venv\Scripts\python tests\evals\run_rag_eval.py --limit 5 --top-k 5 --output .tmp\rag-eval-summary.json
```

## 实施单元 9：Ragas optional metrics

目标：

- 在 RAG deterministic metrics 之上，增加 nightly/manual 的 Ragas LLM 指标。

范围：

- `../my-first-agent-langgraph/tests/evals/run_rag_eval.py`
- 必要时新增 `tests/evals/test_ragas_mapping.py`

指标：

- `context_precision`
- `context_recall`
- `context_relevance`

自检：

- 无 eval model key 时 Ragas metrics 标记 skipped，不阻断 deterministic metrics。
- 有 key 时 summary 包含 Ragas 平均分和逐 case 分。
- Ragas dataset mapping 有单元测试。

验收：

```powershell
cd ..\my-first-agent-langgraph
.\.venv\Scripts\python -m pytest tests\evals\test_ragas_mapping.py
.\.venv\Scripts\python tests\evals\run_rag_eval.py --limit 5 --top-k 5 --include-ragas
```

## 实施单元 10：Promptfoo SSE adapter fixture test

目标：

- 先把 host repo 的 SSE adapter 做成可测小单元，再接真实 BFF/runtime。

范围：

- `evals/promptfoo/sse-provider.js`
- `evals/promptfoo/sse-provider.test.ts`
- 必要时新增 npm script。

adapter 职责：

- 调用 BFF `POST /api/agents/chat/stream` 或 Python runtime `/api/agents/interview-agent/stream`。
- 消费 Mastra-compatible SSE。
- 提取最终 `tool-result.result` snapshot。
- 返回 Promptfoo 可断言的 JSON。

自检：

- fixture SSE 文本可以解析出 final snapshot。
- `[DONE]` 缺失、tool-result 缺失、JSON 损坏时测试覆盖失败路径。

验收：

```powershell
npm run test:unit -- evals/promptfoo/sse-provider.test.ts
```

## 实施单元 11：Promptfoo black-box smoke

目标：

- 用少量样本在 PR 或手动本地栈中快速检查 BFF/runtime 黑盒行为。

范围：

- `evals/promptfoo/interview-smoke.yaml`
- `evals/promptfoo/sse-provider.js`
- `package.json` 可选 script

case：

- basic start
- start with JD
- flow-test skip professional answer

断言：

- final snapshot 包含结构化字段。
- `phase` 和 `progress` 合法。
- 不出现 `must_not_claim`。
- stream 破坏时 CLI 返回非 0。

自检：

- 本地 stack 启动后能跑 3 条 case。
- 输出 `promptfoo-results.json`。

验收：

```powershell
npm run start:local
npx promptfoo eval -c evals/promptfoo/interview-smoke.yaml --output promptfoo-results.json
```

## 实施单元 12：DeepEval 小规模语义 gate

目标：

- 在 Python pytest 体系内增加少量 LLM 语义质量断言。
- 补足 Promptfoo 不擅长表达的报告事实性和 rubric 一致性。

范围：

- `../my-first-agent-langgraph/tests/evals/test_deepeval_gate.py`

评估点：

- answer evaluation rubric consistency
- final report factuality
- follow-up answer grounding
- task completion

自检：

- 无 API key 环境下 LLM judge skipped，而不是 failed。
- schema/rule gate 仍会运行。
- 有 key 时跑 2 条固定 transcript。
- 输出 metric name、score、threshold。

验收：

```powershell
cd ..\my-first-agent-langgraph
.\.venv\Scripts\python -m pytest tests\evals\test_deepeval_gate.py
.\.venv\Scripts\deepeval test run tests\evals\test_deepeval_gate.py
```

## 实施单元 13：CI gate runner

目标：

- 用一个 host repo 脚本统一 PR gate，控制成本和耗时。

范围：

- `scripts/run-evaluation-ci-gate.ps1`
- `.github/workflows/interview-e2e.yml` 或新增 workflow，按实际 CI 结构决定

PR gate：

- `npm run test:workspace`
- Python `pytest tests`
- Python e2e smoke
- Python eval dataset schema
- Python eval target 1-case smoke
- RAG deterministic metrics
- Promptfoo 3-case smoke，只有本地栈可用时运行
- DeepEval schema/rule gate

Nightly gate：

- Full provider e2e
- LangSmith 20-case experiment
- AgentEvals trajectory
- RAG full suite + optional Ragas
- DeepEval LLM judge
- Rollback smoke

Release gate：

- 最近一次 nightly 通过。
- 样本数少于 20 条 interview case 或 30 条 RAG case 时，只记录 baseline，不阻断 release。
- 样本数达标后，关键指标不得低于已记录 baseline。
- Rollback smoke 至少通过一次。

自检：

- 本地单命令可运行 PR gate。
- summary 标出 `skipped`、`failed`、`passed`。
- 任一 required step 失败时脚本返回非 0。

验收：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-evaluation-ci-gate.ps1
```

## 实施单元 14：反馈回流 exporter

目标：

- 将真实失败样本转成新的 eval case 草稿，建立持续改进闭环。

数据来源：

- `Interview outcome/`
- `RAG LOG INFO/`
- Python report DB 中的 report summary/status
- frontend user feedback
- LangSmith traces metadata

范围：

- `scripts/export-eval-case-from-outcome.ps1`
- 必要时新增纯 parser/test fixture，不直接改 runtime。

输出：

- 脱敏后的 `interview_case.json` 草稿。
- 可选 `rag_case.json` 草稿。
- `redaction_version`
- `source_type`
- `source_thread_id_hash`
- `review_required=true`

脱敏规则：

- 删除姓名、邮箱、手机号、公司敏感信息。
- 保留技能、项目类型、技术关键词、失败原因和期望行为。
- 输出草稿必须人工 review 后才追加到正式 dataset。

自检：

- 用一个本地 outcome artifact 导出 case 草稿。
- schema 校验通过。
- 输出不包含邮箱或手机号模式。

验收：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\export-eval-case-from-outcome.ps1 -ThreadId <threadId>
cd ..\my-first-agent-langgraph
.\.venv\Scripts\python -m pytest tests\evals\test_eval_dataset_schema.py
```

## 初始指标门槛

Smoke / PR：

- `flow_success`: 100%
- `state_schema_validity`: 100%
- `promptfoo_smoke_pass_rate`: 100%
- `eval_dataset_schema_validity`: 100%
- `rag_negative_question_exclusion`: >= 0.90

Nightly 初始观察，不阻断：

- `question_relevance`: >= 0.75
- `follow_up_groundedness`: >= 0.70
- `report_groundedness`: >= 0.80
- `rag_top_5_hit_rate`: >= 0.70
- `rag_mrr`: baseline only

成熟后阻断：

- `question_relevance`: >= 0.85
- `follow_up_groundedness`: >= 0.80
- `report_groundedness`: >= 0.90
- `rag_top_5_hit_rate`: >= 0.85
- `rag_mrr`: 不低于最近稳定 baseline

## 第一周最小闭环

建议只做到以下 6 个单元，不要一次性铺满所有平台接入：

1. 实施单元 1：Python eval optional extra。
2. 实施单元 2：数据集目录与 schema 校验。
3. 实施单元 3：Python 本地 eval target contract。
4. 实施单元 4：现有回归 baseline runner。
5. 实施单元 8：RAG deterministic metrics。
6. 实施单元 10：Promptfoo SSE adapter fixture test。

达到以上结果后，评测体系已经具备最小闭环：有数据、有本地 target、有 deterministic baseline、有 RAG 专项指标、有黑盒 SSE 解析能力。LangSmith、AgentEvals、Ragas、DeepEval 和 CI gate 可以在这个基础上逐步接入。

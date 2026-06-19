# Interview Agent Evaluation System Plan
## 目标
为当前 interview agent system 建立可运行、可回归、可扩展的评测体系。
采用组合：`pytest/vitest/e2e 现有回归 + LangSmith + AgentEvals 主评测 + Ragas RAG 专项 + Promptfoo/DeepEval 小规模 CI gate`。
系统边界：
- Frontend/BFF host: `G:/project/my-first-agent/my-first-agent`
- 默认 runtime: `G:/project/my-first-agent/my-first-agent-langgraph`
- Rollback runtime: `src/mastra/**`
- 新 runtime 功能和 eval harness 优先落在 sibling LangGraph 仓库。
- 本仓库负责 BFF、frontend、provider e2e、Promptfoo 黑盒 gate。
## 分层架构
```text
L0 Existing Regression: 协议、状态机、schema、SSE、BFF/frontend 不坏
L1 LangSmith + AgentEvals: LangGraph 全流程、节点轨迹、最终输出质量
L2 Ragas: Milvus/RAG/hybrid rerank/question selection 质量
L3 Promptfoo / DeepEval: PR 级黑盒与语义质量 gate
L4 Feedback Loop: outcome、RAG log、用户反馈回流为 eval case
```
## 统一数据集
建议目录：
- `../my-first-agent-langgraph/tests/evals/datasets/interview_cases.jsonl`
- `../my-first-agent-langgraph/tests/evals/datasets/rag_cases.jsonl`
- `../my-first-agent-langgraph/tests/evals/datasets/safety_cases.jsonl`
`interview_cases.jsonl` 字段：
- `case_id`, `resume_markdown`, `job_description_markdown`, `settings`
- `turns`, `expected_stage_path`, `expected_required_skills`
- `must_not_claim`, `rubric`
`rag_cases.jsonl` 字段：
- `case_id`, `query`, `resume_signals`, `jd_signals`
- `expected_question_ids`, `acceptable_skill_areas`, `negative_question_ids`
最小可验证结果：
- 新增 3 条 interview case 和 5 条 RAG case。
- `pytest tests/evals/test_eval_dataset_schema.py` 可以校验 JSONL schema。
隐私前置要求：
- 所有进入 LangSmith、Ragas、DeepEval、Promptfoo 的真实样本必须先脱敏。
- 每条样本记录 `redaction_version`、`source_type`、`source_thread_id_hash`。
- 上传外部平台前再次运行 PII pattern check。
## 依赖策略
Python eval 依赖放在 sibling LangGraph 仓库 optional extra：
- `eval = ["langsmith", "agentevals", "ragas", "deepeval"]`
- PR 默认安装 `.[dev]`，Nightly/手动 eval 安装 `.[dev,eval]`。
- 无 API key 环境只跑 schema/rule/deterministic metrics。
Node eval 依赖放在本仓库：
- 固定 `promptfoo` 版本，不使用临时 latest。
- 本地可用 `npx promptfoo`，CI 应使用 lockfile 安装后的版本。
最小可验证结果：
- `cd ../my-first-agent-langgraph; python -c "import langsmith"` 在 eval 环境通过。
- `npx promptfoo --version` 输出固定版本。
## 子计划 0：现有回归基线
目标：
- 把 deterministic tests 固定为评测体系第一层。
- 防止 LLM judge 掩盖协议、schema、状态机错误。
范围：
- Root: `npm run test:workspace`
- Python: `pytest`
- Python smoke: `npm run test:e2e:interview:smoke:python`
- Python full/nightly: `npm run test:e2e:interview:python`
- Rollback smoke/nightly: `npm run test:e2e:interview:rollback-smoke`
实施：
- 新增 `scripts/run-evaluation-baseline.ps1`。
- 顺序运行 workspace tests、Python pytest、Python smoke。
- Docker 可用时运行 rollback smoke。
- 输出 `evaluation-baseline-summary.json`。
最小可验证结果：
- 单命令生成 summary。
- summary 包含 `name/status/durationSeconds/logPath`。
- 至少包含 workspace tests 与 Python smoke 两组结果。
验收：
- `powershell -ExecutionPolicy Bypass -File ./scripts/run-evaluation-baseline.ps1`
## 子计划 1：LangSmith 主评测
目标：
- 将 Python LangGraph runtime 的整图运行纳入 LangSmith experiment。
- 能看到 graph run、节点、LLM 调用、输入输出和失败 metadata。
环境：
- `LANGSMITH_TRACING=true`
- `LANGSMITH_API_KEY`
- `LANGSMITH_PROJECT=interview-agent-evals`
- `LANGSMITH_ENDPOINT`
实施：
- 新增 `../my-first-agent-langgraph/tests/evals/run_langsmith_interview_eval.py`。
- 读取 `interview_cases.jsonl`。
- 调用 LangGraph graph 或 FastAPI test client。
- 写入 LangSmith dataset/experiment。
- 输出 `langsmith-eval-summary.json`。
统一 target 输出：
- `final_snapshot`: 最终 Mastra-compatible snapshot。
- `assistant_reply`: 最终 assistant 文本。
- `trajectory`: 统一轨迹事件数组。
- `report_status`: 最终报告状态。
- `redaction_version`: 样本脱敏版本。
评估维度：
- `flow_success`, `stage_path_match`, `question_relevance`
- `follow_up_groundedness`, `report_groundedness`
- `state_schema_validity`, `latency_seconds`
最小可验证结果：
- 1 条 deterministic short-flow case 可以跑完。
- summary 中有 `experiment_url` 或 `experiment_id`。
- LangSmith run metadata 包含 `case_id/provider=python/runtime=langgraph`。
验收：
- `cd ../my-first-agent-langgraph; python tests/evals/run_langsmith_interview_eval.py --limit 1`
## 子计划 2：AgentEvals 轨迹评测
目标：
- 评估 agent 中间过程，而不是只评最终报告。
- 覆盖阶段路径、追问依据、检索使用、报告生成门槛。
轨迹规则：
- start request 应进入初始化阶段。
- 简历/JD 信号应被抽取。
- 不跳过专业技能轮时，应产生专业技能问题。
- 项目题应引用项目经历。
- follow-up 应引用上一轮候选回答。
- final report 应等待 evaluation manifest sealed。
实施：
- 新增 `../my-first-agent-langgraph/tests/evals/evaluators/trajectory.py`。
- 将 LangGraph run tree 转为统一 trajectory events。
- 接 AgentEvals trajectory evaluator。
- 保留本地 rule evaluator，降低 LLM judge 波动风险。
最小可验证结果：
- 1 条短流程 case 输出 `trajectory_score`。
- 1 条人为错误路径样本能触发 `failed_rules`。
- 本地 pytest 可验证 rule evaluator。
验收：
- `cd ../my-first-agent-langgraph; pytest tests/evals/test_trajectory_evaluator.py`
- `cd ../my-first-agent-langgraph; python tests/evals/run_langsmith_interview_eval.py --limit 1 --include-trajectory`
## 子计划 3：Ragas RAG 专项
目标：
- 独立评估 Milvus、question retriever、hybrid rerank、question planner。
- 避免 RAG 问题被整场面试最终分数稀释。
评测对象：
- `src/app/domain/question_query.py`
- `src/app/domain/question_retriever.py`
- `src/app/domain/question_planner.py`
- `src/app/domain/rag_recall_sample.py`
指标：
- `context_precision`, `context_recall`, `context_relevance`
- `question_id_hit_rate`, `negative_question_exclusion`
- `skill_area_coverage`, `rerank_top_k_stability`
实施：
- 新增 `../my-first-agent-langgraph/tests/evals/run_ragas_rag_eval.py`。
- 读取 `rag_cases.jsonl`。
- 调用现有 retriever，收集 top-k candidates。
- 转成 Ragas dataset，输出 `ragas-eval-summary.json`。
指标分层：
- PR 必跑 deterministic metrics：`hit_rate@k`, `MRR`, `NDCG`, `negative_question_exclusion`, `skill_area_coverage`。
- Nightly 可选 Ragas LLM metrics：`context_precision`, `context_recall`, `context_relevance`。
- 无 eval model key 时，Ragas LLM metrics 标记为 skipped，不阻断 PR。
最小可验证结果：
- 5 条 RAG case 离线跑完。
- summary 包含 top-k 命中率、MRR、NDCG、负例排除率。
- 有 eval model key 时额外包含平均 context precision。
- 任意一条 case 可打印候选、hybrid score、命中解释。
验收：
- `cd ../my-first-agent-langgraph; python tests/evals/run_ragas_rag_eval.py --limit 5 --top-k 5`
## 子计划 4：Promptfoo 黑盒 Gate
目标：
- 用少量样本在 PR 中快速检查 BFF/runtime 黑盒行为。
- 覆盖 prompt 退化、模型切换异常、SSE 输出破坏。
入口：
- BFF: `POST /api/agents/chat/stream`
- Runtime: `/api/agents/interview-agent/stream`
实施：
- 新增 `evals/promptfoo/interview-smoke.yaml`。
- 新增 `evals/promptfoo/sse-provider.js` 或等价 adapter。
- 配置 3 条 case：basic start、with JD、skip professional skills round。
- adapter 消费 SSE，提取 final snapshot JSON。
- 断言 final snapshot 包含结构化字段。
- 断言不出现 forbidden claims。
- 输出 `promptfoo-results.json`。
最小可验证结果：
- 本地 stack 启动后能跑 3 条 case。
- 至少有一个 JSON field 断言。
- adapter 对一段 fixture SSE 文本有单元测试。
- 失败时 CLI 返回非 0。
验收：
- `npm run start:local`
- `npx promptfoo eval -c evals/promptfoo/interview-smoke.yaml --output promptfoo-results.json`
## 子计划 5：DeepEval 小规模语义 Gate
目标：
- 在 Python pytest 体系内增加少量 LLM 语义质量断言。
- 补足 Promptfoo 不擅长表达的报告事实性和 rubric 一致性。
评估点：
- answer evaluation rubric consistency
- final report factuality
- follow-up answer grounding
- task completion
实施：
- 新增 `../my-first-agent-langgraph/tests/evals/test_deepeval_gate.py`。
- 将 2 条固定 transcript 转成 DeepEval cases。
- 无 API key 时跳过 LLM judge，只跑 schema/rule gate。
- 有 API key 时运行 LLM judge。
最小可验证结果：
- 无 API key 环境下测试 skipped 而不是 failed。
- 有 API key 环境下跑 2 条 case。
- 输出 metric name、score、threshold。
验收：
- `cd ../my-first-agent-langgraph; pytest tests/evals/test_deepeval_gate.py`
- `cd ../my-first-agent-langgraph; deepeval test run tests/evals/test_deepeval_gate.py`
## 子计划 6：CI 分层
目标：
- 控制成本和耗时。
- PR 跑快速 gate，Nightly 跑完整 LLM eval。
PR Gate：
- `npm run test:workspace`
- Python `pytest`
- Python e2e smoke
- Promptfoo 3-case smoke
- DeepEval schema/rule gate
Nightly Gate：
- Full provider e2e
- LangSmith 20-case experiment
- AgentEvals trajectory
- Ragas full suite
- DeepEval LLM judge
- Rollback smoke
Release Gate：
- Nightly 最近一次通过。
- 样本数少于 20 条 interview case 或 30 条 RAG case 时，只记录 baseline，不阻断 release。
- 样本数达标后，LangSmith 关键指标不低于 baseline。
- 样本数达标后，Ragas deterministic top-k/MRR 不低于 baseline。
- 样本数达标后，Report groundedness 不低于 baseline。
- Rollback smoke 至少通过一次。
最小可验证结果：
- 新增 `scripts/run-evaluation-ci-gate.ps1`。
- 本地单命令可运行 PR gate。
- summary 标出 skipped、failed、passed。
验收：
- `powershell -ExecutionPolicy Bypass -File ./scripts/run-evaluation-ci-gate.ps1`
## 子计划 7：反馈回流
目标：
- 将真实失败样本转成新的 eval case。
- 建立持续改进闭环。
数据来源：
- `Interview outcome/`, `RAG LOG INFO/`
- Redis evaluation manifests, report markdown
- frontend user feedback, LangSmith traces
实施：
- 新增 `scripts/export-eval-case-from-outcome.ps1`。
- 输入 threadId 或 artifact path。
- 输出脱敏后的 `interview_case.json` 草稿。
- 人工 review 后追加到 dataset。
脱敏规则：
- 删除姓名、邮箱、手机号、公司敏感信息。
- 保留技能、项目类型、技术关键词。
- 保留失败原因和期望行为。
最小可验证结果：
- 用一个本地 outcome artifact 导出 case 草稿。
- schema 校验通过。
- 输出不包含邮箱或手机号模式。
验收：
- `powershell -ExecutionPolicy Bypass -File ./scripts/export-eval-case-from-outcome.ps1 -ThreadId <threadId>`
## 初始指标门槛
- `flow_success`: 100% for smoke cases
- `state_schema_validity`: 100%
- `question_relevance`: >= 0.75
- `follow_up_groundedness`: >= 0.70
- `report_groundedness`: >= 0.80
- `rag_top_5_hit_rate`: >= 0.70
- `negative_question_exclusion`: >= 0.90
- `promptfoo_smoke_pass_rate`: 100%
成熟后提升：
- `question_relevance`: >= 0.85
- `follow_up_groundedness`: >= 0.80
- `rag_top_5_hit_rate`: >= 0.85
- `report_groundedness`: >= 0.90
## 推荐目录
```text
my-first-agent/
  evals/promptfoo/interview-smoke.yaml
  scripts/run-evaluation-baseline.ps1
  scripts/run-evaluation-ci-gate.ps1
my-first-agent-langgraph/
  tests/evals/datasets/interview_cases.jsonl
  tests/evals/datasets/rag_cases.jsonl
  tests/evals/datasets/safety_cases.jsonl
  tests/evals/evaluators/trajectory.py
  tests/evals/test_eval_dataset_schema.py
  tests/evals/test_trajectory_evaluator.py
  tests/evals/test_deepeval_gate.py
  tests/evals/run_langsmith_interview_eval.py
  tests/evals/run_ragas_rag_eval.py
```
## 第一周最小成果
- Baseline runner 可以生成 summary。
- Interview dataset 有 3 条样本。
- RAG dataset 有 5 条样本。
- LangSmith 可以跑 1 条 short-flow case。
- Ragas 可以跑 5 条 RAG case。
- Promptfoo 可以跑 3 条黑盒 smoke。
- 达到以上结果后，评测体系具备最小闭环。

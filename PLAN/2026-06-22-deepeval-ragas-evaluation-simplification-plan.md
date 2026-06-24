# DeepEval + Ragas Evaluation Simplification Plan

## Goal

精简当前 interview agent 评估体系，只保留 DeepEval 和 Ragas 两个评估引擎。

- DeepEval 负责 interview agent 输出质量评估：回答评分一致性、追问合理性、报告事实性、任务完成度和 forbidden claims。
- Ragas 负责 RAG 检索质量评估：context precision、context recall、context relevance，以及 RAG case 到 Ragas dataset 的映射。
- DeepSeek 作为评估模型，API key 只通过本地环境变量或 CI secret 注入，不写入仓库。

## Environment Contract

本地或 CI 运行真实 LLM judge 时设置：

```powershell
$env:EVAL_MODEL_PROVIDER="deepseek"
$env:EVAL_MODEL_NAME="deepseek-chat"
$env:EVAL_MODEL_BASE_URL="https://api.deepseek.com"
$env:DEEPSEEK_API_KEY="<set in shell or CI secret>"
```

无 key 时，DeepEval / Ragas 的真实 LLM judge 应清晰 skipped，本地 schema、mapping 和 rule sanity check 仍可运行。

## Current Findings

当前评估体系分散在两个仓库：

- Host repo: `G:\project\my-first-agent\my-first-agent`
- Python LangGraph runtime: `G:\project\my-first-agent\my-first-agent-langgraph`

已确认 Python 环境安装：

- `deepeval==4.0.6`
- `ragas==0.4.3`
- `langchain-openai==1.3.2`

当前存在的评估/准评估入口：

- Python `tests/evals/test_deepeval_gate.py`
- Python `tests/evals/run_rag_eval.py`
- Python `tests/evals/run_langsmith_interview_eval.py`
- Python `tests/evals/evaluators/agent_evals_adapter.py`
- Python trajectory rule evaluator
- Host Promptfoo adapter and black-box smoke
- Host evaluation baseline / CI gate runners
- Historical Mastra / Redis answer evaluation artifacts

## Target Final State

最终只保留以下评估入口：

```powershell
cd G:\project\my-first-agent\my-first-agent-langgraph
python -m pytest tests\evals\test_deepeval_gate.py
python tests\evals\run_rag_eval.py --include-ragas
```

Host repo 只保留一个统一编排入口：

```powershell
cd G:\project\my-first-agent\my-first-agent
npm run test:evaluation:ci-gate
```

该入口只应执行：

- eval dataset schema / mapping sanity check
- DeepEval gate
- Ragas gate
- `ruff check tests/evals`

## Implementation Phases

### Phase 1: Freeze Inventory And Removal List

Status: completed

Objective:

- 冻结当前评估体系现状。
- 建立明确删除 / 保留 / 降级清单。
- 不删除代码，不改运行逻辑。

Removal candidates:

- `../my-first-agent-langgraph/tests/evals/run_langsmith_interview_eval.py`
- `../my-first-agent-langgraph/tests/evals/evaluators/agent_evals_adapter.py`
- `../my-first-agent-langgraph/tests/evals/test_agent_evals_adapter.py`
- `../my-first-agent-langgraph/tests/evals/test_langsmith_eval_mapping.py`
- `evals/promptfoo/**`
- `package.json` script `test:evaluation:promptfoo`
- host CI/baseline runner steps referencing Promptfoo, LangSmith, or AgentEvals as evaluation gates
- docs/PLAN sections presenting LangSmith, AgentEvals, Promptfoo, Mastra Redis evaluation workers, or deterministic trajectory rules as core evaluation engines

Keep:

- `../my-first-agent-langgraph/tests/evals/datasets/interview_cases.jsonl`
- `../my-first-agent-langgraph/tests/evals/datasets/rag_cases.jsonl`
- `../my-first-agent-langgraph/tests/evals/datasets/safety_cases.jsonl`
- `../my-first-agent-langgraph/tests/evals/test_eval_dataset_schema.py`
- `../my-first-agent-langgraph/tests/evals/run_interview_eval_target.py`
- `../my-first-agent-langgraph/tests/evals/test_deepeval_gate.py`
- `../my-first-agent-langgraph/tests/evals/run_rag_eval.py`

Downgrade to helper tests only:

- trajectory rule evaluator
- deterministic RAG metrics

Self-test:

```powershell
cd G:\project\my-first-agent\my-first-agent
rg -n "LangSmith|AgentEvals|Promptfoo|run_langsmith|agent_evals" docs PLAN scripts package.json ..\my-first-agent-langgraph\tests\evals
```

Pass condition:

- Every hit is classified as a removal candidate, historical note, or non-evaluation tracing concern.

### Phase 2: Add Shared DeepSeek Judge Configuration

Status: completed

Objective:

- Add one eval judge factory for DeepEval and Ragas.
- Use DeepSeek through OpenAI-compatible APIs.
- Keep secrets out of files.

Likely files:

- `../my-first-agent-langgraph/tests/evals/evaluators/deepseek_judge.py`
- `../my-first-agent-langgraph/.env.example`
- `../my-first-agent-langgraph/tests/evals/test_eval_judge_config.py`

Self-test:

```powershell
cd G:\project\my-first-agent\my-first-agent-langgraph
python -m pytest tests\evals\test_eval_judge_config.py
python -c "import deepeval, ragas; print(deepeval.__version__, ragas.__version__)"
```

### Phase 3: Rebuild DeepEval Gate

Status: completed

Objective:

- Make DeepEval the only interview output quality evaluator.
- Drive cases from `interview_cases.jsonl` and local eval target output.

Likely files:

- `../my-first-agent-langgraph/tests/evals/test_deepeval_gate.py`
- `../my-first-agent-langgraph/tests/evals/run_interview_eval_target.py`

Metrics:

- answer relevancy
- report factuality / faithfulness
- follow-up grounding
- task completion
- forbidden claims absence

Self-test:

```powershell
cd G:\project\my-first-agent\my-first-agent-langgraph
python -m pytest tests\evals\test_deepeval_gate.py
deepeval test run tests\evals\test_deepeval_gate.py
```

### Phase 4: Rebuild Ragas Gate

Status: completed

Objective:

- Make Ragas the only RAG quality evaluator.
- Convert `rag_cases.jsonl` into Ragas 0.4.3 `EvaluationDataset` / `SingleTurnSample` inputs.

Likely files:

- `../my-first-agent-langgraph/tests/evals/run_rag_eval.py`
- `../my-first-agent-langgraph/tests/evals/test_ragas_mapping.py`

Metrics:

- context precision
- context recall
- context relevance or the closest available Ragas 0.4.3 equivalent

Self-test:

```powershell
cd G:\project\my-first-agent\my-first-agent-langgraph
python -m pytest tests\evals\test_ragas_mapping.py
python tests\evals\run_rag_eval.py --limit 5 --top-k 5 --include-ragas
```

### Phase 5: Simplify Host Evaluation Commands

Status: completed

Objective:

- Make host `test:evaluation:ci-gate` run only DeepEval + Ragas evaluation gates and their sanity checks.
- Remove Promptfoo / LangSmith / AgentEvals from evaluation scripts.

Likely files:

- `package.json`
- `scripts/run-evaluation-ci-gate.ps1`
- `scripts/run-evaluation-baseline.ps1`

Self-test:

```powershell
cd G:\project\my-first-agent\my-first-agent
npm run test:evaluation:ci-gate
```

### Phase 6: Update Evaluation Docs

Status: completed

Objective:

- Replace the broad multi-platform evaluation documentation with the two-engine model.
- Keep LangSmith described only as tracing if needed, not as evaluation.

Likely files:

- `docs/INTERVIEW_AGENT_EVALUATION_USAGE.md`
- this plan file
- historical evaluation plan only if it is still presented as current guidance

Self-test:

```powershell
cd G:\project\my-first-agent\my-first-agent
rg -n "AgentEvals|Promptfoo|LangSmith evaluation|run_langsmith" docs PLAN scripts package.json
cd ..\my-first-agent-langgraph
python -m pytest tests\evals
python -m ruff check tests\evals
```

## Progress Log

- 2026-06-22: Plan created. Phase 1 inventory completed. Current system has DeepEval and Ragas installed, but also has LangSmith, AgentEvals, Promptfoo, trajectory rules, deterministic RAG metrics, and historical Mastra/Redis evaluation references. These non-target evaluation surfaces are now classified for removal or downgrade.
- 2026-06-22: Phase 1 self-test ran with `rg -n "LangSmith|AgentEvals|Promptfoo|run_langsmith|agent_evals" docs PLAN scripts package.json ..\my-first-agent-langgraph\tests\evals`. Results confirmed the expected cleanup targets: Python LangSmith runner/tests, Python AgentEvals adapter/tests, host Promptfoo CI/script/docs references, and the older broad evaluation plan. Observability-only LangSmith references in `docs/observability.md` and `PLAN/2026-06-18-opentelemetry-tempo-grafana-langsmith-plan.md` are tracing concerns, not evaluation gates.
- 2026-06-22: Phase 2 completed. Added shared DeepSeek eval judge wiring in `../my-first-agent-langgraph/tests/evals/evaluators/deepseek_judge.py`, added `tests/evals/test_eval_judge_config.py`, switched DeepEval and Ragas key detection to the shared config, and documented eval-specific environment variables in `../my-first-agent-langgraph/.env.example`. Self-test passed with `python -m pytest tests\evals\test_eval_judge_config.py tests\evals\test_deepeval_gate.py tests\evals\test_rag_metrics.py` showing `13 passed, 1 skipped`; ruff passed for the touched eval files.
- 2026-06-22: Ran project architecture sync check after Phase 2. No architecture instruction update needed because the change only added eval test wiring and `.env.example` placeholders; it did not alter runtime entrypoints, BFF/frontend data flow, LangGraph contract, persistence, or folder responsibilities. Recorded guard with `node .github\hooks\scripts\project-architecture-sync-guard.mjs record`.
- 2026-06-22: Phase 3 completed. Rebuilt `../my-first-agent-langgraph/tests/evals/test_deepeval_gate.py` so DeepEval now drives from `run_interview_eval_target.run_cases()` and `interview_cases.jsonl` instead of hard-coded demo strings. The rule fallback verifies target summary shape, report DB/status boundary, forbidden claims, and required stage/report fragments. The LLM judge path uses DeepSeek-backed `GEval` when an eval key is configured. Self-test passed with `python -m pytest tests\evals\test_deepeval_gate.py tests\evals\test_eval_judge_config.py` showing `7 passed, 1 skipped`; ruff passed for `test_deepeval_gate.py` and `deepseek_judge.py`. CLI validation with `deepeval test run ...` could not run because `deepeval` is not on PATH, and `python -m deepeval` is not supported by the installed package; pytest plugin validation remains the working local entry.
- 2026-06-22: Ran project architecture sync check after Phase 3. No architecture instruction update needed because the change only rebuilt the eval test gate and did not alter runtime entrypoints, BFF/frontend data flow, LangGraph contract, persistence, or folder responsibilities. Recorded guard with `node .github\hooks\scripts\project-architecture-sync-guard.mjs record`.
- 2026-06-22: Phase 4 completed. Rebuilt Ragas wiring in `../my-first-agent-langgraph/tests/evals/run_rag_eval.py` so `--include-ragas` now maps `rag_cases.jsonl` and deterministic candidate selections into Ragas 0.4.3 `EvaluationDataset` inputs and runs `ContextPrecision`, `ContextRecall`, and `ContextRelevance` with the shared DeepSeek-backed Ragas LLM when an eval key is configured. Added `tests/evals/test_ragas_mapping.py` and hardened the existing skipped-path test to clear local eval keys. Self-test passed with `python -m pytest tests\evals\test_ragas_mapping.py tests\evals\test_rag_metrics.py tests\evals\test_eval_judge_config.py` showing `14 passed`; ruff passed for touched RAG eval files. CLI smoke passed with `python tests\evals\run_rag_eval.py --limit 5 --top-k 5 --include-ragas --output .tmp\phase4-rag-eval-summary.json`, producing deterministic metrics and `ragas.status=skipped` because no eval key is configured in this shell.
- 2026-06-22: Ran project architecture sync check after Phase 4. No architecture instruction update needed because the change only rebuilt Ragas eval test/script wiring and did not alter runtime entrypoints, BFF/frontend data flow, LangGraph contract, persistence, or folder responsibilities. Recorded guard with `node .github\hooks\scripts\project-architecture-sync-guard.mjs record`.
- 2026-06-22: Phase 5 completed. Replaced host `scripts/run-evaluation-ci-gate.ps1` with a four-step DeepEval/Ragas-only runner: `eval-dataset-schema`, `deepeval-gate`, `ragas-gate`, and `eval-ruff`. Removed `test:evaluation:promptfoo` plus the Promptfoo dev dependency/override from `package.json`, then ran `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` to sync the lockfile. Validation passed with `npm run test:evaluation:ci-gate`; the generated summary contains only the four DeepEval/Ragas-related steps and no Promptfoo/LangSmith/AgentEvals gate.
- 2026-06-22: Ran project architecture sync check after Phase 5. No architecture instruction update needed because the change only simplified evaluation scripts and npm command surface; it did not alter host runtime entrypoints, BFF/frontend data flow, LangGraph contract, persistence, or folder responsibilities. Recorded guard with `node .github\hooks\scripts\project-architecture-sync-guard.mjs record`.
- 2026-06-22: Phase 6 completed. Rewrote `docs/INTERVIEW_AGENT_EVALUATION_USAGE.md` around the two-engine model: DeepEval for interview output quality and Ragas for RAG retrieval quality. Replaced the older broad evaluation plan at `PLAN/2026-06-19-interview-agent-evaluation-system-plan.md` with a superseded notice pointing to this plan. Reference check passed with no hits for removed evaluation gate terms in `docs`, `scripts`, `package.json`, or the superseded plan. Validation passed with `npm run test:evaluation:ci-gate`, `python -m pytest tests\evals\test_eval_dataset_schema.py tests\evals\test_deepeval_gate.py tests\evals\test_ragas_mapping.py tests\evals\test_rag_metrics.py` showing `17 passed, 1 skipped`, and `python -m ruff check tests\evals`.
- 2026-06-22: Ran project architecture sync after Phase 6. Updated `.github/instructions/project-architecture.instructions.md` high-value references to include the current evaluation usage guide and this DeepEval/Ragas simplification plan. Recorded guard with `node .github\hooks\scripts\project-architecture-sync-guard.mjs record`.
- 2026-06-22: Added the expanded DeepEval metric pool for interview follow-up generation and report generation. Follow-up generation now declares required `FaithfulnessMetric`, `HallucinationMetric`, `BiasMetric`, `ToxicityMetric`; optional `AnswerRelevancyMetric`, `ContextualRelevancyMetric`; and custom `GEval` metrics for specificity, non-repetition, and logical coherence. Report generation now declares required `FaithfulnessMetric`, `HallucinationMetric`, `SummarizationMetric`, `BiasMetric`, `PromptAlignmentMetric`; optional `TaskCompletionMetric`, `AnswerRelevancyMetric`; and custom `GEval` metrics for dimension coverage, score consistency, and actionable advice. Updated `docs/INTERVIEW_AGENT_EVALUATION_USAGE.md` to document the same pool. Validation passed with `python -m pytest tests\evals\test_deepeval_gate.py tests\evals\test_eval_judge_config.py` showing `8 passed, 1 skipped`, and `python -m ruff check tests\evals\test_deepeval_gate.py`.
- 2026-06-22: Ran project architecture sync after the DeepEval metric pool addition. No architecture instruction update needed because the change only expanded evaluation test metrics and documentation; it did not alter runtime entrypoints, BFF/frontend data flow, LangGraph contract, persistence, or folder responsibilities. Recorded guard with `node .github\hooks\scripts\project-architecture-sync-guard.mjs record`.

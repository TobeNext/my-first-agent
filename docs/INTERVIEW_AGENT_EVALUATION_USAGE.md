# Interview Agent 评测体系使用说明

本文档说明当前 interview agent evaluation system 的目录、命令、数据集、模型 key 配置和常见排障方式。

当前评测体系已经精简为两个引擎：

- DeepEval：评估 interview agent 输出质量。
- Ragas：评估 RAG 检索质量。

## 1. 架构边界

当前系统分为两个仓库：

- Host / BFF / Frontend：`G:\project\my-first-agent\my-first-agent`
- Python LangGraph runtime：`G:\project\my-first-agent\my-first-agent-langgraph`

Python LangGraph runtime 是唯一维护中的 interview agent runtime。新的评测能力放在 sibling Python 仓库的 `tests/evals/**`；host 仓库只保留一个 evaluation CI gate 编排脚本。

重要约束：

- Python runtime 的报告真源是 report DB，不是 Redis manifest，也不是 checkpoint DB。
- SSE 必须保持前端/BFF 既有 contract：`text-delta`、`tool-result`、`[DONE]`。
- 真实样本必须先脱敏，并记录 `redaction_version`。
- API key 只能通过本地 shell 环境变量或 CI secret 注入，不能写入仓库。
- 无 eval key 时，真实 LLM judge 会 skipped；schema、mapping 和 rule fallback 仍应通过。

## 2. 目录速览

Host 仓库：

```text
scripts/run-evaluation-ci-gate.ps1
scripts/run-evaluation-baseline.ps1
scripts/export-eval-case-from-outcome.ps1
evaluation-ci-gate-summary.json
evaluation-baseline-summary.json
```

Python LangGraph 仓库：

```text
tests/evals/datasets/interview_cases.jsonl
tests/evals/datasets/rag_cases.jsonl
tests/evals/datasets/safety_cases.jsonl
tests/evals/evaluators/deepseek_judge.py
tests/evals/evaluators/rag_metrics.py
tests/evals/run_interview_eval_target.py
tests/evals/run_rag_eval.py
tests/evals/test_deepeval_gate.py
tests/evals/test_ragas_mapping.py
tests/evals/test_eval_dataset_schema.py
tests/evals/test_eval_judge_config.py
tests/evals/test_rag_metrics.py
```

## 3. 模型配置

真实 LLM judge 使用 DeepSeek OpenAI-compatible API。推荐在当前 shell 或 CI secret 中设置：

```powershell
$env:EVAL_MODEL_PROVIDER="deepseek"
$env:EVAL_MODEL_NAME="deepseek-chat"
$env:EVAL_MODEL_BASE_URL="https://api.deepseek.com"
$env:DEEPSEEK_API_KEY="<set in shell or CI secret>"
```

可选覆盖：

```powershell
$env:EVAL_MODEL_API_KEY="<alternative eval key>"
$env:EVAL_MODEL_TIMEOUT_SECONDS="90"
$env:EVAL_MODEL_MAX_RETRIES="2"
$env:EVAL_MODEL_TEMPERATURE="0"
```

`EVAL_MODEL_API_KEY` 优先级高于 `DEEPSEEK_API_KEY`。

## 4. 最常用命令

在 host 仓库运行完整 evaluation gate：

```powershell
cd G:\project\my-first-agent\my-first-agent
npm run test:evaluation:ci-gate
```

该命令只包含四步：

- `eval-dataset-schema`
- `deepeval-gate`
- `ragas-gate`
- `eval-ruff`

输出：

```text
evaluation-ci-gate-summary.json
.tmp/evaluation-ci-gate/<runId>/*.log
```

如果只想在 Python 仓库中跑单项：

```powershell
cd G:\project\my-first-agent\my-first-agent-langgraph
python -m pytest tests\evals\test_deepeval_gate.py
python -m pytest tests\evals\test_ragas_mapping.py tests\evals\test_rag_metrics.py
python tests\evals\run_rag_eval.py --limit 5 --top-k 5 --include-ragas
python -m ruff check tests\evals
```

## 5. DeepEval Gate

入口：

```powershell
cd G:\project\my-first-agent\my-first-agent-langgraph
python -m pytest tests\evals\test_deepeval_gate.py
```

职责：

- 从 `interview_cases.jsonl` 读取 case。
- 调用 `run_interview_eval_target.run_cases()` 生成本地 target 输出。
- rule fallback 检查输出 shape、报告 DB/status 边界、forbidden claims 和必要阶段片段。
- 有 eval key 时，通过 DeepEval 内置指标和自定义 `GEval` 指标进行语义评分。

追问生成指标：

- 必选：`FaithfulnessMetric`、`HallucinationMetric`、`BiasMetric`、`ToxicityMetric`
- 可选：`AnswerRelevancyMetric`、`ContextualRelevancyMetric`
- 自定义 `GEval`：`followup-specificity`、`followup-non-repetition`、`followup-logical-coherence`

报告生成指标：

- 必选：`FaithfulnessMetric`、`HallucinationMetric`、`SummarizationMetric`、`BiasMetric`、`PromptAlignmentMetric`
- 可选：`TaskCompletionMetric`、`AnswerRelevancyMetric`
- 自定义 `GEval`：`report-dimension-coverage`、`report-score-consistency`、`report-actionable-advice`

无 key 时预期：

```text
LLM judge skipped; rule fallback gate already ran.
```

## 6. Ragas Gate

入口：

```powershell
cd G:\project\my-first-agent\my-first-agent-langgraph
python tests\evals\run_rag_eval.py --limit 5 --top-k 5 --include-ragas
```

职责：

- 从 `rag_cases.jsonl` 读取 RAG case。
- 先生成 deterministic candidate selections 和本地 RAG metrics。
- 将 case 与 candidate selections 映射为 Ragas 0.4.3 `EvaluationDataset`。
- 有 eval key 时运行：
  - `ContextPrecision`
  - `ContextRecall`
  - `ContextRelevance`

无 key 时输出示例：

```json
{
  "ragas": {
    "status": "skipped",
    "skippedReason": "No eval model API key is configured."
  }
}
```

## 7. 数据集

数据集位置：

```text
tests/evals/datasets/interview_cases.jsonl
tests/evals/datasets/rag_cases.jsonl
tests/evals/datasets/safety_cases.jsonl
```

校验命令：

```powershell
cd G:\project\my-first-agent\my-first-agent-langgraph
python -m pytest tests\evals\test_eval_dataset_schema.py
```

所有样本必须包含：

- `case_id`
- `redaction_version`
- `source_type`
- `source_thread_id_hash`

真实样本要求：

- `source_type` 使用 `redacted-production`。
- `source_thread_id_hash` 只能保存 hash，不保存原始 thread id。
- 不允许出现邮箱、手机号、长数字身份标识等明显 PII。

## 8. 本地 Eval Target

位置：

```text
G:\project\my-first-agent\my-first-agent-langgraph\tests\evals\run_interview_eval_target.py
```

运行：

```powershell
cd G:\project\my-first-agent\my-first-agent-langgraph
python tests\evals\run_interview_eval_target.py --limit 1 --include-trajectory --output .tmp\interview-eval-target-summary.json
```

该 target 是 DeepEval 的输入生成器，不是独立评估平台。默认行为：

- 使用 mock model。
- 使用临时 checkpoint/report DB。
- 使用离线空题库，避免本地 Milvus 不可用时失败。
- wrap-up 后调用后台 report runner，并验证 report DB status。
- 输出不包含简历、JD、回答正文或报告正文。

## 9. Baseline Runner

baseline runner 仍用于普通回归，不属于当前精简后的 evaluation gate。

```powershell
cd G:\project\my-first-agent\my-first-agent
.\scripts\run-evaluation-baseline.ps1
```

默认步骤：

- `npm run test:workspace`
- `python -m pytest tests`
- `npm run test:e2e:interview:smoke:python`
- Docker 可用时运行 historical rollback smoke

输出：

```text
evaluation-baseline-summary.json
.tmp/evaluation-baseline/<runId>/*.log
```

## 10. 反馈回流 Exporter

从 outcome artifact 导出 eval case 草稿：

```powershell
cd G:\project\my-first-agent\my-first-agent
.\scripts\export-eval-case-from-outcome.ps1 -ThreadId <threadId>
```

也可以直接指定 artifact：

```powershell
.\scripts\export-eval-case-from-outcome.ps1 -ArtifactPath "G:\path\to\interview-outcome.json"
```

输出：

```text
.tmp/eval-case-drafts/<threadId>-interview-case-draft.json
```

导出的草稿必须人工 review 后才追加到正式 JSONL 数据集。

## 11. 推荐工作流

本地开发最小评测：

```powershell
cd G:\project\my-first-agent\my-first-agent
npm run test:evaluation:ci-gate
```

样本或 mapping 变更后：

```powershell
cd G:\project\my-first-agent\my-first-agent-langgraph
python -m pytest tests\evals\test_eval_dataset_schema.py
python -m pytest tests\evals\test_deepeval_gate.py
python -m pytest tests\evals\test_ragas_mapping.py tests\evals\test_rag_metrics.py
python -m ruff check tests\evals
```

有真实 eval key 时：

```powershell
$env:DEEPSEEK_API_KEY="<set in shell or CI secret>"
npm run test:evaluation:ci-gate
```

## 12. 常见问题

### `.venv\Scripts\python` 不存在

Host runner 会优先使用 `../my-first-agent-langgraph/.venv`，不存在时回退到 PATH 上的 `python`。

### DeepEval LLM judge skipped

这是无 key 环境下的预期行为。设置 `DEEPSEEK_API_KEY` 或 `EVAL_MODEL_API_KEY` 后会启用真实 judge。

### Ragas skipped

这是无 key 或 optional dependency 不可用时的预期行为。无 key 时 deterministic RAG metrics 和 mapping tests 仍会运行。

### `deepeval test run` 不可用

当前本机安装的 Python package 已能通过 pytest 插件运行 DeepEval tests，但 CLI 不在 PATH，且该 package 不支持 `python -m deepeval`。本地入口以 pytest 为准。

### evaluation gate 很慢

DeepEval gate 会调用本地 eval target 运行一个短面试 case，通常比纯 schema test 慢。先看 `evaluation-ci-gate-summary.json` 中每个 step 的 `durationSeconds` 和对应 log。

### 导出的 eval case 为空

历史 outcome artifact 的字段结构可能不同。Exporter 会尽量抽取通用字段，但仍要求人工 review 和补齐期望行为。

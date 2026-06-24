# 简历-JD 匹配式题库召回改造计划

> 日期：2026-06-19
> 本次修订：2026-06-23
> 依据：`PLAN/resume-JD-match.md`、当前 host/BFF/frontend contract、`../my-first-agent-langgraph` 当前代码
> 唯一维护运行时：`../my-first-agent-langgraph`

## 0. 修订原则

1. 未来 interview runtime 能力只落在 `../my-first-agent-langgraph`，不再新增 Mastra 回滚、兼容或对齐工作。
2. 保持现有前端/BFF SSE contract：继续输出 `text-delta`、`interviewStateManagerTool` 的 `tool-result` snapshot 和 `[DONE]`。
3. 尽可能小改动：优先在 Python runtime 的初始化 domain 层增加结构化 match analysis，不改前端/BFF 请求形状，不破坏旧 checkpoint 默认值。
4. 若简历与 JD 的匹配部分为空，初始化阶段直接结束面试流程，`assistantReply` 明确说明原因是岗位不匹配，不进入题目召回、生成、裁决，也不触发报告生成。
5. Agent 输出内容必须结构化为三部分：
   - 第一部分：`resumeJdMatch`，简历和 JD 匹配的部分。
   - 第二部分：`resumeOnly`，简历单独具备但 JD 未要求或未明确要求的部分，可为空。
   - 第三部分：`jdOnly`，JD 要求但简历未体现的部分，可为空。

## 0.1 当前执行状态

> 更新日期：2026-06-23

已完成：

- Unit 01：新增 LLM 三段 match analysis。
- Unit 02：初始化链路接入空匹配非报告终止。
- Unit 03：按三段结构驱动专业问题召回。
- Unit 04：planner 使用三段结构优化题目分配。
- Unit 06：metadata schema 扩展，保持旧数据兼容。
- Unit 07：真正的 hybrid retrieval 接口第一阶段，新增可选 keyword recall + RRF merge。
- Unit 08：metadata rerank 完整化，RAG trace 输出 score breakdown 和 matched metadata。
- Unit 09：session 去重与覆盖控制第一阶段，初始化阶段按 question id 和文本近似去重。
- Unit 10：端到端回归与观测。

暂不执行：

- Unit 05：三段结果持久化到 session state。当前需求明确“三段结构化结果只要求 runtime 内部结构化流转”，因此不扩展 checkpoint state、SSE snapshot、BFF 或前端 contract。

已验证：

```bash
python -m pytest tests/unit/test_resume_jd_match.py tests/unit/test_interview_initialization_pipeline.py tests/unit/test_question_query.py tests/unit/test_question_retriever.py
python -m pytest tests/unit/test_question_metadata.py tests/unit/test_milvus_store.py tests/unit/test_interview_state_schema.py
python -m pytest tests/unit/test_question_retriever.py
python -m pytest tests/unit/test_question_retriever.py tests/unit/test_outcome_and_rag_artifacts.py
python -m pytest tests/unit/test_question_retriever.py tests/unit/test_interview_initialization_pipeline.py
python -m pytest tests/contract/test_mastra_sse_compat.py tests/contract/test_mastra_stream_request.py
python -m pytest tests/integration/test_interview_short_flow.py tests/contract/test_mastra_sse_compat.py
npm run test:e2e:interview:smoke:python
python -m ruff check src/app/domain/resume_jd_match.py src/app/domain/interview_initialization_pipeline.py src/app/domain/question_planner.py src/app/domain/question_query.py src/app/domain/question_retriever.py tests/unit/test_resume_jd_match.py tests/unit/test_interview_initialization_pipeline.py tests/unit/test_question_query.py tests/unit/test_question_retriever.py
python -m ruff check src/app/domain/question_metadata.py src/app/integrations/milvus_store.py src/app/schemas/interview_state.py tests/unit/test_question_metadata.py tests/unit/test_milvus_store.py
python -m ruff check src/app/domain/question_retriever.py src/app/integrations/keyword_question_store.py tests/unit/test_question_retriever.py
python -m ruff check src/app/domain/question_retriever.py src/app/domain/rag_recall_sample.py tests/unit/test_question_retriever.py tests/unit/test_outcome_and_rag_artifacts.py
python -m ruff check src/app/domain/question_retriever.py tests/unit/test_question_retriever.py tests/unit/test_interview_initialization_pipeline.py tests/unit/test_outcome_and_rag_artifacts.py
```

## 1. 当前逻辑整理

### 1.1 前端/BFF 到运行时

用户上传简历和可选 JD 后，前端构造结构化启动请求，经 BFF 代理到默认 Python LangGraph runtime。

```json
{
  "requestKind": "interview-start",
  "protocolVersion": "2026-05-structured-start-v1",
  "threadId": "string",
  "resumeMarkdown": "string",
  "jobDescriptionMarkdown": "string",
  "settings": {
    "reviewIncorrectOrMissingPoints": true,
    "skipProfessionalSkillsRound": false,
    "skipProjectExperienceRound": false,
    "enableFlowTestMode": false,
    "enableHistoricalMemory": true,
    "professionalQuestionMode": "per-skill-default|custom-count",
    "professionalQuestionCount": 0,
    "projectQuestionCount": 0
  },
  "resumeSections": {
    "professionalSkills": "string",
    "projectExperience": "string"
  }
}
```

当前前端/BFF 依赖的 stream snapshot 字段包括：

```json
{
  "assistantReply": "string",
  "phase": "string",
  "activeRoundType": "string|null",
  "activeNodeTopic": "string|null",
  "finalReportReady": false,
  "progress": {}
}
```

因此本计划不要求前端/BFF 先行改 contract。三段结构化结果先在 Python runtime 的 state/resources/artifact 内部流转；如需暴露到 UI，再另开前端/BFF 小步。

### 1.2 LangGraph 初始化链路

入口：`../my-first-agent-langgraph/src/app/domain/interview_initialization_pipeline.py`

当前数据流：

```text
raw_kickoff_message
  -> extract_structured_interview_start_request()
  -> extract_parsed_resume_from_kickoff_message()
  -> plan_professional_question_queries()
  -> retrieve_initialization_questions()
  -> generate_initialization_question_set()
  -> judge_initialization_question_set()
  -> InterviewSessionState
```

目标数据流：

```text
raw_kickoff_message
  -> extract_structured_interview_start_request()
  -> extract_parsed_resume_from_kickoff_message()
  -> build_resume_jd_match_analysis_with_llm()
      -> resumeJdMatch[]
      -> resumeOnly[]
      -> jdOnly[]
      -> isJobMatched
      -> mismatchReason
  -> if resumeJdMatch is empty and jobDescription is not empty:
      -> build_mismatch_completed_session()
      -> assistantReply = "面试流程已结束：岗位不匹配。..."
      -> return without RAG retrieval/generation/judgement/report generation
  -> plan_professional_question_queries(matchAnalysis)
  -> retrieve_initialization_questions(matchAnalysis)
  -> generate_initialization_question_set()
  -> judge_initialization_question_set()
  -> InterviewSessionState
```

### 1.3 当前可复用代码点

- `job_description_signals.py` 已能从 JD 提取 `responsibilities`、`technicalRequirements`、`preferredSkills`、`domainTerms`、`alignedSignals`、`gapSignals` 和 `priorityKeywords`。
- `resume_parser.py` / kickoff recovery 已能得到 `professionalSkillsSection`、`projectExperienceSection`、`normalizedSkills` 和 `normalizedProjectTopics`。
- `question_planner.py` 已有 `ProfessionalQuestionPlan`，包含 `resumeSignals`、`jobDescriptionSignals`、`questionDriver` 和历史弱项强化字段。
- `interview_initialization_pipeline.py` 是最小数据流接入点，当前已集中持有 resume、JD、settings、historical memory、planning、retrieval、generation 和 judgement。
- `InterviewSessionState` 使用 Pydantic `extra="ignore"`，新增可选字段要保持默认值，兼容旧 checkpoint。

## 2. 已完成的第一片改造

改动位置：`../my-first-agent-langgraph`

### 2.1 新增 requery schema

```json
{
  "type": "skill_exact|job_scenario|capability_probe",
  "query": "string"
}
```

新增函数：

```text
build_professional_requeries(plan, resume, project, normalized_skills)
  -> [skill_exact, job_scenario, capability_probe]
```

### 2.2 新召回链路

```text
ProfessionalQuestionPlan
  -> build_professional_requeries()
  -> 每个 query 独立 embed + Milvus vector topK=20
  -> RRF merge by question id
  -> metadata_rerank_questions()
  -> deterministic topK
```

当前 metadata rerank 权重：

```text
final_score =
  0.25 * retrieval_score
+ 0.25 * metadata_skill_match_score
+ 0.20 * metadata_job_match_score
+ 0.10 * question_type_score
+ 0.10 * difficulty_match_score
+ 0.10 * novelty_score
```

### 2.3 已跑最小测试

```bash
python -m ruff check src/app/domain/question_query.py src/app/domain/question_retriever.py tests/unit/test_question_query.py tests/unit/test_question_retriever.py
python -m pytest tests/unit/test_question_query.py tests/unit/test_question_retriever.py tests/unit/test_question_metadata.py
```

结果：12 passed，ruff passed。

## 3. 目标结构化输出

### 3.1 Match analysis schema

新增内部 schema，建议放在 `app.domain.resume_jd_match`。第一步使用 Pydantic model，方便直接作为 LLM structured output schema；三段结构只要求 runtime 内部结构化流转，不扩展 SSE/BFF/frontend contract。

```json
{
  "resumeJdMatch": [
    {
      "resumeSignal": "string",
      "jobSignal": "string",
      "matchType": "skill|responsibility|domain|project-evidence",
      "relevance": 0.0,
      "priority": "low|medium|high",
      "evidence": {
        "resumeSignals": ["string"],
        "jobSignals": ["string"],
        "projectSignals": ["string"]
      },
      "interviewFocus": ["string"],
      "suggestedQuestionTypes": [
        "system_design",
        "experience_probe",
        "case_analysis",
        "knowledge_check"
      ]
    }
  ],
  "resumeOnly": [
    {
      "resumeSignal": "string",
      "category": "skill|project|domain",
      "evidence": ["string"]
    }
  ],
  "jdOnly": [
    {
      "jobSignal": "string",
      "category": "responsibility|requirement|preferred|domain",
      "priority": "low|medium|high",
      "evidence": ["string"]
    }
  ],
  "isJobMatched": true,
  "mismatchReason": "string|null"
}
```

### 3.2 空匹配终止规则

规则：

```text
if jobDescription.trim() is not empty
and resumeJdMatch is empty:
  phase = "completed"
  activeRoundId = null
  finalReportReady = false
  rounds = skipped or zero-planned rounds
  assistantReply = "面试流程已结束：岗位不匹配。简历中没有发现与 JD 要求直接匹配的技能、职责或项目证据。"
  skip retrieve_initialization_questions()
  skip generate_initialization_question_set()
  skip judge_initialization_question_set()
  skip background report generation
```

说明：

- `resumeOnly` 和 `jdOnly` 可以保留，用于解释为什么不匹配。
- 终止原因来自 LLM 生成的结构化三段结果：第一段为空即视为岗位不匹配。
- 空匹配终止不是正常面试完成，不生成报告；实现时必须避免进入 `wrap-up`。
- 无 JD 时不执行岗位不匹配终止，继续按现有简历驱动流程。

### 3.3 数据流转

```text
ParsedResumeMarkdown
  professionalSkillsSection
  projectExperienceSection
  normalizedSkills
  normalizedProjectTopics
        |
        v
LLM structured output
  consumes bounded resume/JD context
  returns exactly three sections
        |
        v
ResumeJdMatchAnalysis
  resumeJdMatch[]  --------------------+
  resumeOnly[]                         |
  jdOnly[]                             |
  isJobMatched                         |
  mismatchReason                       |
        |                              |
        | empty match                  | non-empty match
        v                              v
Completed mismatch session       ProfessionalQuestionPlan[]
assistantReply reason                 |
skip RAG/generation                   v
                                build_professional_requeries()
                                      |
                                      v
                                retrieve_initialization_questions()
                                      |
                                      v
                                generated/judged questions
                                      |
                                      v
                                InterviewSessionState
```

## 4. 后续分步计划

每个小步骤目标控制在约 200 行代码改动以内，完成后必须能独立运行对应最小单元测试。

### Unit 01：新增 LLM 三段 match analysis

状态：已完成。

目标：在初始化链路前置调用 LLM 生成 `resumeJdMatch`、`resumeOnly`、`jdOnly`，输出必须符合固定 schema。默认 mock provider 作为本地 LLM 替身返回同结构结果，真实 provider 使用 structured output，失败时保留本地可运行 fallback。

预计改动：

- 新增 `src/app/domain/resume_jd_match.py`。
- 定义 `ResumeJdMatchAnalysis`、`ResumeJdMatchItem`、`ResumeOnlyItem`、`JdOnlyItem` Pydantic model。
- 构造有界 prompt，只传简历技能、项目摘要和 JD 摘要，要求模型只返回三段结构。
- 使用 `create_chat_model().with_structured_output(ResumeJdMatchAnalysis)`。
- mock provider 返回同结构 deterministic analysis，确保本地和测试稳定。
- 新增 `tests/unit/test_resume_jd_match.py`。

最小测试：

```bash
python -m pytest tests/unit/test_resume_jd_match.py tests/unit/test_interview_initialization_pipeline.py
python -m ruff check src/app/domain/resume_jd_match.py tests/unit/test_resume_jd_match.py
```

验收点：

- 有交集时第一部分非空。
- 简历额外技能进入第二部分。
- JD 未覆盖要求进入第三部分。
- JD 为空时 `isJobMatched=true`，不触发岗位不匹配终止。
- 真实模型和 mock/fallback 都必须返回相同字段结构。

### Unit 02：初始化链路接入空匹配终止

状态：已完成。

目标：当 LLM 返回的 `resumeJdMatch` 为空且 JD 非空时，直接结束面试流程并说明岗位不匹配；该结束不是正常面试完成，不生成报告。

预计改动：

- `interview_initialization_pipeline.py`：
  - 在 planning/retrieval 之前构建 match analysis。
  - 给 `InterviewInitializationResources` 增加 `resumeJdMatchAnalysis` 字段。
  - 增加 `_build_mismatch_session_state()` 或在 `_build_session_state()` 内用小分支处理。
  - 空匹配时不调用 RAG retrieval、question generation、question judgement。
  - 空匹配状态不得进入 `wrap-up`，确保 `should_start_background_report_generation()` 为 false。
- `tests/unit/test_interview_initialization_pipeline.py`：
  - 覆盖 JD 与简历完全不匹配时 `phase == "completed"`、`activeRoundId is None`、`assistantReply` 包含岗位不匹配。
  - 覆盖非空匹配仍进入现有第一题流程。

最小测试：

```bash
python -m pytest tests/unit/test_interview_initialization_pipeline.py
python -m ruff check src/app/domain/interview_initialization_pipeline.py
```

### Unit 03：按三段结构驱动专业问题召回

状态：已完成。

目标：后续问题召回依据 LLM 回传的三段结构执行：某段为空则不召回；第一段 `resumeJdMatch` 可召回多个问题；第二段 `resumeOnly` 和第三段 `jdOnly` 如果有内容，各自最多召回一个问题。

预计改动：

- `question_retriever.py`：
  - `retrieve_initialization_questions(..., match_analysis=None)` 增加可选参数。
  - `resumeJdMatch[]` 每条构造 matched query，可按剩余题数召回多个问题。
  - `resumeOnly[]` 非空时构造 resume-only query，最多召回 1 题。
  - `jdOnly[]` 非空时构造 jd-only query，最多召回 1 题。
  - 三段都为空时不召回专业题，由 Unit 02 终止逻辑处理。
- `question_query.py`：
  - 新增三段结构到 `RetrievalQueryIntent` 的构造 helper。
- `tests/unit/test_question_retriever.py` 覆盖三段为空跳过、第二/第三段最多一题。

最小测试：

```bash
python -m pytest tests/unit/test_question_retriever.py tests/unit/test_interview_initialization_pipeline.py
python -m ruff check src/app/domain/question_query.py src/app/domain/question_retriever.py
```

### Unit 04：planner 使用三段结构优化题目分配

状态：已完成。

目标：在 Unit 03 召回路径稳定后，再让 `ProfessionalQuestionPlan` 优先来自 `resumeJdMatch` 的 matched pairs，减少对隐式 `matched_signals()` 的依赖。

预计改动：

- `question_planner.py`：
  - `plan_professional_question_queries(..., match_analysis=None)` 增加可选参数。
  - `skill-focus` 优先来自 `resumeJdMatch.resumeSignal`。
  - `jobDescriptionSignals` 使用匹配 pair 的 `jobSignal`。
  - `resumeOnly` 不作为岗位匹配证据。
  - `jdOnly` 只用于 gap/scenario 题，不作为“已匹配”证据。
- `tests/unit/test_question_planner.py` 或现有 pipeline 测试覆盖 high/medium/low 分配。

最小测试：

```bash
python -m pytest tests/unit/test_question_planner.py tests/unit/test_interview_initialization_pipeline.py
python -m ruff check src/app/domain/question_planner.py
```

### Unit 05：可选持久化到 session state

状态：暂不执行。当前三段结果只要求 runtime 内部结构化流转，尚不扩展 checkpoint、SSE、BFF 或前端 contract。

目标：只有当后续报告、调试 artifact 或 UI 需要读取三段分析时，才把它加到 checkpoint state，避免第一轮扩大 contract。

建议 schema：

```json
{
  "resumeJdMatchAnalysis": {
    "resumeJdMatch": [],
    "resumeOnly": [],
    "jdOnly": [],
    "isJobMatched": true,
    "mismatchReason": null
  }
}
```

预计改动：

- `schemas/interview_state.py` 新增可选模型和默认值。
- `_build_session_state()` 写入 `resumeContext` 相邻字段或新顶层字段。
- `tests/unit/test_interview_state_schema.py` 覆盖旧 checkpoint 缺字段兼容。

最小测试：

```bash
python -m pytest tests/unit/test_interview_state_schema.py tests/unit/test_interview_initialization_pipeline.py
python -m ruff check src/app/schemas/interview_state.py
```

### Unit 06：metadata schema 扩展，保持旧数据兼容

状态：已完成。

目标：题目记录支持更稳定 metadata，服务后续 rerank，但不阻塞三段输出和空匹配终止。

目标 schema：

```json
{
  "id": "string",
  "question": "string",
  "answer": "string",
  "answer_points": ["string"],
  "tags": ["string"],
  "skills": ["string"],
  "level": "junior|middle|senior|unknown",
  "question_type": "system_design|experience_probe|case_analysis|knowledge_check",
  "job_family": "string",
  "job_duties": ["string"],
  "language": "zh|en",
  "embedding_text": "string",
  "source": "string"
}
```

兼容映射：

```text
difficulty -> level
questionType -> question_type
skillArea -> skills
answer newline bullets -> answer_points
tags string/list -> tags[]
```

预计改动：

- `question_metadata.py`：清洗、归一化、默认值。
- `milvus_store.py`：读取并映射新字段到 candidate。
- `schemas/interview_state.py`：只新增可选字段，避免破坏 API。

最小测试：

```bash
python -m pytest tests/unit/test_question_metadata.py tests/unit/test_milvus_store.py
python -m ruff check src/app/domain/question_metadata.py src/app/integrations/milvus_store.py
```

### Unit 07：真正的 hybrid retrieval 接口

状态：已完成第一阶段。已新增 `KeywordQuestionStore` 协议和空实现，`query_questions_multi()` 支持可选 `keyword_store`，并把 vector hits 与 keyword hits 统一纳入 RRF merge；生产 keyword 索引仍按后续需求接入。

目标：把当前“vector 后 BM25 rerank”升级为“vector recall + keyword recall + RRF”。该步骤排在三段输出之后，避免扩大首批改动范围。

新增内部 schema：

```json
{
  "queryIntent": {
    "type": "skill_exact|job_scenario|capability_probe",
    "query": "string"
  },
  "vectorHits": [
    { "questionId": "string", "rank": 1, "score": 0.0 }
  ],
  "keywordHits": [
    { "questionId": "string", "rank": 1, "score": 0.0 }
  ],
  "rrfHits": [
    { "questionId": "string", "rrfScore": 0.0, "sources": ["vector", "keyword"] }
  ]
}
```

实现策略：

1. 若 Milvus/本地题库无法全库 keyword search，先提供 `KeywordQuestionStore` 接口和 fake/test implementation。
2. 生产环境第一阶段可继续在 vector union 上 BM25，接口先稳定。
3. 后续接入 Milvus scalar/text index 或旁路 SQLite/JSONL keyword index。

最小测试：

```bash
python -m pytest tests/unit/test_question_retriever.py
python -m ruff check src/app/domain/question_retriever.py
```

### Unit 08：metadata rerank 完整化

状态：已完成。

目标：rerank 完全基于召回结果 metadata，不调用 LLM，并输出可解释 trace。

输入 schema：

```json
{
  "candidates": ["InterviewQuestionCandidate"],
  "matchAnalysis": "ResumeJdMatchAnalysis",
  "sessionState": {
    "askedQuestionIds": ["string"],
    "coveredSkills": ["string"],
    "coveredQuestionTypes": ["string"],
    "recentQuestionTexts": ["string"]
  }
}
```

输出 schema：

```json
{
  "questionId": "string",
  "rerankScore": 0.0,
  "scoreBreakdown": {
    "retrieval": 0.0,
    "skill": 0.0,
    "job": 0.0,
    "questionType": 0.0,
    "difficulty": 0.0,
    "novelty": 0.0
  },
  "matchedMetadata": {
    "skills": ["string"],
    "jobDuties": ["string"],
    "questionType": "string",
    "level": "string"
  },
  "isDuplicate": false
}
```

最小测试：

```bash
python -m pytest tests/unit/test_question_retriever.py tests/unit/test_outcome_and_rag_artifacts.py
python -m ruff check src/app/domain/question_retriever.py src/app/domain/rag_recall_sample.py
```

### Unit 09：session 去重与覆盖控制

状态：已完成第一阶段。初始化阶段维护内部 `QuestionSelectionContext`，按 question id 和文本 token overlap 去重；重复候选不会再次入选，RAG trace 通过 `isDuplicate=true` 和 `scoreBreakdown.novelty=0.0` 解释过滤原因。暂不持久化 embedding。

目标：实现 question id、文本近似、技能覆盖三层去重。

新增内部 selection context：

```json
{
  "askedQuestionIds": ["string"],
  "coveredSkills": ["string"],
  "coveredQuestionTypes": ["string"],
  "selectedQuestionIdsInInitialization": ["string"]
}
```

预计改动：

- `interview_initialization_pipeline.py`：初始化阶段维护 selection context。
- `question_retriever.py`：接收 exclude/covered context。
- 第一阶段不持久化 embedding，先用 text/token overlap 做最小语义去重。

最小测试：

```bash
python -m pytest tests/unit/test_interview_initialization_pipeline.py tests/unit/test_question_retriever.py
```

### Unit 10：端到端回归与观测

状态：已完成。

目标：确认“简历 + JD -> 三段 match analysis -> 召回 -> 主问题 / 空匹配终止”链路在默认 runtime 端到端可用。

验证数据：

```json
{
  "resumeSkills": [
    "Mastra Agent / ReAct / Tool Calling / RAG / Memory / Multi-Agent",
    "TypeScript / Vue / React / Node / NestJS / .NET",
    "Codex / GitHub Copilot / Repo Memory",
    "Docker / Kubernetes / CI/CD / Redis / Elasticsearch"
  ],
  "jobInfo": {
    "family": "llm_agent_engineer",
    "duties": [
      "LLM Agent 核心架构",
      "工具调用",
      "记忆管理",
      "自主执行",
      "Multi-Agent 协作",
      "评估与维护"
    ]
  }
}
```

最小测试：

```bash
python -m pytest tests/integration/test_interview_short_flow.py tests/contract/test_mastra_sse_compat.py
npm run test:e2e:interview:smoke:python
```

说明：`test_mastra_sse_compat.py` 是 legacy stream contract 名称，不代表新增 Mastra runtime 工作。

执行记录：

- `python -m pytest tests/integration/test_interview_short_flow.py tests/contract/test_mastra_sse_compat.py`：2 passed。
- `npm run test:e2e:interview:smoke:python`：首次执行因本地 frontend `http://localhost:4173` 未启动而失败；启动 Python runtime、BFF、frontend 后重跑通过，2 passed。

## 5. 风险与约束

1. 第一阶段必须由 LLM 生成三段结构，风险是初始化路径增加模型调用延迟和失败面；实现必须保留 mock/fallback 保证本地可运行。
2. LLM 输出必须被 Pydantic schema 校验，失败时不能把非结构化文本继续传入召回链路。
3. 空匹配终止只在 JD 非空时触发；无 JD 时继续简历驱动面试。
4. 当前 Milvus collection 是否已有完整 metadata 不确定，metadata 扩展必须保持旧数据兼容。
5. 真正 BM25 全库检索需要索引来源，先稳定接口再接生产实现。
6. 修改 stream snapshot 或 checkpoint state 时必须同步检查 `tests/contract/**`、host BFF 代理和前端 SSE 消费逻辑。
7. 每个 LangGraph runtime 实施步骤开始前都要重新读取 `.github/instructions/langgraph-architecture.instructions.md`；完成 runtime 代码改动后运行 `project-architecture-sync` skill 并记录 guard。

## 6. 建议执行顺序

1. 先做 Unit 01 和 Unit 02，完成“LLM 三段结构化输出”和“空匹配非报告终止”，这是本次需求的最小闭环。
2. 再做 Unit 03，让问题召回严格按三段结构执行。
3. 再做 Unit 04，把 planner 从隐式匹配优化到显式三段输入。
4. 如报告或 UI 需要展示三段分析，再做 Unit 05。
5. Unit 06 到 Unit 09 属于召回质量增强，按风险独立推进。
6. 最后做 Unit 10 端到端回归。

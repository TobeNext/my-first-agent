# 简历-JD 匹配式题库召回改造计划

> 日期：2026-06-19
> 依据：`PLAN/resume-JD-match.md`
> 默认运行时：`../my-first-agent-langgraph`
> 回滚运行时：当前仓库 `src/mastra/**`

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

`ParsedResumeMarkdown` 的有效字段：

```json
{
  "professionalSkillsSection": "string",
  "projectExperienceSection": "string",
  "normalizedSkills": ["string"],
  "normalizedProjectTopics": ["string"],
  "warnings": ["string"]
}
```

`ProfessionalQuestionPlan` 当前 schema：

```json
{
  "kind": "skill-focus|cross-skill-scenario|broad-professional-scenario|jd-gap-scenario",
  "primarySkill": "string|null",
  "relatedSkills": ["string"],
  "lens": "implementation-depth|trade-off-analysis|failure-recovery|scalability|cross-skill-integration|delivery-prioritization",
  "targetAbility": "string",
  "questionType": "knowledge-check|scenario",
  "coverageIntent": "same as lens",
  "resumeSignals": ["string"],
  "jobDescriptionSignals": ["string"],
  "questionDriver": "resume|job-description|resume-and-job-description",
  "expectedDifficulty": "medium|hard",
  "selectionReason": "string"
}
```

### 1.3 当前召回逻辑

默认 Python runtime 原逻辑：

```text
ProfessionalQuestionPlan
  -> build_professional_skill_query()
  -> embed_query_text(single query)
  -> MilvusQuestionStore.search(topK=20, round_type)
  -> bm25_rerank_questions(vector candidates only)
  -> random.sample(top candidates, topK=1)
```

`InterviewQuestionCandidate` 当前 schema：

```json
{
  "id": "string",
  "text": "string",
  "score": 0.0,
  "role": "professional-skills|project-experience|null",
  "company": "string|null",
  "questionType": "string|null",
  "difficulty": "string|null",
  "skillArea": ["string"],
  "answer": "string|null",
  "tags": "string|null"
}
```

Milvus 读取字段：

```json
{
  "id": "string",
  "metadata": {
    "question": "string",
    "text": "string",
    "answer": "string",
    "questionType": "string",
    "difficulty": "string",
    "skillArea": ["string"],
    "tags": ["string"]
  },
  "role": "string",
  "difficulty": "string",
  "skillArea": ["string"]
}
```

主要问题：

1. 每个 plan 只有单 query，容易把简历技能原文直接带进向量检索。
2. BM25 只在向量召回候选内做重排，不是真正的全库 keyword recall。
3. rerank 主要依赖 BM25/向量分，metadata 的岗位匹配、题型、难度、覆盖度权重不足。
4. 最终选择使用随机抽样，缺少 session 历史避让和技能覆盖控制。
5. 题库 metadata schema 不够完整，缺少 `answer_points`、`skills`、`job_family`、`job_duties` 等稳定字段。

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

## 3. 后续分步计划

每个小步骤目标控制在约 200 行代码改动以内，完成后必须能独立运行对应最小单元测试。

### Unit 01：技能-JD 匹配画像显式化

目标：把当前隐含在 `ProfessionalQuestionPlan` 里的匹配信息升级为显式 `SkillJobMatchProfile`。

新增 schema：

```json
{
  "resumeSkill": "string",
  "relevance": 0.0,
  "priority": "low|medium|high",
  "jobRelevantSkills": ["string"],
  "interviewFocus": ["string"],
  "suggestedQuestionTypes": ["system_design|experience_probe|case_analysis|knowledge_check"],
  "difficulty": "junior|middle|senior",
  "evidence": {
    "resumeSignals": ["string"],
    "jobSignals": ["string"],
    "projectSignals": ["string"]
  }
}
```

数据传输：

```text
normalizedSkills + JobDescriptionSignalSet + normalizedProjectTopics
  -> SkillJobMatchProfile[]
  -> ProfessionalQuestionPlan.skillProfile
```

预计改动：

- `question_planner.py`：新增 dataclass 和确定性 relevance 规则。
- `test_interview_initialization_pipeline.py` 或新增 `test_question_planner.py`：覆盖 high/medium/low。

最小测试：

```bash
python -m pytest tests/unit/test_interview_initialization_pipeline.py tests/unit/test_question_query.py
```

### Unit 02：题库 metadata schema 扩展

目标：题目记录支持文档要求的稳定 metadata，兼容旧数据。

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
- `schemas/interview_state.py`：谨慎新增可选字段，避免破坏 API。

最小测试：

```bash
python -m pytest tests/unit/test_question_metadata.py tests/unit/test_milvus_store.py
```

### Unit 03：真正的 hybrid retrieval 接口

目标：把当前“vector 后 BM25 rerank”升级为“vector recall + keyword recall + RRF”。

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

预计改动：

- `question_retriever.py`：拆出 `vector_recall_many`、`keyword_recall_many`、`rrf_merge`。
- `integrations/keyword_question_store.py`：轻量接口。
- 测试 fake store 覆盖 keyword-only 命中。

最小测试：

```bash
python -m pytest tests/unit/test_question_retriever.py
```

### Unit 04：metadata rerank 完整化

目标：rerank 完全基于召回结果 metadata，不调用 LLM，并输出可解释 trace。

输入 schema：

```json
{
  "candidates": ["InterviewQuestionCandidate"],
  "skillProfile": "SkillJobMatchProfile",
  "jobProfile": {
    "jobFamily": "string",
    "coreDuties": ["string"],
    "requirements": ["string"],
    "preferredSkills": ["string"],
    "priorityKeywords": ["string"]
  },
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

预计改动：

- 新增 `question_reranker.py`，从 retriever 中拆出确定性打分。
- `rag_recall_sample.py` 补充 score breakdown 字段。

最小测试：

```bash
python -m pytest tests/unit/test_question_retriever.py tests/unit/test_outcome_and_rag_artifacts.py
```

### Unit 05：session 去重与覆盖控制

目标：实现 question id、语义近似、技能覆盖三层去重。

新增 schema：

```json
{
  "askedQuestionIds": ["string"],
  "coveredSkills": ["string"],
  "coveredQuestionTypes": ["string"],
  "recentQuestionEmbeddings": [[0.0]],
  "selectedQuestionIdsInInitialization": ["string"]
}
```

数据传输：

```text
InterviewInitializationResources.recallTraces
  -> selected questions
  -> InterviewSessionState 或资源层 selection state
  -> next candidate rerank novelty_score
```

预计改动：

- `interview_initialization_pipeline.py`：初始化阶段维护 selection state。
- `question_retriever.py`：接收 exclude/covered context。
- 不在第一步持久化 embedding，先用 text/token overlap 做最小语义去重。

最小测试：

```bash
python -m pytest tests/unit/test_interview_initialization_pipeline.py tests/unit/test_question_retriever.py
```

### Unit 06：每条技能 1-3 主问题策略

目标：根据 `SkillJobMatchProfile.priority/relevance` 决定每条技能问题数。

选择规则：

```text
high: 2-3
medium: 1-2
low: 0-1
```

输出 schema：

```json
{
  "resumeSkill": "string",
  "profile": "SkillJobMatchProfile",
  "selectedQuestions": ["InterviewQuestionCandidate"],
  "selectionReason": "string"
}
```

预计改动：

- `question_planner.py`：从全局 count 分配改为 profile-aware allocation。
- `interview_initialization_pipeline.py`：仍保持最终总题数不超过 settings。

最小测试：

```bash
python -m pytest tests/unit/test_interview_initialization_pipeline.py tests/contract/test_unit00_golden_transcripts.py
```

### Unit 07：回滚 Mastra runtime 对齐

目标：默认 runtime 稳定后，把同等 schema/trace 同步到当前仓库 Mastra fallback，保持回滚可用。

涉及文件：

```text
src/mastra/lib/professional-question-query.ts
src/mastra/lib/interview-question-retriever.ts
src/mastra/tools/interview-question-tool.ts
src/mastra/lib/interview-question-metadata.ts
```

最小测试：

```bash
npm run test:unit -- src/mastra/lib/professional-question-query.test.ts src/mastra/lib/interview-question-retriever.test.ts src/mastra/lib/interview-question-metadata.test.ts
```

### Unit 08：端到端回归与观测

目标：确认“简历 + JD -> 召回 -> 主问题”链路在默认 runtime 端到端可用。

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
python -m pytest tests/integration/test_interview_short_flow.py
npm run test:e2e:interview:smoke:python
```

## 4. 风险与约束

1. 当前 Milvus collection 是否已有完整 metadata 不确定，Unit 02 必须保持旧数据兼容。
2. 真正 BM25 全库检索需要索引来源，Unit 03 先固化接口再接生产实现。
3. 不使用 LLM rerank，所有精排必须可复现、可解释。
4. 默认 runtime 改在 `../my-first-agent-langgraph`；当前仓库 Mastra 只做回滚兼容，不优先承载新功能。


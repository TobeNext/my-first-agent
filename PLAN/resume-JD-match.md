你的场景不是普通“问答 RAG”，而是 **面试题目匹配 RAG**。目标不是回答用户问题，而是从题库里召回“适合问这个候选人的主问题”。

我建议把逻辑设计成：

```text
简历技能条目 + 岗位职责/要求
  -> 技能拆解与岗位匹配
  -> 生成检索意图 query
  -> 多路召回 requery
  -> rerank 精排
  -> 去重与历史避让
  -> 题目难度/覆盖度控制
  -> 输出 1-3 个主问题
```

---

**一、题库先要结构化**

如果向量库里只有题目文本，效果会不稳定。建议每道题都带 metadata。

例如一条题目：

```json
{
  "id": "agent_rag_001",
  "question": "请你设计一个基于 RAG 的 Agent 问答系统，如何处理工具调用、记忆管理和检索结果不准确的问题？",
  "answer_points": [
    "RAG 检索链路",
    "Tool Calling",
    "Memory",
    "ReAct",
    "评估与优化"
  ],
  "tags": ["AI Agent", "RAG", "Tool Calling", "Memory", "System Design"],
  "level": "senior",
  "question_type": "system_design",
  "job_family": "llm_agent_engineer",
  "skills": ["RAG", "Agent", "Prompt Engineering"],
  "language": "zh"
}
```

至少建议有这些字段：

```text
question
tags
skills
level
question_type
job_family
answer_points
embedding_text
```

其中 `embedding_text` 不要只放题目本身，建议拼成：

```text
题目：...
考察点：...
相关技能：...
适合岗位：...
难度：...
```

这样比只 embed `question` 召回效果好很多。

---

**二、先做“技能-岗位匹配”，不要直接拿简历技能去搜**

你现在的输入类似：

```text
熟悉 Mastra Agent 框架，掌握 Prompt Engineering、ReAct、Tool Calling、RAG、Memory、Skills...
```

岗位要求是：

```text
设计和实现基于 LLM 的智能体核心架构
工具调用、记忆管理、自主执行
LLM 部署、评测和维护
工具层开发，扩展 Agent 能力边界
Multi-Agent 协作系统
```

不要直接把整条技能塞给向量库。应该先让 LLM 抽取出这条技能和岗位的交集。

例如输出：

```json
{
  "resume_skill": "Mastra Agent、Prompt Engineering、ReAct、Tool Calling、RAG、Memory、Skills、Multi-Agent、MCP",
  "job_relevant_skills": [
    "LLM Agent 架构设计",
    "ReAct 推理与工具调用",
    "RAG 检索增强",
    "Memory 设计",
    "Multi-Agent 协作",
    "Agent 评估与持续优化"
  ],
  "interview_focus": [
    "能否设计可扩展 Agent 系统",
    "能否解释工具调用和记忆机制",
    "能否处理 RAG 不准确和幻觉问题",
    "是否有工程化落地经验"
  ],
  "priority": "high"
}
```

这样后面的 query 会更干净。

---

**三、对每条技能生成 3 类 query**

每条专业技能建议生成 3 类 query，而不是一个 query。

### 1. 精确技能 query

用于召回具体知识点题。

```text
AI Agent ReAct Tool Calling RAG Memory Mastra 面试题
```

### 2. 岗位场景 query

用于召回更贴近职位职责的系统设计题。

```text
设计基于 LLM 的智能体核心架构，包括任务规划、工具调用、记忆管理和自主执行
```

### 3. 能力验证 query

用于召回追问型、经验型问题。

```text
候选人是否具备 AI Agent 系统设计、开发、评估和持续优化能力
```

对应你第一条技能，生成的 requery 可以是：

```json
[
  {
    "type": "skill_exact",
    "query": "Mastra Agent ReAct Tool Calling RAG Memory Prompt Engineering Multi-Agent MCP 面试题"
  },
  {
    "type": "job_scenario",
    "query": "设计和实现基于 LLM 的智能体核心架构 任务规划 工具调用 记忆管理 自主执行"
  },
  {
    "type": "capability_probe",
    "query": "AI Agent 系统工程化落地 评估 持续优化 多智能体协作 面试主问题"
  }
]
```

这样比单 query 稳很多。

---

**四、推荐召回策略：Hybrid + Multi Query + RRF**

如果你有条件，建议同时用：

```text
向量检索 + BM25/关键词检索
```

原因是你的场景里有很多精确技术词：

```text
Mastra
ReAct
Tool Calling
RAG
Memory
MCP
Codex
Kubernetes
Elasticsearch
NestJS
.NET
```

这些词对 BM25 很重要。纯向量可能把 `Mastra` 泛化成普通 Agent 框架，导致召回不够准。

推荐流程：

```text
每条技能生成 3 个 query
每个 query 做 vector topK = 20
每个 query 做 keyword topK = 20
合并结果
用 RRF 做初步融合
取 top 50 进入 rerank
```

RRF 公式可以简单用：

```text
score = sum(1 / (k + rank))
```

一般 `k = 60`。

---

**五、rerank 要按“面试匹配度”重排，不只是语义相似度**

普通 reranker 只判断 query 和题目像不像，但你的目标是“这题适不适合拿来问这个候选人”。这里不允许使用 LLM 做 rerank，精排必须基于召回结果中已经写入的 metadata 做确定性打分。

建议总分：

```text
final_score =
  0.25 * retrieval_score
+ 0.25 * metadata_skill_match_score
+ 0.20 * metadata_job_match_score
+ 0.10 * question_type_score
+ 0.10 * difficulty_match_score
+ 0.10 * novelty_score
```

每个分数含义：

```text
retrieval_score：RRF 融合后的召回分或向量/BM25 归一化分
metadata_skill_match_score：题目 metadata.skills/tags/answer_points 与当前技能画像的重合度
metadata_job_match_score：题目 metadata.job_family/job_duties/job_requirements 与岗位信息的匹配度
question_type_score：题目类型是否适合作为主问题，例如 system_design、experience_probe、case_analysis 权重更高
difficulty_match_score：题目 metadata.level 是否适合当前候选人和岗位级别
novelty_score：是否和已问过/已选题目不重复，重复或技能覆盖过多则降分
```

metadata rerank 要求题库召回结果至少包含这些字段：

```json
{
  "id": "agent_rag_001",
  "skills": ["RAG", "Agent", "Tool Calling", "Memory"],
  "tags": ["AI Agent", "System Design", "ReAct"],
  "answer_points": ["RAG 检索链路", "工具调用", "记忆管理", "评估优化"],
  "job_family": "llm_agent_engineer",
  "job_duties": ["agent_architecture", "tool_calling", "memory_management"],
  "question_type": "system_design",
  "level": "senior",
  "language": "zh"
}
```

示例打分逻辑：

```ts
function rerankByMetadata({ candidates, skillProfile, jobProfile, sessionState }) {
  return candidates
    .map((item) => {
      const metadata = item.metadata;

      const retrievalScore = normalize(item.rrfScore ?? item.score ?? 0);
      const skillScore = overlapScore(
        [...metadata.skills, ...metadata.tags, ...metadata.answer_points],
        skillProfile.job_relevant_skills
      );
      const jobScore = overlapScore(
        [metadata.job_family, ...metadata.job_duties],
        [jobProfile.job_family, ...jobProfile.core_duties]
      );
      const questionTypeScore = weightByQuestionType(metadata.question_type);
      const difficultyScore = matchDifficulty(metadata.level, skillProfile.difficulty);
      const noveltyScore = calcNoveltyScore(metadata, sessionState);

      return {
        ...item,
        rerankScore:
          0.25 * retrievalScore +
          0.25 * skillScore +
          0.20 * jobScore +
          0.10 * questionTypeScore +
          0.10 * difficultyScore +
          0.10 * noveltyScore
      };
    })
    .sort((a, b) => b.rerankScore - a.rerankScore);
}
```

---

**六、题目“每次尽量不重复”的设计**

不要只靠随机。建议做三层去重。

### 1. question_id 去重

最基础：

```text
已经问过的 question_id 不再出现
```

### 2. 语义去重

同一类题目即使 id 不同，也不要重复问。

例如这两题其实很像：

```text
请设计一个 RAG Agent 系统。
如何设计一个带工具调用和记忆能力的智能体？
```

可以用 embedding 相似度判断：

```text
如果 candidate_question_embedding 和 selected_question_embedding 相似度 > 0.86，则认为重复
```

### 3. 技能覆盖去重

同一轮面试不要全都问 RAG。

例如第一条技能可以选：

```text
Agent 架构设计
Tool Calling / ReAct
RAG 与 Memory 取舍
```

而不是：

```text
RAG 是什么？
RAG 怎么优化？
RAG 如何评估？
```

维护一个 session 状态：

```json
{
  "asked_question_ids": ["agent_rag_001"],
  "covered_skills": ["RAG", "Tool Calling"],
  "covered_question_types": ["system_design"],
  "recent_question_embeddings": ["..."]
}
```

然后在 rerank 时给已覆盖技能降权。

---

**七、每条技能生成 1-3 个主问题的选择策略**

不是每条都固定 3 个。可以按岗位相关度决定。

```text
高相关技能：2-3 个主问题
中相关技能：1-2 个主问题
低相关技能：0-1 个主问题
```

以你给的简历为例：

### 技能 1：Agent / RAG / Tool Calling / Memory / Multi-Agent

和岗位高度匹配，建议 3 个主问题。

可召回方向：

```text
Agent 架构设计题
Tool Calling 与 ReAct 机制题
RAG + Memory + 评估优化题
```

示例主问题：

```text
如果让你设计一个面向业务场景的 LLM Agent 系统，需要支持任务规划、工具调用、记忆管理和自主执行，你会如何设计整体架构？
```

```text
在 Agent 执行复杂任务时，你会如何设计 ReAct、Tool Calling 和工具异常处理机制，避免模型错误调用工具或陷入循环？
```

```text
如果 Agent 使用 RAG 后仍然出现答非所问或幻觉，你会从召回、重排、上下文构造、评估指标哪些方面优化？
```

### 技能 2：TypeScript / C# / Vue / React / Node / NestJS / .NET

和岗位中等相关。岗位更偏 LLM Agent，但也要求工程开发能力。建议 1-2 个。

示例方向：

```text
LLM 应用后端架构
BFF / API / 工程化
复杂业务系统重构
```

示例主问题：

```text
如果要把一个 LLM Agent 能力集成到现有企业系统中，你会如何设计前后端分离架构、BFF 层和后端 API？
```

### 技能 3：Codex / OpenCode / GitHub Copilot / Repo Memory / 提示词分层

和岗位的 Prompt Engineering、LLM 开发经验相关。建议 1-2 个。

示例主问题：

```text
你在使用 AI Coding 工具提升研发效率时，如何设计 Repo Memory、提示词分层和代码生成质量评估机制？
```

```text
如果 AI Coding 工具生成的代码质量不稳定，你会从上下文管理、提示词、测试、日志反馈哪些方面优化？
```

### 技能 4：Git / Docker / Kubernetes / CI/CD / Redis / Elasticsearch / MSSQL

和岗位的 LLM 部署、运维、稳定性相关。建议 1-2 个。

示例主问题：

```text
如果要部署一个高可用的 LLM Agent 服务，你会如何设计容器化、CI/CD、日志监控、缓存和故障恢复方案？
```

```text
在 LLM 应用中，如果需要使用 Elasticsearch 或向量数据库支持检索，你会如何设计索引、召回、性能优化和数据更新流程？
```

---

**八、推荐的完整链路**

可以这样实现：

```text
for each resume_skill:
    1. extract_skill_profile(resume_skill, job_info)
    2. if relevance < threshold:
           skip or only generate 1 light question
    3. generate_requeries(skill_profile)
    4. retrieve_by_vector(requeries)
    5. retrieve_by_keyword(requeries)
    6. merge_by_rrf()
    7. filter_by_metadata()
    8. rerank_by_metadata()
    9. deduplicate()
    10. select_diverse_questions(1-3)
```

伪代码：

```ts
async function generateInterviewQuestions(resumeSkills, jobInfo, sessionState) {
  const results = [];

  for (const skill of resumeSkills) {
    const profile = await analyzeSkillAgainstJob(skill, jobInfo);

    if (profile.relevance < 0.35) continue;

    const queries = await generateRequeries(profile, jobInfo);

    const vectorResults = await vectorSearchMany(queries, { topK: 20 });
    const keywordResults = await keywordSearchMany(queries, { topK: 20 });

    const fused = rrfMerge([...vectorResults, ...keywordResults]);

    const filtered = filterCandidates(fused, {
      jobFamily: "llm_agent_engineer",
      excludeQuestionIds: sessionState.askedQuestionIds,
      language: "zh"
    });

    const reranked = rerankByMetadata({
      candidates: filtered.slice(0, 50),
      skillProfile: profile,
      jobInfo,
      sessionState
    });

    const selected = selectDiverseQuestions(reranked, {
      maxCount: profile.relevance > 0.75 ? 3 : 1,
      avoidSkills: sessionState.coveredSkills,
      semanticDuplicateThreshold: 0.86
    });

    results.push({
      resumeSkill: skill,
      questions: selected
    });

    updateSessionState(sessionState, selected);
  }

  return results;
}
```

---

**九、关键 Prompt 示例**

### 1. 技能与岗位匹配分析

```text
你是技术面试系统的题目规划器。

请根据候选人的一条专业技能和岗位信息，判断这条技能适合考察哪些面试方向。

要求：
- 只提取和岗位相关的技能点
- 不要发散到岗位无关内容
- 输出 JSON

候选人技能：
{{resume_skill}}

岗位信息：
{{job_info}}

输出格式：
{
  "relevance": 0-1,
  "job_relevant_skills": [],
  "interview_focus": [],
  "suggested_question_types": [],
  "difficulty": "junior|middle|senior",
  "reason": ""
}
```

### 2. Requery 生成

```text
你是 RAG 检索 query 生成器。

请根据技能分析结果和岗位信息，生成用于召回面试主问题的检索 query。

要求：
- 生成 3 个 query
- 分别覆盖：精确技能、岗位场景、能力验证
- query 应适合检索题库，不要像用户提问
- 保留关键技术词
- 输出 JSON

技能分析：
{{skill_profile}}

岗位信息：
{{job_info}}

输出格式：
[
  { "type": "skill_exact", "query": "" },
  { "type": "job_scenario", "query": "" },
  { "type": "capability_probe", "query": "" }
]
```

### 3. Metadata Rerank 规则

```text
Rerank 不调用 LLM。

输入：
- RRF 融合后的候选题目
- 候选题目的 metadata
- 当前技能画像 skill_profile
- 岗位画像 job_profile
- sessionState 中的已问题目和已覆盖技能

排序规则：
1. 优先选择 metadata.skills/tags/answer_points 与当前技能画像重合度高的题目
2. 优先选择 metadata.job_family/job_duties 与岗位职责匹配的题目
3. 优先选择适合作为主问题的 question_type
4. 优先选择难度 level 和候选人/岗位级别匹配的题目
5. 对已问过、语义相似、技能覆盖重复的题目降分或过滤
```

输出结构：

```json
[
  {
    "question_id": "agent_rag_001",
    "rerank_score": 0.86,
    "matched_metadata": {
      "skills": ["Agent", "RAG", "Tool Calling", "Memory"],
      "job_duties": ["agent_architecture", "tool_calling", "memory_management"],
      "question_type": "system_design",
      "level": "senior"
    },
    "is_duplicate": false
  }
]
```

---

**十、你这个场景的最佳推荐组合**

我建议你用这个组合：

```text
技能-岗位匹配分析
+ 3 路 requery
+ hybrid retrieval
+ RRF 融合
+ metadata rerank
+ session 去重
+ 技能覆盖度控制
```

其中最重要的是两点：

```text
1. query 不要直接用简历原文，要先抽取“岗位相关考察点”
2. rerank 不调用 LLM，而是读取召回数据的 metadata 做稳定、可解释的加权排序
```

这样召回出来的题目会更像真正面试官会问的问题，而不是简单地“命中了某个关键词”。

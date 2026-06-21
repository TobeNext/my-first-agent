# 追问记忆系统改造计划

> 日期：2026-06-19
> 架构复核更新：2026-06-21
> 默认运行时：`../my-first-agent-langgraph`
> 当前仓库职责：前端/BFF host 与 Mastra 回滚 provider
> 本计划只制定实施方案，不做业务代码改动。
> 当前报告链路：Python runtime 已不使用 Redis answer/report worker。Stream 到达 `wrap-up` 时先返回“报告生成中”snapshot，再由 FastAPI `BackgroundTasks` 调用 LangGraph report runner 执行 `evaluate_answers -> generate_report -> persist_report`，报告状态/markdown/read receipt 以 report DB 为真源。

## 1. 目标

在生成追问问题时加入一个显式、可持久化、可测试的记忆系统，使追问生成不只依赖当前上下文、`context` 或 `state` 的临时信息，而是能稳定读取：

1. 当前面试中已经问过的所有追问内容。
2. 当前主问题。
3. 用户简历信息。
4. 职位 JD 信息。
5. 用户历史面试报告。
6. 用户上次面试中回答不好的知识点、追问点、漏答点和改进建议。

最终约束：

- 新生成的追问不能与已问追问重复。
- 新生成的追问应尽量围绕候选人回答中还没有展开的点。
- 追问 prompt 中必须按固定顺序注入记忆摘要，但避免把完整长文本无限塞进 prompt。
- LLM 执行时，记忆内容必须放在 system/agent prompt 之后，顺序固定为：用户历史面试报告 -> 用户简历信息 -> 职位 JD 信息 -> 用户上次面试中回答不好的知识点、追问点、漏答点和改进建议 -> 当前面试中已经问过的所有追问内容 -> 当前主问题。
- 不注入“已问追问 + 候选人回答组成的当前题目对话记录”，避免把候选人当前回答原文作为长期记忆上下文污染追问生成。
- 面试完成后，记忆内容必须入库，并能按用户在下次面试开始时召回。
- 如果用户有历史报告，下次面试的问题规划和追问生成需要强化覆盖上一轮回答不好的地方。
- 添加或更新持久化记忆时，必须走工具调用形式，不允许业务流程直接散落调用 repository 写表。
- 每条历史摘要必须带时间戳；当前轮次摘要与更早摘要冲突时，以最新摘要为准，同时保留历史记录用于审计。
- 每个实现单元控制在约 200 行代码改动以内。
- 每个实现单元都必须有 Codex 可以自行运行的最小验证。

## 2. 当前代码判断

默认 runtime 已经有独立追问生成链路：

```text
../my-first-agent-langgraph/src/app/domain/follow_up_generation.py
  ensure_generated_follow_up_question()
  generate_follow_up_question()
  build_dedicated_follow_up_question_prompt()
```

追问最终写入会话状态的位置在：

```text
../my-first-agent-langgraph/src/app/domain/interview_state_machine.py
  apply_user_reply()
  apply_follow_up()
  mark_follow_up_answered()
```

当前 `InterviewSessionState` 已包含：

```text
resumeContext.professionalSkills
resumeContext.projectExperience
resumeContext.jobDescription
rounds[].nodes[].mainQuestion
rounds[].nodes[].followUps[]
rounds[].nodes[].answerAttempts[]
```

这说明本次面试内的追问去重可以先从现有 state 提取，不需要先引入外部向量记忆。

但用户明确要求记忆内容入库，并在下次面试召回历史报告。因此本计划调整为两层记忆都要做：

1. **Session memory**：本次面试内追问去重、简历/JD 注入、当前主问题整理。
2. **Persistent user interview memory**：面试完成后从报告和逐题 review 中提取弱项，按用户维度入库；下次面试开始时通过 DB-backed lightweight retrieval 召回相关历史报告摘要，并加载用户聚合画像，用于主问题规划和追问强化。

当前 LangGraph 已有报告入库基础：

```text
../my-first-agent-langgraph/src/app/integrations/report_repository.py
  interview_reports
  interview_report_items
```

其中 `interview_report_items` 已保存：

```text
question
candidate_answer
score
missing_points_json
improvement_advice_json
```

因此持久化记忆不应另起一套完全重复的报告库，而应优先扩展现有 report repository，新增用户维度索引和面试记忆摘要表。

当前报告生成主流程还需要按现架构修正如下：

```text
/api/agents/interview-agent/stream
-> process_user_reply 进入 wrap-up / finalReportReady=false
-> stream 立即返回报告生成中 snapshot
-> FastAPI BackgroundTasks 调用 run_report_generation_for_thread(thread_id)
-> evaluate_answers_node
-> generate_report_node
-> persist_report_node
-> InterviewReportRepository 写 interview_reports / interview_report_items
```

所以本计划里的持久化记忆写入点应接在 `persist_report_node` 成功写 DB 后，或接在 `run_report_generation_for_thread()` 的成功路径中；不得重新引入 Redis queue、worker、manifest 或 `src/app/workers/report_generation_worker.py`。

## 3. 需求建议

我建议把“记忆系统”分成两个层次：

1. **Session memory**：本次面试内有效，负责追问去重、简历/JD 注入、当前主问题整理。
2. **Persistent user memory**：跨面试有效，保存历史报告摘要、弱项、漏答点和建议，用于下次面试强化提问。

对于持久化用户记忆，我建议先保存“报告摘要 + 可提问弱项”，不要直接保存完整逐轮上下文到 prompt。完整报告可以留在数据库里，prompt 只召回 digest：

```json
{
  "userId": "string",
  "sourceInterviewId": "string",
  "sourceThreadId": "string",
  "targetRole": "string",
  "overallScore": 0,
  "weaknesses": ["string"],
  "missingPoints": ["string"],
  "improvementAdvice": ["string"],
  "reinforcementQuestionHints": ["string"],
  "reportMarkdownExcerpt": "string",
  "sourceReportCompletedAt": "string",
  "summaryGeneratedAt": "string",
  "updatedAt": "string",
  "createdAt": "string"
}
```

原因是：历史报告可能很长，直接全量注入会增加成本和噪声；弱项摘要更适合问题规划和追问生成。

历史报告摘要生成时机决策：

**采用方案：当前面试 report 生成成功后立刻用 LLM 生成摘要并入库。**

- 下次 init 只做数据库召回，不增加启动延迟。
- 当前 background report runner / report graph nodes 已经拿到 `ReportGenerationOutput.questionReviews`、`missingPoints`、`improvementAdvice`，可将这些结构化结果交给摘要 LLM，数据上下文最完整。
- 摘要 LLM 复用 report 生成 agent 使用的 DeepSeek API key，但必须使用独立的 memory-summary system prompt，不复用 report prompt。
- 摘要生成失败不应影响本次 report DB succeeded 结果；第一版只记录可观测错误，后续可由 lazy backfill tool call 补齐，不重新引入外部 worker。
- 如果用户从不再来面试，会多做一次摘要写入；但摘要可由结构化 report 确定性提取，成本较低。

已拒绝方案：用户下次 init 时再生成摘要。原因是它会拉长 init 首屏等待，并且需要在启动链路处理摘要生成失败、重试、幂等写入。如果摘要生成依赖 LLM，会让面试启动变得不稳定。

结论：第一版固定采用“report 生成后立即用 LLM 摘要并通过工具写入”；下次 init 只召回已存在摘要。若发现历史 report 有缺失摘要，可在 init 中触发一次 lazy backfill tool call，但不得阻塞主流程。

历史摘要冲突规则：

1. 每条摘要都必须有 `sourceReportCompletedAt`、`summaryGeneratedAt`、`createdAt`、`updatedAt`。
2. 对同一 `userId + normalizedWeaknessKey + targetRole` 的冲突项，默认以 `summaryGeneratedAt` 最新者作为 canonical memory。
3. 如果 `summaryGeneratedAt` 相同，则以 `sourceReportCompletedAt` 最新者为准。
4. 未超过用户摘要上限时，旧摘要不删除，只标记为被新摘要覆盖或在召回合并时降权，方便以后审计和趋势分析。
5. 如果用户摘要数量达到上限，写入新摘要前必须删除该用户最久远的一条摘要。
6. 召回给 planner/prompt 的内容只使用 canonical memory，避免同一弱项出现前后矛盾的建议。

历史摘要容量规则：

1. 每个用户必须设置摘要数量上限，例如 `MAX_USER_INTERVIEW_MEMORY_COUNT=20`。
2. `update_interview_memory_tool()` 写入新摘要前必须检查该用户现有摘要数量。
3. 如果未达到上限，直接写入。
4. 如果达到或超过上限，先按 `summaryGeneratedAt asc, sourceReportCompletedAt asc, createdAt asc` 删除最久远的一条，再写入新摘要。
5. 删除只针对 `interview_user_memories` 摘要记录，不删除原始 `interview_reports` 和 `interview_report_items`，保证报告下载和审计不受影响。
6. 删除动作必须由工具完成并写日志，测试需要证明不会误删其他用户的摘要。

历史记忆压缩与轻量检索规则：

1. 下次 init 使用 DB-backed lightweight retrieval 从 `interview_user_memories` 中召回与当前岗位/JD/简历技能相关的历史摘要。
2. 检索只在同一 `userId` 范围内执行，禁止跨用户召回。
3. 召回结果数量有上限，例如 `USER_MEMORY_RETRIEVAL_TOP_K=3`。
4. 同时加载一个短的 `user_memory_profile` 聚合画像。
5. `user_memory_profile` 保存长期稳定弱项、已改善领域、反复出现的问题和更新时间。
6. 每次写入新摘要后，通过工具同步更新 `user_memory_profile`。
7. prompt 历史记忆区要有预算上限，例如 800-1200 tokens，超过预算时按固定优先级裁剪。

为什么改为 DB-backed lightweight retrieval：

1. 固定加载最新摘要虽然简单，但容易把不相关历史弱项带入当前岗位，例如上次 Java 后端弱项污染本次前端岗位追问。
2. DB-backed lightweight retrieval 可以在同用户范围内，根据当前简历、JD、目标岗位、当前主问题召回更相关的历史弱项，减少 prompt 噪声。
3. 仍保留每用户摘要数量上限和 topK，因此上下文不会随面试次数无限增长。
4. 第一版检索可以先用摘要 embedding + metadata 过滤实现，不需要 Milvus 或全库复杂检索。

prompt 预算裁剪优先级：

1. 必须保留：当前主问题。
2. 必须保留：当前面试中已经问过的所有追问内容。
3. 必须保留：职位 JD 摘要。
4. 必须保留：简历摘要。
5. 优先保留：`user_memory_profile` 聚合画像。
6. 最后保留：轻量检索召回的历史摘要；如果超长，先裁剪 `reportMarkdownExcerpt`，再裁剪低分相关性较低的摘要。

还建议把“不能重复”定义为三层：

1. 完全相同文本：归一化后必须拒绝。
2. 高相似文本：用 token/Jaccard 规则先做确定性拦截。
3. 同意图重复：先通过 prompt 约束和测试样例降低概率，后续如需要再引入 embedding 相似度。

这样做的原因是：session 去重可完全离线测试，不依赖 LLM 输出稳定性；persistent memory 则复用已有报告库，避免过早引入新的向量库或复杂基础设施。

## 4. 分步计划

### Unit 01：建立追问记忆快照构建器

状态：已完成（2026-06-21）

实际改动：

- 新增 `../my-first-agent-langgraph/src/app/domain/follow_up_memory.py`。
- 新增 `../my-first-agent-langgraph/tests/unit/test_follow_up_memory.py`。

验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_follow_up_memory.py
```

目标：新增一个纯函数，从 `InterviewSessionState` 中提取追问生成所需的记忆快照。

建议新增文件：

```text
../my-first-agent-langgraph/src/app/domain/follow_up_memory.py
```

建议 schema：

```json
{
  "resumeSummary": {
    "professionalSkills": "string",
    "projectExperience": "string",
    "jobDescription": "string"
  },
  "askedFollowUpQuestions": ["string"],
  "currentMainQuestion": "string",
  "historicalReportMemory": {
    "reportExcerpts": ["string"],
    "weaknesses": ["string"],
    "missingPoints": ["string"],
    "improvementAdvice": ["string"],
    "reinforcementQuestionHints": ["string"]
  }
}
```

实现范围：

- 新增 `FollowUpMemorySnapshot` dataclass 或 Pydantic model。
- 新增 `build_follow_up_memory_snapshot(state, active_node)`。
- 简历/JD 字段做长度裁剪，例如每段最多 1200 字符。
- 收集所有 round/node 中状态为 `asked` 或 `answered` 的追问文本。
- 当前 node 只收集主问题，不收集候选人回答原文。
- 不构建“已问追问 + 候选人回答”的当前题目对话记录。

预计代码改动：约 120-180 行。

自验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_follow_up_memory.py
```

验收点：

- fixture 中两个节点各有追问时，`askedFollowUpQuestions` 能收齐全部追问。
- `currentMainQuestion` 只包含当前主问题。
- memory snapshot 不包含候选人回答原文。
- 空 JD 时输出空字符串或 `not provided` 的统一表示。
- 长简历/JD 被裁剪，且测试能断言长度上限。

### Unit 02：把记忆快照注入追问 prompt

状态：已完成（2026-06-21）

实际改动：

- 更新 `../my-first-agent-langgraph/src/app/domain/follow_up_generation.py`，在 dedicated follow-up prompt 中注入 Unit 01 的 memory snapshot。
- 记忆区块按固定顺序输出：历史报告、简历、JD、历史弱项/改进目标、当前面试已问追问、当前主问题。
- 移除新 prompt 对“当前题目对话记录”的依赖，避免把候选人当前回答原文作为长期记忆上下文。
- 更新 `../my-first-agent-langgraph/tests/unit/test_follow_up_generation.py`，断言 prompt 顺序、简历/JD/已问追问注入和候选人回答原文不注入。

实现备注：

- 当前实现由 `build_dedicated_follow_up_question_prompt()` 内部调用 `build_follow_up_memory_snapshot()`，没有额外扩大上层调用签名；行为仍满足本单元验收目标。

验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_follow_up_generation.py tests/unit/test_follow_up_memory.py
```

目标：追问生成 prompt 在 system/agent prompt 后按固定顺序注入记忆，并要求模型不要重复。

涉及文件：

```text
../my-first-agent-langgraph/src/app/domain/follow_up_generation.py
../my-first-agent-langgraph/tests/unit/test_follow_up_generation.py
```

实现范围：

- 在 `generate_follow_up_question()` 中构建 `FollowUpMemorySnapshot`。
- 扩展 `build_dedicated_follow_up_question_prompt()` 参数，传入 memory snapshot。
- prompt 必须先保留原 system/agent prompt，再追加记忆区块。
- 记忆区块顺序固定，不允许实现时调整：
  1. `User historical interview reports`
  2. `User resume information`
  3. `Job description information`
  4. `Previous weak areas and improvement targets`
  5. `Asked follow-up questions in current interview`
  6. `Current main question`
- prompt 增加明确规则：
  - Do not repeat any question in `Asked follow-up questions in current interview`.
  - Use resume/JD only as grounding context.
  - Use historical weak areas only as reinforcement targets, not as negative labels.
  - Do not include or rely on a current dialogue transcript made from candidate answers.
- prompt 中加入结构化区块：
  - `User historical interview reports`
  - `User resume information`
  - `Job description information`
  - `Previous weak areas and improvement targets`
  - `Asked follow-up questions in current interview`
  - `Current main question`

预计代码改动：约 100-180 行。

自验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_follow_up_generation.py tests/unit/test_follow_up_memory.py
```

验收点：

- `test_ensure_generated_follow_up_question_logs_llm_input_and_output` 能断言 prompt 包含 `Asked follow-up questions in current interview`。
- prompt 中各记忆区块严格出现在 system/agent prompt 之后，且顺序符合要求。
- prompt 包含历史报告摘要、`resumeContext.professionalSkills` 和 `resumeContext.jobDescription` 的摘要。
- 当已有追问存在时，prompt 中能看到追问文本，但不能看到候选人回答原文组成的当前对话记录。

### Unit 03：生成后确定性去重与 fallback

状态：已完成（2026-06-21）

实际改动：

- 在 `../my-first-agent-langgraph/src/app/domain/follow_up_memory.py` 新增 `normalize_question_text()` 与 `is_duplicate_follow_up_question()`。
- 支持完全相同文本去重，并用轻量 token overlap/Jaccard 拦截简单近似重复。
- 更新 `../my-first-agent-langgraph/src/app/domain/follow_up_generation.py`，LLM 输出重复时返回 `None`，让既有 `build_follow_up_question()` 继续基于 focus 生成模板 fallback。
- 补充 `../my-first-agent-langgraph/tests/unit/test_follow_up_memory.py` 和 `../my-first-agent-langgraph/tests/unit/test_follow_up_generation.py`，覆盖问号/空白/大小写归一、近似重复和非重复输出保留。

验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_follow_up_generation.py tests/unit/test_follow_up_memory.py
```

目标：即使 LLM 返回重复追问，也要在代码层拦截，避免重复问题进入状态。

涉及文件：

```text
../my-first-agent-langgraph/src/app/domain/follow_up_memory.py
../my-first-agent-langgraph/src/app/domain/follow_up_generation.py
../my-first-agent-langgraph/tests/unit/test_follow_up_generation.py
../my-first-agent-langgraph/tests/unit/test_follow_up_memory.py
```

实现范围：

- 新增 `normalize_question_text()`。
- 新增 `is_duplicate_follow_up_question(candidate, memory)`。
- 支持完全相同与简单近似重复：
  - 忽略空白、大小写、中文/英文问号差异。
  - 对中文和英文使用轻量 token overlap/Jaccard。
- 如果 LLM 结果重复，则返回 `None`，让现有 `build_follow_up_question()` fallback 生成模板追问。
- fallback 也要基于 focus 生成，不直接重复已有追问。

预计代码改动：约 150-220 行。如果接近上限，先只做完全相同去重，近似重复放 Unit 04。

自验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_follow_up_generation.py tests/unit/test_follow_up_memory.py
```

验收点：

- LLM 返回与历史追问完全相同的问题时，`ensure_generated_follow_up_question()` 不采用该问题。
- 中英文问号、重复空格、大小写差异不会绕过去重。
- 非重复追问仍正常返回。

### Unit 04：把追问记忆显式落入 session state

状态：已完成（2026-06-21）

实际改动：

- 在 `../my-first-agent-langgraph/src/app/schemas/interview_state.py` 新增 `FollowUpMemoryState`，并给 `InterviewSessionState.followUpMemory` 设置默认值，兼容旧 checkpoint。
- 在 `../my-first-agent-langgraph/src/app/domain/interview_initialization_pipeline.py` 初始化 `resumeDigest`、`jobDescriptionDigest` 和空 `askedQuestions`。
- 在 `../my-first-agent-langgraph/src/app/domain/interview_state_machine.py` 成功提出追问后追加 `followUpMemory.askedQuestions` 并更新 `updatedAt`。
- 更新 `../my-first-agent-langgraph/src/app/domain/follow_up_memory.py`，优先读取显式 `followUpMemory`，为空时兼容扫描 nodes。
- 补充 schema、初始化、状态机和 snapshot 测试。

实现备注：

- 实际追加写入放在 `apply_user_reply()` 的 state 组装路径中，而不是让只返回 node 的 `apply_follow_up()` 直接修改 state 级字段。

验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_interview_state_schema.py tests/unit/test_interview_state_machine.py tests/unit/test_follow_up_memory.py tests/unit/test_interview_initialization_pipeline.py
```

目标：在 `InterviewSessionState` 中增加轻量 `followUpMemory` 字段，使记忆不是临时从节点散扫出来的隐含结果，同时保持旧 checkpoint 兼容。

涉及文件：

```text
../my-first-agent-langgraph/src/app/schemas/interview_state.py
../my-first-agent-langgraph/src/app/domain/interview_initialization_pipeline.py
../my-first-agent-langgraph/src/app/domain/interview_state_machine.py
../my-first-agent-langgraph/tests/unit/test_interview_state_schema.py
../my-first-agent-langgraph/tests/unit/test_interview_state_machine.py
```

建议 schema：

```json
{
  "followUpMemory": {
    "askedQuestions": ["string"],
    "resumeDigest": "string",
    "jobDescriptionDigest": "string",
    "updatedAt": "string|null"
  }
}
```

实现范围：

- 新增 `FollowUpMemoryState`，字段提供默认值，保证旧状态可 `model_validate`。
- 初始化面试时写入 resume/JD digest。
- `apply_follow_up()` 成功提出追问时，把问题追加到 `followUpMemory.askedQuestions`。
- 保持 `build_follow_up_memory_snapshot()` 可以从显式 memory 读取，同时兼容扫描 nodes。

预计代码改动：约 180-240 行。若超过 200 行，拆成：

- Unit 04A：schema + 初始化。
- Unit 04B：状态机追加写入。

自验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_interview_state_schema.py tests/unit/test_interview_state_machine.py tests/unit/test_follow_up_memory.py
```

验收点：

- 老 fixture 不带 `followUpMemory` 也能通过 state schema。
- 初始化后的 state 有 resume/JD digest。
- 提出追问后 `askedQuestions` 增加一条。

### Unit 05：追问重复时自动重试一次

状态：已完成（2026-06-21）

实际改动：

- 更新 `../my-first-agent-langgraph/src/app/domain/follow_up_generation.py`，`generate_follow_up_question()` 在重复追问被拒绝时最多重试一次。
- 第二次 prompt 会附加 `Rejected duplicate question` 和 `Choose a different uncovered angle`，要求模型换一个未覆盖角度。
- LLM input/output metadata 增加 `attemptIndex`，output metadata 保留 `duplicateRejected`。
- 更新 `../my-first-agent-langgraph/tests/unit/test_follow_up_generation.py`，覆盖第一次重复第二次成功、两次重复后不采用 LLM 输出、日志 attempt metadata。

验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_follow_up_generation.py
python -m ruff check src/app/domain/follow_up_generation.py tests/unit/test_follow_up_generation.py
```

目标：当模型第一次返回重复追问时，带着拒绝原因重试一次，提高生成质量，而不是总是退回模板。

涉及文件：

```text
../my-first-agent-langgraph/src/app/domain/follow_up_generation.py
../my-first-agent-langgraph/tests/unit/test_follow_up_generation.py
```

实现范围：

- `generate_follow_up_question()` 支持最多 2 次尝试。
- 第二次 prompt 附加：
  - rejected duplicate question
  - choose a different uncovered angle
- 如果第二次仍重复或无效，返回 `None` 交给 fallback。
- LLM log metadata 加 `attemptIndex` 和 `duplicateRejected`。

预计代码改动：约 120-200 行。

自验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_follow_up_generation.py
```

验收点：

- mock model 第一次返回重复、第二次返回新问题时，最终采用第二次。
- mock model 两次都重复时，不采用 LLM 输出。
- log 中可以看到重试 attempt。

### Unit 06：持久化用户面试记忆表

状态：已完成（Unit 06A/06B/06C/06D/06E 已完成，2026-06-21）

Unit 06A 实际改动：

- 在 `../my-first-agent-langgraph/src/app/schemas/interview_report.py` 新增 `InterviewUserMemoryWrite`、`InterviewUserMemoryRecord` 和 `InterviewUserMemoryProfile`。
- 在 `../my-first-agent-langgraph/src/app/integrations/report_repository.py` 新增 `interview_user_memories` 与 `interview_user_memory_profiles` 表初始化。
- 新增 repository 底层方法：`write_user_memory()`、`get_user_memory()`、`list_user_memories()`、`delete_oldest_user_memory()`、`upsert_user_memory_profile()`、`get_user_memory_profile()`。
- 更新 `../my-first-agent-langgraph/tests/unit/test_report_repository.py`，覆盖 memory 表初始化、同用户 list、同 `userId + interviewId` upsert、按用户删除最旧摘要且不影响其他用户/原始 report、profile upsert。

Unit 06A 验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_report_repository.py
python -m ruff check src/app/schemas/interview_report.py src/app/integrations/report_repository.py tests/unit/test_report_repository.py
```

Unit 06B 实际改动：

- 新增 `../my-first-agent-langgraph/src/app/domain/interview_memory_tool.py`，提供 `update_interview_memory_tool()` 作为持久化 user memory 的唯一业务写入口。
- 新增结构化 `UpdateInterviewMemoryInput`，tool 内部负责生成 `InterviewUserMemoryWrite`、profile payload、markdown excerpt 裁剪、weakness key 归一和 profile 计数合并。
- 在 `../my-first-agent-langgraph/src/app/config.py` 新增 `MAX_USER_INTERVIEW_MEMORY_COUNT` 配置。
- 在 `InterviewReportRepository` 新增 `write_user_memory_with_profile()`，按“upsert profile -> 容量达上限时删除该用户最旧 memory -> upsert memory”的顺序在同一 SQLite 事务中执行。
- 新增 `../my-first-agent-langgraph/tests/unit/test_interview_memory_tool.py`，覆盖同 `userId + interviewId` 幂等、容量上限不跨用户删除、profile recurring 计数和 markdown excerpt 长度上限。

Unit 06B 验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_interview_memory_tool.py tests/unit/test_report_repository.py
python -m ruff check src/app/config.py src/app/domain/interview_memory_tool.py src/app/integrations/report_repository.py tests/unit/test_interview_memory_tool.py tests/unit/test_report_repository.py
```

Unit 06D 实际改动：

- `user_memory_profile` 聚合画像更新由 Unit 06B 的 `update_interview_memory_tool()` 与 `write_user_memory_with_profile()` 一并落地。
- 覆盖稳定弱项、改善领域、反复问题、weakness counters 和 last memory ids 的同步更新。
- 对应验证包含在 `tests/unit/test_interview_memory_tool.py` 与 `tests/unit/test_report_repository.py`。

Unit 06D 验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_interview_memory_tool.py tests/unit/test_report_repository.py
python -m ruff check src/app/domain/interview_memory_tool.py src/app/integrations/report_repository.py tests/unit/test_interview_memory_tool.py tests/unit/test_report_repository.py
```

Unit 06E 实际改动：

- 新增 `../my-first-agent-langgraph/src/app/domain/interview_memory_summary.py`，维护独立 memory summary system prompt 和 `InterviewMemorySummaryOutput`。
- 新增 `build_interview_memory_summary_prompt()`，只把结构化 report summary 与弱项 question review 注入 prompt，不注入候选人完整回答原文。
- 新增 `deterministic_interview_memory_summary()` 和 `generate_interview_memory_summary_with_model()`，支持 mock evaluator 验证与后续真实模型接入。
- 弱项过滤遵守 1-10 量纲：`score < 7.0` 或 `missingPoints` 非空才进入 weak reviews / reinforcement hints。
- 新增 `../my-first-agent-langgraph/tests/unit/test_interview_memory_summary.py`，覆盖 prompt 隐私边界、弱项阈值、高分无漏点过滤和 fake evaluator。

Unit 06E 验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_interview_memory_summary.py
python -m ruff check src/app/domain/interview_memory_summary.py tests/unit/test_interview_memory_summary.py
```

Unit 06C 实际改动：

- 更新 `../my-first-agent-langgraph/src/app/graphs/nodes/report_generation.py`，`persist_report_node()` 在 report DB 写入成功后 best-effort 生成 memory summary 并调用 `update_interview_memory_tool()`。
- 新增 `INTERVIEW_MEMORY_USER_ID` 配置；环境变量缺失时跳过持久化 user memory，只保留 report succeeded。
- memory summary 或 tool 失败时只返回 `memory_status=failed` / `memory_error`，不把已成功的 report 标记为 failed。
- `persist_report_node()` 支持注入 `memory_summary_evaluator` 和 `memory_updater`，测试可 mock，避免节点直接散落 repository memory 写入。
- 更新 `../my-first-agent-langgraph/tests/unit/test_report_generation_nodes.py`，覆盖成功调用 memory tool、summary 失败不影响 report succeeded、缺少 user id 时跳过。

Unit 06C 验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_report_generation_nodes.py
python -m pytest tests/integration/test_interview_inline_report_generation.py
python -m ruff check src/app/config.py src/app/graphs/nodes/report_generation.py tests/unit/test_report_generation_nodes.py
```

后续单元：

- Unit 07：下次面试启动时用轻量检索召回历史记忆。

目标：面试报告生成成功后，把“可供下次面试召回的记忆摘要”通过工具调用入库。

涉及文件：

```text
../my-first-agent-langgraph/src/app/domain/interview_memory_tool.py
../my-first-agent-langgraph/src/app/domain/interview_memory_summary.py
../my-first-agent-langgraph/src/app/domain/report_generation_runtime.py
../my-first-agent-langgraph/src/app/graphs/interview_graph.py
../my-first-agent-langgraph/src/app/graphs/nodes/report_generation.py
../my-first-agent-langgraph/src/app/integrations/report_repository.py
../my-first-agent-langgraph/src/app/schemas/interview_report.py
../my-first-agent-langgraph/tests/unit/test_interview_memory_tool.py
../my-first-agent-langgraph/tests/unit/test_interview_memory_summary.py
../my-first-agent-langgraph/tests/unit/test_report_repository.py
../my-first-agent-langgraph/tests/unit/test_report_generation_nodes.py
../my-first-agent-langgraph/tests/integration/test_interview_inline_report_generation.py
```

建议新增表：

```sql
CREATE TABLE IF NOT EXISTS interview_user_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_interview_id TEXT NOT NULL,
  source_thread_id TEXT NOT NULL,
  target_role TEXT NOT NULL,
  overall_score REAL,
  weakness_summary_json TEXT NOT NULL,
  missing_points_json TEXT NOT NULL,
  improvement_advice_json TEXT NOT NULL,
  reinforcement_question_hints_json TEXT NOT NULL,
  report_markdown_excerpt TEXT NOT NULL,
  embedding_text TEXT NOT NULL,
  embedding_json TEXT,
  source_report_completed_at TEXT NOT NULL,
  summary_generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, source_interview_id)
);

CREATE TABLE IF NOT EXISTS interview_user_memory_profiles (
  user_id TEXT PRIMARY KEY,
  stable_weaknesses_json TEXT NOT NULL,
  improved_areas_json TEXT NOT NULL,
  recurring_mistakes_json TEXT NOT NULL,
  weakness_counters_json TEXT NOT NULL,
  last_memory_ids_json TEXT NOT NULL,
  summary_count INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
```

摘要 LLM 规则：

- 新增 memory summary agent/prompt，复用 report 生成 agent 的 DeepSeek API key。
- 不复用 report 生成 prompt；memory summary system prompt 单独维护。
- summary prompt 输入只包含 report 结构化输出、逐题 review、分数、missingPoints、improvementAdvice，不需要候选人完整回答原文。
- 报告单题分数采用 1-10 量纲；只有 `score < 7.0` 或 `missingPoints.length > 0` 的 review 才进入弱项摘要和 reinforcement hints。
- 没有弱项时可以写入“无强化弱项”的简短摘要，但不生成 reinforcement hints。

memory summary system prompt 初稿：

```text
You are maintaining long-term interview memory for future mock interviews.
Use the report data to create a compact, structured memory summary.
Scores use a 1-10 scale. Only include weak areas when score < 7.0 or missingPoints is non-empty.
Do not copy full candidate answers.
Do not expose private narrative details unless they are necessary as technical evidence.
Return JSON only with: weaknessSummary, missingPoints, improvementAdvice,
reinforcementQuestionHints, normalizedWeaknessKeys, improvedAreas, embeddingText.
```

工具调用约束：

- 新增 `update_interview_memory_tool(input)` 作为唯一写入口。
- background report runner、report graph node、lazy backfill、未来管理接口都只能调用该 tool，不直接调用 repository 写 memory。
- tool input 必须是结构化 schema，至少包含 `userId`、`sourceInterviewId`、`sourceThreadId`、`targetRole`、`sourceReportCompletedAt`、`summaryGeneratedAt` 和摘要内容。
- tool 内部负责幂等、冲突检测、时间戳生成/校验和 repository 写入。
- tool 内部负责执行每用户摘要数量上限；达到上限时，先删除该用户最久远摘要，再写入新摘要。
- tool 写入新摘要后同步更新 `interview_user_memory_profiles`。
- tool 内部事务顺序必须是：先生成并确认 profile 更新 payload -> 在同一事务内 upsert profile -> 删除该用户最久远摘要（如超上限）-> 写入新摘要。
- report graph node / background runner 测试必须 mock tool，断言成功路径只调用 `update_interview_memory_tool()`，不直接 import repository 写 memory 方法。
- repository 仍保留底层读写方法，但标注为 infrastructure，不在业务流程直接调用。

用户标识策略：

- 当前版本先从环境变量读取固定用户 ID，例如 `INTERVIEW_MEMORY_USER_ID`。
- 如果环境变量缺失，历史持久化记忆默认关闭，只保留 session memory。
- schema 和 start request 预留 `userId`，以后接入多租户登录时改为登录用户 ID。
- 禁止只用 `threadId` 当用户维度，因为下次面试会产生新 thread。

实现范围：

- 新增 `InterviewUserMemoryWrite/Record` schema。
- 新增 `InterviewUserMemoryProfile` schema。
- `InterviewReportRepository` 增加 `write_user_memory()` 和 `list_user_memories()`。
- `InterviewReportRepository` 增加 `delete_oldest_user_memory(user_id)` 和 `upsert_user_memory_profile()`。
- 新增 `update_interview_memory_tool()`，由它统一调用 repository。
- 新增 `generate_interview_memory_summary_with_model()`，用 DeepSeek API 和独立 system prompt 生成摘要。
- 从 `ReportGenerationOutput.summary.improvementPriorities` 与 `questionReviews[].missingPoints/improvementAdvice/score` 生成 LLM 摘要输入。
- 报告单题分数采用 1-10 量纲；只把 `score < 7.0` 或 `missingPoints.length > 0` 的 review 写入弱项和 reinforcement hints。
- 摘要生成时机放在 `persist_report_node` 成功写入 report DB 后，或 `run_report_generation_for_thread()` 确认报告成功后立即执行；init 阶段只召回，缺失时才 best-effort lazy backfill。
- memory summary 失败不能把已成功的 report 标记为 failed；应记录错误并保持 report status API 仍以 report DB 中的 succeeded report 为准。
- 每条 memory 保存 report markdown excerpt，不保存超长全文。
- 每条 memory 保存 `embeddingText`，并在可用时保存 embedding，用于下次 DB-backed lightweight retrieval 召回。
- 每条 memory 写入 `sourceReportCompletedAt`、`summaryGeneratedAt`、`createdAt`、`updatedAt`。
- 配置每用户摘要上限，例如 `MAX_USER_INTERVIEW_MEMORY_COUNT=20`。
- profile 更新时对语义相同或高度相近的 weakness key 合并，并让计数 +1。

预计代码改动：约 180-240 行。若超过 200 行，拆成：

- Unit 06A：schema + repository 表和读写测试。
- Unit 06B：`update_interview_memory_tool()` 和幂等/冲突/容量上限测试。
- Unit 06C：`persist_report_node` / `run_report_generation_for_thread()` 成功路径调工具写入 memory。
- Unit 06D：`user_memory_profile` 聚合画像更新测试。
- Unit 06E：DeepSeek memory summary prompt + 弱项阈值测试。

自验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_interview_memory_tool.py tests/unit/test_interview_memory_summary.py tests/unit/test_report_repository.py tests/unit/test_report_generation_nodes.py
python -m pytest tests/integration/test_interview_inline_report_generation.py
```

验收点：

- 生成报告成功后，同一个 `userId + interviewId` 只写一条 memory。
- 测试证明 report graph node / background runner 是通过 `update_interview_memory_tool()` 写入，而不是直接写 repository。
- memory 中能看到低分题的 missing points 和 improvement advice。
- 在 1-10 量纲下，`score >= 7.0` 且 `missingPoints=[]` 的 review 不进入 reinforcement hints。
- memory summary 失败时，report DB 中已成功生成的 report 仍保持 succeeded，status/markdown/read API 不受影响。
- markdown excerpt 有长度上限。
- memory 每条记录都有 `sourceReportCompletedAt`、`summaryGeneratedAt`、`createdAt`、`updatedAt`。
- 同一弱项出现冲突摘要时，召回层以最新 `summaryGeneratedAt` 为准。
- 达到每用户摘要上限时，写入新摘要会删除该用户最久远的一条摘要。
- 删除最久远摘要不会删除其他用户摘要，也不会删除原始 report 表。
- 写入新摘要时，profile upsert、删除最旧摘要、写入新摘要在同一个事务内完成。
- 写入新摘要后，`user_memory_profile` 会更新稳定弱项、改善领域或反复问题。
- 语义相同的 weakness 被合并到同一 key，计数 +1。
- 环境变量 `INTERVIEW_MEMORY_USER_ID` 缺失时，不写入持久化 user memory。

### Unit 07：下次面试启动时用轻量检索召回历史记忆

状态：已完成（Unit 07A/07B/07C/07D/07E 已完成，2026-06-21）

Unit 07A 实际改动：

- 在 `../my-first-agent-langgraph/src/app/schemas/interview_state.py` 新增 `HistoricalInterviewMemoryState` 与 `HistoricalInterviewMemoryProfileState`，并给 `InterviewSessionState.historicalMemory` 设置默认值，兼容旧 checkpoint。
- 在 `../my-first-agent-langgraph/src/app/config.py` 新增 `USER_MEMORY_RETRIEVAL_TOP_K`。
- 新增 `../my-first-agent-langgraph/src/app/domain/interview_memory_retriever.py`，封装同用户过滤、DB-backed memory list、关键词 overlap fallback、topK 排序和 profile 加载。
- 新增 `../my-first-agent-langgraph/tests/unit/test_interview_memory_retriever.py`，覆盖同用户召回、跨用户隔离、关键词相关性、profile 加载和无 user/memory 的空结果。
- 更新 `../my-first-agent-langgraph/tests/unit/test_interview_state_schema.py`，断言旧 state 默认补空 `historicalMemory`。

Unit 07A 验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_interview_memory_retriever.py tests/unit/test_interview_state_schema.py tests/unit/test_report_repository.py
python -m ruff check src/app/config.py src/app/domain/interview_memory_retriever.py src/app/schemas/interview_state.py tests/unit/test_interview_memory_retriever.py tests/unit/test_interview_state_schema.py
```

Unit 07B 实际改动：

- Runtime：`../my-first-agent-langgraph/src/app/schemas/interview_start.py` 的 structured start request 增加可选 `userId`。
- Runtime：`../my-first-agent-langgraph/src/app/domain/interview_initialization_pipeline.py` 在初始化资源阶段按 `structured.userId` 优先、`INTERVIEW_MEMORY_USER_ID` 兜底调用 `retrieve_user_interview_memory()`，并把结果写入 `InterviewSessionState.historicalMemory`。
- BFF：`bff/src/config.ts` 增加 `INTERVIEW_MEMORY_USER_ID` 配置，`bff/src/modules/agent/interview-start-contract.ts` 增加可选 `userId`，`agent.service.ts` 在 start payload 中透传配置 user id。
- Frontend：`frontend/src/services/interview-start-request.ts` 预留可选 `userId`，不改 UI。
- 测试覆盖 runtime 初始化召回、BFF contract/service 透传、前端 service 可选 userId。

Unit 07B 验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_interview_initialization_pipeline.py tests/unit/test_interview_memory_retriever.py tests/unit/test_interview_state_schema.py
python -m ruff check src/app/domain/interview_initialization_pipeline.py src/app/schemas/interview_start.py tests/unit/test_interview_initialization_pipeline.py

cd G:/project/my-first-agent/my-first-agent/bff
node --test --require ts-node/register src/modules/agent/interview-start-contract.test.ts src/modules/agent/agent.service.test.ts

cd G:/project/my-first-agent/my-first-agent/frontend
npm run test -- src/services/interview-start-request.test.ts
```

Unit 07C 实际改动：

- 更新 `../my-first-agent-langgraph/src/app/domain/interview_memory_retriever.py`，新增 `merge_canonical_user_memories()`。
- 同一 weakness key 多条摘要时，按 `summaryGeneratedAt desc, sourceReportCompletedAt desc, createdAt desc` 保留最新 canonical memory。
- `retrieve_user_interview_memory()` 现在先 canonical merge，再按关键词相关性与时间排序取 topK。
- 新增 best-effort `lazy_backfill` callback 参数；无 memory 时可触发回填，异常不阻塞初始化。
- 更新 `../my-first-agent-langgraph/tests/unit/test_interview_memory_retriever.py`，覆盖最新 canonical、显式 merge 和 lazy backfill 不阻塞。

Unit 07C 验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_interview_memory_retriever.py tests/unit/test_interview_initialization_pipeline.py
python -m ruff check src/app/domain/interview_memory_retriever.py tests/unit/test_interview_memory_retriever.py
```

Unit 07D 实际改动：

- 在 `../my-first-agent-langgraph/src/app/config.py` 新增 `USER_MEMORY_PROMPT_BUDGET_CHARS`，用于历史 memory prompt 预算。
- 在 `../my-first-agent-langgraph/src/app/domain/interview_memory_retriever.py` 新增 `trim_historical_memory_budget()`。
- 检索返回前会按预算裁剪历史 memory，优先裁低优先级 `reinforcementQuestionHints`、再 `improvementAdvice`、`missingPoints`、`weaknesses`，保留 source ids/profile 等结构。
- 更新 `../my-first-agent-langgraph/tests/unit/test_interview_memory_retriever.py`，覆盖预算裁剪优先级和输出大小上限。

Unit 07D 验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_interview_memory_retriever.py tests/unit/test_interview_initialization_pipeline.py
python -m ruff check src/app/config.py src/app/domain/interview_memory_retriever.py tests/unit/test_interview_memory_retriever.py
```

Unit 07E 实际改动：

- 更新 `../my-first-agent-langgraph/tests/unit/test_interview_memory_retriever.py`，补充 `embedding_json` 不可解析或为空时仍通过关键词 fallback 返回同用户相关摘要的测试。
- 调整测试 helper 支持显式传入 `embedding_json`，用于覆盖坏 JSON 和缺失 embedding 的降级路径。

Unit 07E 验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_interview_memory_retriever.py tests/unit/test_interview_initialization_pipeline.py
python -m ruff check src/app/domain/interview_memory_retriever.py tests/unit/test_interview_memory_retriever.py
```

目标：用户再次开始面试时，按用户维度用 DB-backed lightweight retrieval 召回相关历史摘要，并加载聚合画像，写入初始化资源。

涉及文件：

```text
../my-first-agent-langgraph/src/app/domain/interview_initialization_pipeline.py
../my-first-agent-langgraph/src/app/domain/kickoff_recovery.py
../my-first-agent-langgraph/src/app/integrations/report_repository.py
../my-first-agent-langgraph/src/app/integrations/embeddings.py
../my-first-agent-langgraph/src/app/schemas/interview_state.py
../my-first-agent-langgraph/tests/unit/test_interview_initialization_pipeline.py
../my-first-agent-langgraph/tests/unit/test_report_repository.py
../my-first-agent-langgraph/tests/unit/test_interview_memory_retriever.py
```

建议新增初始化资源字段：

```json
{
  "historicalInterviewMemory": {
    "hasMemory": true,
    "sourceInterviewIds": ["string"],
    "weaknesses": ["string"],
    "missingPoints": ["string"],
    "improvementAdvice": ["string"],
    "reinforcementQuestionHints": ["string"],
    "profile": {
      "stableWeaknesses": ["string"],
      "improvedAreas": ["string"],
      "recurringMistakes": ["string"],
      "updatedAt": "string"
    }
  }
}
```

轻量检索召回规则第一版：

- 只在同一 `userId` 范围内召回。
- query 由目标岗位、职位 JD 摘要、简历技能摘要、当前主问题共同组成。
- topK 默认 3，例如 `USER_MEMORY_RETRIEVAL_TOP_K=3`。
- 候选只来自 report DB 的 `interview_user_memories.embedding_text` 和可选 `embedding_json`。
- 如果 embedding 不可用，降级为关键词匹配 + 最新时间排序。
- 同时加载 `user_memory_profile` 聚合画像。
- 只取弱项摘要，不直接把完整报告塞进 prompt。
- 对同一 `normalizedWeaknessKey` 的多条摘要，按 `summaryGeneratedAt desc, sourceReportCompletedAt desc` 选择最新 canonical 版本。
- 如果发现历史 report 存在但 memory 摘要缺失，可触发 `update_interview_memory_tool()` 做 best-effort lazy backfill；init 不等待 backfill 完成。

为什么需要 DB-backed lightweight retrieval：

- 用户多次面试后，最新摘要未必和本次岗位相关。
- 轻量检索可以在同用户边界内把“当前岗位/JD/简历/主问题”与历史弱项对齐，避免把无关弱项注入 prompt。
- retrieval topK + prompt 预算可以控制上下文长度，不会因为历史摘要数量增长而线性变长。
- 检索仍然服从每用户摘要上限，因此库规模可控。

实现范围：

- kickoff structured request 增加可选 `userId`。
- BFF start request 透传 `userId` 或稳定用户 key。
- `resolve_interview_initialization_resources()` 调用 `retrieve_user_interview_memory()`。
- `resolve_interview_initialization_resources()` 查询 `user_memory_profile`。
- `InterviewSessionState` 增加可选 `historicalMemory` 或放入 `resumeContext` 的扩展字段。
- 新增 `interview_memory_retriever.py`，封装 query 构造、同用户过滤、DB-backed embedding/keyword fallback、topK。
- 新增 `merge_canonical_user_memories()` 或等价纯函数，集中处理冲突摘要最新优先。
- 新增历史记忆预算裁剪函数，确保 prompt 历史记忆区不超过 800-1200 tokens。

预计代码改动：约 180-260 行。建议拆成：

- Unit 07A：runtime schema + user memory lightweight retriever。
- Unit 07B：BFF 透传用户标识。
- Unit 07C：canonical merge + lazy backfill tool-call 测试。
- Unit 07D：历史记忆预算裁剪测试。
- Unit 07E：embedding unavailable keyword fallback 测试。

自验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_interview_initialization_pipeline.py tests/unit/test_report_repository.py

cd G:/project/my-first-agent/my-first-agent
npm run test:unit -- bff/src/modules/agent/interview-start-contract.test.ts bff/src/modules/agent/agent.service.test.ts
```

验收点：

- 新面试带同一 `userId` 时能召回上一轮 memory。
- 不同 `userId` 不能互相召回。
- 无历史 memory 时保持现有启动流程。
- 同一弱项多条摘要冲突时，只把最新 canonical 摘要放进初始化资源。
- 摘要缺失时只触发 best-effort 工具回填，不阻塞 init。
- 初始化资源包含 lightweight retrieval topK 摘要和 `user_memory_profile`。
- 轻量检索只在同一 `userId` 下召回，不跨用户。
- embedding 不可用时，关键词 fallback 仍能返回同用户相关摘要。
- prompt 预算裁剪遵守固定优先级。

### Unit 08：主问题规划强化历史弱项

状态：已完成（2026-06-21）

实际改动：

- 更新 `../my-first-agent-langgraph/src/app/domain/question_planner.py`，在 `ProfessionalQuestionPlan` 增加 `historicalWeaknessSignals` 与 `reinforcementIntent`，并在有历史弱项时只标记一个现有 plan 为 `review-weakness`，不增加题数。
- 更新 `../my-first-agent-langgraph/src/app/domain/interview_initialization_pipeline.py`，把同用户历史 memory 召回提前到主问题规划前，并把 weaknesses、missing points 和 reinforcement hints 作为 planner 强化信号。
- 更新 `../my-first-agent-langgraph/src/app/domain/question_query.py`，把历史弱项写入 base query 和 `capability_probe`，引导 RAG 检索验证候选人是否已改善。
- 更新 `../my-first-agent-langgraph/tests/unit/test_interview_initialization_pipeline.py` 和 `../my-first-agent-langgraph/tests/unit/test_question_query.py`，覆盖历史弱项标记、初始化接线和 query 注入。

验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_question_query.py tests/unit/test_interview_initialization_pipeline.py
python -m ruff check src/app/domain/question_planner.py src/app/domain/question_query.py src/app/domain/interview_initialization_pipeline.py tests/unit/test_question_query.py tests/unit/test_interview_initialization_pipeline.py
```

目标：初始化主问题时，不只根据简历/JD 召回题目，还要覆盖上一轮答得不好的点。

涉及文件：

```text
../my-first-agent-langgraph/src/app/domain/question_planner.py
../my-first-agent-langgraph/src/app/domain/question_query.py
../my-first-agent-langgraph/src/app/domain/interview_initialization_pipeline.py
../my-first-agent-langgraph/tests/unit/test_question_query.py
../my-first-agent-langgraph/tests/unit/test_interview_initialization_pipeline.py
```

实现策略：

- 在 `ProfessionalQuestionPlan` 中新增可选字段：

```json
{
  "historicalWeaknessSignals": ["string"],
  "reinforcementIntent": "none|review-weakness|verify-improvement"
}
```

- 如果历史 memory 中有与简历/JD 匹配的弱项，生成 1 个 `review-weakness` plan。
- query 构造时把 weak signals 放入 `capability_probe` 或新 `weakness_reinforcement` query。
- 总题数不增加，只替换低优先级普通题，避免面试变长。

预计代码改动：约 150-220 行。

自验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_question_query.py tests/unit/test_interview_initialization_pipeline.py
```

验收点：

- 有历史弱项时，至少一个 plan 带 `reinforcementIntent=review-weakness`。
- 无历史弱项时，planner 输出与当前行为一致。
- 总主问题数量不超过 settings。

### Unit 09：追问生成强化上一轮薄弱点

状态：已完成（2026-06-21）

实际改动：

- 更新 `../my-first-agent-langgraph/src/app/domain/follow_up_memory.py`，`FollowUpMemorySnapshot.historicalReportMemory` 现在从 `InterviewSessionState.historicalMemory` 读取 weaknesses、missing points、improvement advice 和 reinforcement hints。
- 更新 `../my-first-agent-langgraph/src/app/domain/follow_up_generation.py`，追问 prompt 增加 `Historical interview memory` 标记和约束：只在当前 topic / main question 相关时使用历史记忆，不生成泛泛的“上次没答好”问题。
- 更新 `../my-first-agent-langgraph/tests/unit/test_follow_up_memory.py` 和 `../my-first-agent-langgraph/tests/unit/test_follow_up_generation.py`，覆盖历史弱项进入 snapshot / prompt，并确认候选人当前回答原文仍不进入长期追问记忆。

验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_follow_up_memory.py tests/unit/test_follow_up_generation.py
python -m ruff check src/app/domain/follow_up_memory.py src/app/domain/follow_up_generation.py tests/unit/test_follow_up_memory.py tests/unit/test_follow_up_generation.py
```

目标：当前题目追问时，基于当前主问题和历史 memory 中相关弱项，追问用户上次没答好的地方是否已经改进。

涉及文件：

```text
../my-first-agent-langgraph/src/app/domain/follow_up_memory.py
../my-first-agent-langgraph/src/app/domain/follow_up_generation.py
../my-first-agent-langgraph/tests/unit/test_follow_up_memory.py
../my-first-agent-langgraph/tests/unit/test_follow_up_generation.py
```

实现范围：

- `FollowUpMemorySnapshot` 增加 `historicalWeaknessMemory`。
- prompt 增加：
  - `Historical interview memory`
  - `Use it only when relevant to the current topic and current main question`
  - `Do not ask a generic "last time you did poorly" question`
  - `Do not inject candidate answer transcript or current question dialogue record`
- 生成后仍走 Unit 03/05 的去重和重试。

预计代码改动：约 120-200 行。

自验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_follow_up_memory.py tests/unit/test_follow_up_generation.py
```

验收点：

- prompt 包含历史弱项摘要。
- 当历史弱项与当前 topic 相关时，mock 模型能生成强化追问。
- 已问过的强化追问仍会被去重。

### Unit 10：BFF/前端用户标识与隐私边界

状态：已完成（2026-06-21）

实际改动：

- Unit 07B 已完成 `INTERVIEW_MEMORY_USER_ID` 配置、BFF `userId` 透传和前端 service 可选 `userId` 预留。
- 更新 `../my-first-agent-langgraph/src/app/schemas/interview_state.py`，在 `InterviewSystemSettings` 增加默认开启的 `enableHistoricalMemory`。
- 更新 `../my-first-agent-langgraph/src/app/domain/interview_initialization_pipeline.py`，当 `enableHistoricalMemory=false` 时跳过历史 memory 召回和 planner 强化。
- 更新 `bff/src/modules/agent/interview-start-contract.ts`，canonical settings schema 支持 `enableHistoricalMemory`，默认值为 `true`。
- 更新 `frontend/src/schemas/interview-setup.ts`，前端构造 settings 时默认开启历史 memory，不新增 UI 展示完整历史报告内容。
- 补充 Python、BFF、前端测试 fixture 和禁用历史 memory 的 runtime 测试。

验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/unit/test_interview_initialization_pipeline.py tests/unit/test_interview_state_schema.py
python -m ruff check src/app/schemas/interview_state.py src/app/domain/interview_initialization_pipeline.py tests/unit/test_interview_initialization_pipeline.py tests/unit/test_interview_state_schema.py

cd G:/project/my-first-agent/my-first-agent/bff
node --test --require ts-node/register src/modules/agent/interview-start-contract.test.ts src/modules/agent/agent.service.test.ts

cd G:/project/my-first-agent/my-first-agent/frontend
npm run test -- src/services/interview-start-request.test.ts src/services/interview-session-storage.test.ts src/services/interview-session-recovery.test.ts
npm run test -- src/router/index.test.ts src/views/AgentChatView.test.ts
```

目标：当前版本用环境变量固定 `userId`，同时为未来多租户登录预留字段和边界。

涉及文件：

```text
G:/project/my-first-agent/my-first-agent/bff/src/modules/auth/**
G:/project/my-first-agent/my-first-agent/bff/src/modules/agent/**
G:/project/my-first-agent/my-first-agent/frontend/src/services/interview-start-request.ts
```

实现范围：

- 新增环境变量 `INTERVIEW_MEMORY_USER_ID`，当前版本所有持久化记忆都归属该用户。
- structured start request 预留 `userId`，但第一版优先使用 runtime 环境变量。
- 后续多租户登录接入时，将 `INTERVIEW_MEMORY_USER_ID` 替换为登录态 user id，并保留同一 schema。
- 增加可选设置 `enableHistoricalMemory`，默认可先开启，但测试要覆盖关闭。
- 不在前端展示完整历史报告内容，避免隐私误展示。

预计代码改动：约 150-230 行。必要时拆成 BFF 和 frontend 两步。

自验证：

```bash
cd G:/project/my-first-agent/my-first-agent
npm run test:unit -- bff/src/modules/auth/auth.service.test.ts bff/src/modules/agent/interview-start-contract.test.ts bff/src/modules/agent/agent.service.test.ts frontend/src/services/interview-start-request.test.ts
```

验收点：

- start request 中能带上用户标识。
- 环境变量 `INTERVIEW_MEMORY_USER_ID` 存在时，runtime 使用该值作为 user memory owner。
- 环境变量缺失时，历史持久化记忆关闭，session memory 仍可用。
- 关闭 `enableHistoricalMemory` 时 runtime 不召回历史报告。
- 测试证明不同用户不会共享记忆。

### Unit 11：端到端验证历史报告强化提问

状态：已完成（2026-06-21）

实际改动：

- 更新 `../my-first-agent-langgraph/tests/integration/test_interview_inline_report_generation.py`，新增完整链路测试：
  1. 第一场面试进入 wrap-up 后跑 `run_report_generation_for_thread()`。
  2. report DB 写入 succeeded report，并通过 deterministic memory summary + `update_interview_memory_tool()` 写入 `interview_user_memories`。
  3. 同一 `userId` 第二次 structured start 通过 graph 初始化召回历史 memory。
  4. `user-b` 启动时不能召回 `user-a` 的 memory。
  5. 初始化 resources 中至少一个 professional plan 带 `reinforcementIntent=review-weakness`。
- 测试只替换 memory summary LLM 输出为确定性结果，其余 graph、checkpoint、report DB、memory tool、retriever 和初始化链路均走真实实现。

验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/integration/test_interview_inline_report_generation.py
python -m pytest tests/unit/test_report_generation_nodes.py tests/unit/test_interview_memory_tool.py tests/unit/test_interview_memory_retriever.py
python -m ruff check tests/integration/test_interview_inline_report_generation.py
```

目标：完整证明“第一次面试生成报告并入库，第二次面试召回报告，并强化上一轮薄弱点”。

涉及范围：

```text
../my-first-agent-langgraph/tests/integration/test_interview_short_flow.py
G:/project/my-first-agent/my-first-agent/e2e/interview-*.test.ts
```

测试场景：

1. 用户 `user-a` 完成第一次短面试。
2. 报告包含 `missingPoints=["缺少失败降级", "缺少指标阈值"]`。
3. background report runner / report graph 成功持久化报告后，调用 LLM summary agent，并通过 `update_interview_memory_tool()` 写入 `interview_user_memories`。
4. 用户 `user-a` 开始第二次面试。
5. 初始化资源通过 DB-backed lightweight retrieval 召回同用户相关历史 memory。
6. 主问题或追问 prompt 包含“失败降级/指标阈值”的强化方向。
7. 用户 `user-b` 开始面试时不能召回 `user-a` 的记忆。
8. 高分且无 missingPoints 的 review 不进入 reinforcement hints。

预计代码改动：约 150-240 行。

自验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/integration/test_interview_short_flow.py tests/integration/test_interview_inline_report_generation.py tests/unit/test_report_generation_nodes.py

cd G:/project/my-first-agent/my-first-agent
npm run test:e2e:interview:smoke:python
```

验收点：

- memory 入库可查。
- 第二次面试可通过 DB-backed lightweight retrieval 召回同用户相关历史 memory。
- 强化提问覆盖上一轮低分/漏答点。
- 跨用户隔离有效。
- 1-10 分制下的弱项阈值 `score < 7.0 or missingPoints.length > 0` 生效。

### Unit 12：BFF/前端契约审计，不默认改 UI

状态：已完成（2026-06-21）

实际改动：

- 审计 BFF request schema、agent service 和前端 session storage/recovery：当前新增 memory 字段只存在于 runtime checkpoint state，BFF/前端不需要展示完整历史报告内容。
- 更新 `frontend/src/services/interview-session-storage.test.ts`，补充旧本地会话缺少 `enableHistoricalMemory` 时仍能通过 shared settings schema 默认补 `true` 的回归测试。
- 修正前端测试 fixture 中 `enableHistoricalMemory` 的缩进，保持 settings fixture 清晰。

验证：

```bash
cd G:/project/my-first-agent/my-first-agent/bff
node --test --require ts-node/register src/modules/agent/agent.schemas.test.ts src/modules/agent/agent.service.test.ts

cd G:/project/my-first-agent/my-first-agent/frontend
npm run test -- src/services/interview-session-storage.test.ts src/services/interview-session-recovery.test.ts src/services/interview-start-request.test.ts
```

目标：确认新增 memory 字段不会破坏 BFF、SSE snapshot、前端 session recovery。

涉及文件：

```text
G:/project/my-first-agent/my-first-agent/bff/src/modules/agent/**
G:/project/my-first-agent/my-first-agent/frontend/src/services/interview-session-*.ts
G:/project/my-first-agent/my-first-agent/e2e/**
```

实现范围：

- 先审计现有 contract 是否透传 unknown fields。
- 如果 BFF snapshot schema 丢弃 `followUpMemory` 且前端不需要展示，则不改 UI。
- 如果 schema 严格校验导致失败，只补充可选字段，不展示。

预计代码改动：0-120 行。

自验证：

```bash
cd G:/project/my-first-agent/my-first-agent
npm run test:unit -- bff/src/modules/agent/agent.schemas.test.ts bff/src/modules/agent/agent.service.test.ts
npm run test:unit -- frontend/src/services/interview-session-storage.test.ts frontend/src/services/interview-session-recovery.test.ts
```

验收点：

- 默认 Python runtime 返回带 `followUpMemory` 的 state 时 BFF 不报错。
- 前端恢复会话不依赖该字段也能正常工作。
- 若新增字段进入前端类型，字段必须是可选。

### Unit 13：Mastra 回滚 provider 最小对齐

状态：已完成（2026-06-21）

实际改动：

- 按 Mastra skill 要求先确认已安装 `node_modules/@mastra/*`，本单元未引入新的 Mastra memory API。
- 更新 `src/mastra/lib/interview-question-generator.ts`：
  - 新增 rollback 侧追问 memory 区块，按“历史报告 -> 简历 -> JD -> 弱项 -> 已问追问 -> 当前主问题”顺序注入。
  - 移除 dedicated follow-up prompt 对 `Current question dialogue record` 的依赖，避免把候选人当前回答原文塞进追问记忆区。
  - 新增 `normalizeFollowUpQuestionText()` 和重复追问拦截，模型返回已问追问时保留原分析结果，不写入重复问题。
- 更新 `src/mastra/lib/interview-question-generator.test.ts`，覆盖 prompt 顺序、简历/JD/已问追问注入、候选人回答原文不注入、归一化去重和重复输出拒绝。

验证：

```bash
cd G:/project/my-first-agent/my-first-agent
npm run test:unit -- src/mastra/lib/interview-question-generator.test.ts src/mastra/lib/interview-state-machine.test.ts
npm run build
```

备注：仓库没有 `typecheck` 脚本，使用 `mastra build` 作为 rollback provider 编译验证。

目标：当前仓库 `src/mastra/**` 是回滚 provider。默认 runtime 稳定后，只做最小兼容，避免回滚时重新出现重复追问问题。

涉及文件：

```text
G:/project/my-first-agent/my-first-agent/src/mastra/lib/interview-question-generator.ts
G:/project/my-first-agent/my-first-agent/src/mastra/lib/interview-state-machine.ts
G:/project/my-first-agent/my-first-agent/src/mastra/lib/interview-state-machine-schema.ts
G:/project/my-first-agent/my-first-agent/src/mastra/lib/interview-question-generator.test.ts
```

实现范围：

- 按 AGENTS.md 要求，任何 Mastra 代码改动前再次查当前安装版本文档。
- 不引入新的 Mastra memory API，优先复用已有 thread working memory/state metadata。
- 对齐字段名或至少对齐去重行为。

预计代码改动：约 150-220 行。必要时拆成 schema 和 prompt 两步。

自验证：

```bash
cd G:/project/my-first-agent/my-first-agent
npm run test:unit -- src/mastra/lib/interview-question-generator.test.ts src/mastra/lib/interview-state-machine.test.ts
```

验收点：

- Mastra fallback 生成追问时 prompt 包含历史追问、简历、JD。
- 重复追问会被拒绝或 fallback。
- 不改变默认 provider 选择。

### Unit 14：端到端回归与可观测性

状态：已完成（2026-06-21）

实际改动：

- 更新 `../my-first-agent-langgraph/tests/integration/test_interview_short_flow.py`，在短流程集成测试中断言：
  - 至少生成 2 条追问。
  - `InterviewSessionState.followUpMemory.askedQuestions` 记录了追问。
  - 追问经 `normalize_question_text()` 归一化后无重复。
- 保持 outcome artifact 现有 shape 不变；`followUpMemory` 只要求存在于 runtime checkpoint/session state，不强行写入 outcome 文件。

验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/integration/test_interview_short_flow.py tests/unit/test_follow_up_generation.py tests/unit/test_follow_up_memory.py
python -m ruff check tests/integration/test_interview_short_flow.py tests/unit/test_follow_up_generation.py tests/unit/test_follow_up_memory.py
```

目标：验证真实面试短流程中追问不会重复，且日志中能看到 memory 注入。

涉及范围：

```text
../my-first-agent-langgraph/tests/integration/test_interview_short_flow.py
G:/project/my-first-agent/my-first-agent/e2e/interview-*.test.ts
```

实现范围：

- 增加一个短流程测试 fixture：简历含 RAG/Agent Memory，JD 含记忆管理/工具调用。
- 模拟两轮回答，让系统生成至少两条追问。
- 断言追问文本不重复。
- 断言最终 snapshot/state 中含 `followUpMemory.askedQuestions`。

预计代码改动：约 150-220 行。若 e2e 改动较大，先做 Python integration，再补跨仓库 e2e。

自验证：

```bash
cd ../my-first-agent-langgraph
python -m pytest tests/integration/test_interview_short_flow.py tests/unit/test_follow_up_generation.py

cd G:/project/my-first-agent/my-first-agent
npm run test:e2e:interview:smoke:python
```

验收点：

- 短流程至少产生 2 条追问。
- 追问归一化后无重复。
- prompt log 或测试模型捕获的 prompt 中，记忆区块严格按“用户历史面试报告 -> 用户简历信息 -> 职位 JD 信息 -> 用户上次面试弱项 -> 当前面试已问追问 -> 当前主问题”的顺序出现。
- prompt 中不包含“已问追问 + 候选人回答”组成的当前题目对话记录。

## 5. 为什么这样制定

1. **先纯函数，后状态机**：追问记忆先从现有 state 提取，不先改 schema，可以最快得到可验证行为，也降低对 checkpoint 兼容性的风险。
2. **复用报告库扩展持久记忆**：现有 `interview_reports` 和 `interview_report_items` 已经保存报告、逐题评分、漏答点和建议。新增用户记忆表比重新设计一套存储更小、更可验证。
3. **记忆更新必须工具化**：把 memory update 收敛到 `update_interview_memory_tool()`，可以让写入、幂等、冲突处理、审计和未来权限控制都有单一入口。
4. **report 后立即用 LLM 摘要，init 只召回**：当前 report 生成后数据最完整，LLM 摘要可以后台完成，不影响下一次面试启动速度。init 阶段只做 DB-backed lightweight retrieval、profile 加载和 canonical merge。
5. **轻量检索召回历史摘要**：固定加载最新摘要可能污染当前岗位；DB-backed lightweight retrieval 能在同用户范围内按当前岗位/JD/简历/主问题召回更相关的历史弱项。
6. **环境变量 userId 降低第一版接入成本**：当前版本用 `INTERVIEW_MEMORY_USER_ID` 固定用户，避免先做完整登录系统；schema 保留 `userId`，方便后续多租户登录替换。
7. **最新摘要优先**：面试能力会变化，当前轮次报告比更早报告更能代表用户现状。按时间戳最新优先，同时保留旧记录，可以兼顾准确性和审计。
8. **每用户摘要上限保护库和 prompt**：摘要可以多次生成，但每个用户只保留有限条摘要。达到上限时删除该用户最久远摘要，长期趋势进入 `user_memory_profile`。
9. **profile 语义合并计数**：同义弱项不能重复堆积成多条标签，需要归并到同一 key 并增加计数，才能形成稳定长期画像。
10. **prompt 约束和代码去重双保险**：只改 prompt 无法保证模型一定不重复；只做代码去重又会损失生成质量。所以先注入记忆，再做确定性拦截，最后加一次重试。
11. **主问题和追问都使用历史弱项**：上一轮弱项不能只在追问阶段使用，否则可能当前题目根本覆盖不到。初始化 planner 需要先安排强化方向，追问生成再根据当前回答继续深入。
12. **每步约 200 行**：schema、prompt、去重、状态写入、报告入库、轻量检索召回、规划强化、回滚对齐分别拆开，方便独立 review，也方便失败时只回滚一个小单元。
13. **默认 runtime 优先**：AGENTS.md 已说明新 interview runtime features 应落在 `../my-first-agent-langgraph`，当前仓库 Mastra 只作为 rollback provider 对齐。
14. **测试可自证**：每个单元都优先用单元测试验证，不依赖真实 LLM 的随机输出；只有最后一步才跑 integration/e2e。

## 6. 风险与边界

1. 如果把完整简历/JD 全量塞入每次追问 prompt，成本和噪声都会升高，所以计划中使用 digest/裁剪。
2. 近似重复很难用简单规则完美判断，第一版以确定性规则为主，后续可加 embedding 相似度。
3. 如果 checkpoint 中已有旧 state，新增字段必须有默认值，否则会破坏恢复会话。
4. 如果前端或 BFF schema 严格校验 snapshot，可能需要补可选字段，但不建议第一版做 UI 展示。
5. Mastra fallback 只做行为对齐，不应成为新功能主实现位置。
6. 持久化用户记忆必须有用户隔离。当前版本用 `INTERVIEW_MEMORY_USER_ID` 固定用户；环境变量缺失时关闭历史持久化记忆。
7. 记忆关闭和删除能力要预留。第一版至少提供 `enableHistoricalMemory=false` 的入口，后续再做用户主动清除历史记忆。
8. 历史弱项只能作为强化方向，不能变成对候选人的负面标签。prompt 中要要求“验证是否改进”，而不是“假定仍然不会”。
9. 工具调用写入必须是幂等的。background report runner 重试、report graph 重入或 lazy backfill 重试时，不能重复创建同一面试 memory。
10. 摘要生成依赖 LLM，必须在 report 后异步执行，不应放进用户下次 init 的关键路径。
11. 每用户摘要上限会删除最久远摘要，因此长期趋势必须沉淀到 `user_memory_profile`，否则会丢失反复弱项的统计。
12. 最新摘要优先可能掩盖长期反复出现的弱项。第一版先按最新 canonical 提问，并在 `user_memory_profile` 中保留趋势字段，例如 `recurrenceCount`。
13. 历史记忆轻量检索需要严格 userId 过滤，否则会造成跨用户记忆污染。
14. DB-backed embedding 不可用时必须有关键词 fallback，否则历史记忆会静默失效。
15. 历史报告原文和摘要的隐私边界暂不处理；后续若上线真实多用户，需要单独补隐私裁剪、删除和导出策略。

## 7. 建议的完成顺序

```text
Unit 01 -> Unit 02 -> Unit 03 -> Unit 04 -> Unit 05 -> Unit 06 -> Unit 07 -> Unit 08 -> Unit 09 -> Unit 10 -> Unit 11 -> Unit 12 -> Unit 14 -> Unit 13
```

说明：先完成默认 runtime 的 session 去重，再做报告入库和历史召回。BFF/前端契约审计可以在 runtime schema 稳定后做。Mastra 回滚对齐建议放到默认 runtime 完成且测试稳定之后，避免同一需求在两个 runtime 里同时反复改动。

# Interview Report Bell And Async Report Delivery Plan

## 背景

本计划整理用户需求：

- 前端右上角新增 bell，只用于查看面试结束后的报告生成状态。
- 面试结束后不再在聊天区展示“等待异步评分完成后生成最终报告。当前进度：0/6。请稍后再发送一条消息获取报告。”这类内容。
- 面试结束时聊天区直接提示：面试已结束，报告生成中；生成进度和最终 markdown 下载入口由右上角 bell 查看。
- bell 根据 Redis 中当前面试的任务列表/manifest 显示进度。
- 报告生成完成后，bell 提示并提供 `.md` 文件下载。
- 如果用户没有查看过生成的报告，则 bell 右上角显示未查看消息数量；没有未查看报告时不显示角标。
- 查验 report 生成链路：确认 Redis 有任务消息后，是否会启动 subagent 进行报告生成。

## 当前查验结论

### 前端

- 主要聊天页在 `frontend/src/views/AgentChatView.vue`。
- 流式协议解析在 `frontend/src/services/agent-stream.ts`。
- 前端当前只识别 `interviewStateManagerTool` 的 `tool-result`，并用 `finalReportReady` 判断面试完成。
- 当前没有 bell、报告状态轮询、报告已读状态、`.md` 下载入口。
- 当前报告仍会通过 assistant message 出现在聊天区，`isInterviewCompleted` 直接依赖 `finalReportReady`。

### BFF

- BFF 入口在 `bff/src/modules/agent/agent.controller.ts` 和 `bff/src/modules/agent/agent.service.ts`。
- 当前 BFF 只代理 `/api/agents/chat/stream`，以及保存面试反馈。
- 当前没有报告状态 API、报告 markdown 下载 API、报告已读标记 API。
- BFF 已能按 `AGENT_RUNTIME_PROVIDER` 路由到默认 Python runtime 或 Mastra rollback runtime。

### 默认 Python LangGraph Runtime

- 默认运行时位于 sibling repo：`../my-first-agent-langgraph`。
- Redis evaluation store 位于 `src/app/integrations/redis_evaluation_store.py`。
- answer evaluation worker 位于 `src/app/workers/answer_evaluation_worker.py`，启动脚本是 `scripts/run_answer_evaluation_worker.py`。
- wait/read 逻辑位于 `src/app/domain/evaluation_report_reader.py`。
- 集成测试 `tests/integration/test_interview_short_flow.py` 当前断言了“等待异步评分完成”文案。
- 现状是：Redis pending queue 会被 answer-evaluation worker 消费，用于单题异步评分；最终 report 生成仍是在面试图流程到达 wrap-up 后同步等待/读取评分结果并生成，不是独立的 Redis report-generation subagent。

### Mastra Rollback Runtime

- Mastra 回滚链路也已有 answer evaluation Redis store、worker、wait/read tool：
  - `src/mastra/lib/redis-evaluation-store.ts`
  - `src/mastra/lib/answer-evaluation-runner.ts`
  - `src/mastra/scripts/run-answer-evaluation-worker.ts`
  - `src/mastra/tools/interview-evaluation-report-tool.ts`
- 按仓库说明，新 runtime 功能优先落到 LangGraph repo；Mastra 只做 rollback 兼容、构建修复或必要对齐。

## 目标方案

### 产品行为

1. 用户完成最后一道面试题后，聊天区只显示简短结束提示：

   ```text
   面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。
   ```

2. 右上角 bell 常驻在面试页面 header。
3. bell popup 显示当前面试报告任务：
   - 生成中：`已完成 completedCount / expectedCount`
   - 失败：展示失败数量和重试/稍后提示
   - 完成：展示“报告已生成”，提供 `.md` 下载按钮
4. 报告完成但用户未打开/下载时，bell 显示未查看数量 `1`。
5. 用户打开 bell 并查看完成态，或点击下载报告后，标记为已读，角标消失。

### 技术策略

第一阶段建议不直接把完整 report 塞进聊天消息，而是新增一个报告状态/下载面：

- Redis 继续作为任务进度真源。
- Python runtime 负责暴露 report status、report markdown、已读状态。
- report-generation worker/subagent 负责异步生成最终 markdown 报告并入库。
- BFF 负责转发给前端，隐藏 runtime provider 差异。
- 前端 bell 只调用 BFF，不直接访问 Python runtime 或 Redis。

## 后端实施计划

### 1. 定义报告状态 contract

新增共享响应形状，建议字段：

```ts
type InterviewReportStatus = {
  threadId: string;
  reportState: 'not-started' | 'generating' | 'ready' | 'failed';
  sealed: boolean;
  expectedCount: number;
  completedCount: number;
  failedCount: number;
  unreadCount: number;
  markdownAvailable: boolean;
  reportId: string | null;
  updatedAt: string | null;
  blockingReason?: 'manifest-missing' | 'not-sealed' | 'pending' | 'failed' | 'timeout';
};
```

Python 侧用 Pydantic schema，BFF/前端用 TypeScript type 或 Zod schema 对齐。

### 2. Python runtime 增加报告状态 API

建议新增：

```text
GET /api/interviews/{thread_id}/report/status
GET /api/interviews/{thread_id}/report/markdown
POST /api/interviews/{thread_id}/report/read
```

状态 API 同时读取 evaluation manifest、report manifest、DB report 记录和 read receipt：

- `expectedCount = len(expectedTaskIds)`
- `completedCount = len(completedTaskIds)`
- `failedCount = len(failedTaskIds)`
- `sealed = manifest.sealed`
- `reportState = reportManifest.status`
- `markdownAvailable = reportManifest.status === 'succeeded' && DB 中存在 markdown`
- `unreadCount = markdownAvailable && read receipt 不存在 ? 1 : 0`

read API 写入 DB read receipt，并可同步写 Redis read receipt 缓存：

```text
interview:{threadId}:report:read
```

值包含：

```json
{ "readAt": "ISO_TIMESTAMP" }
```

无登录用户体系时，MVP 使用 threadId 级别已读；后续有用户身份后再扩展为 userId + threadId。

### 3. Python runtime 调整面试结束文案

修改 `src/app/graphs/nodes/process_user_reply.py` 或其调用的 wrap-up 逻辑：

- 当最后一题完成且 evaluation manifest 还未 ready 时，不返回“等待异步评分完成...当前进度...”。
- 改为固定短提示：

```text
面试已结束，报告生成中。生成进度和最终报告可在右上角通知中查看。
```

同步更新测试：

- `tests/integration/test_interview_short_flow.py`
- 相关 snapshot/golden transcript 测试

### 4. 查验并补齐 report 生成触发链路

当前结论：已有 Redis 消息会启动/驱动 answer-evaluation subagent worker，但没有独立 report-generation subagent。

本需求确定采用方案 B：新增独立 `report-generation` Redis queue、report-generation worker/subagent，以及持久化入库链路。面试主流程只负责结束面试、seal evaluation manifest、enqueue report generation task，并向前端返回“面试已结束，报告生成中”。最终报告由 report-generation agent 异步生成。

新增 Redis key：

```text
report-generation:pending
interview:{interviewId}:report:manifest
interview:{interviewId}:report:task:{taskId}
interview:{interviewId}:report:status:{taskId}
interview:{interviewId}:report:read
```

report manifest 建议字段：

```ts
type InterviewReportManifest = {
  schemaVersion: 1;
  interviewId: string;
  threadId: string;
  taskId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  evaluationExpectedCount: number;
  evaluationCompletedCount: number;
  evaluationFailedCount: number;
  reportId: string | null;
  markdownAvailable: boolean;
  attempts: number;
  lastError?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
};
```

report generation task 建议字段：

```ts
type ReportGenerationTask = {
  schemaVersion: 1;
  taskId: string;
  interviewId: string;
  threadId: string;
  resourceId?: string;
  targetRole: string;
  responseLanguage: 'zh' | 'en';
  evaluationManifestKey: string;
  createdAt: string;
};
```

worker/subagent 流程：

1. 从 `report-generation:pending` claim task。
2. 将 report status 标记为 `running`。
3. 读取 evaluation manifest，若未 sealed 或仍有 pending evaluation，则短暂等待并重入队列，避免生成 partial report。
4. 若 evaluation manifest 有 failed task，则 report status 标记为 `failed`，bell 展示失败状态，不生成报告。
5. 读取全部 LLM evaluation result、面试 session snapshot、题目节点信息、候选回答、主问题 reference answer/evaluationPoints。
6. 调用 report-generation agent 生成结构化点评和 markdown report。
7. 将 report 写入数据库，并将 report manifest 标记为 `succeeded`，写入 `reportId` 和 `markdownAvailable=true`。
8. bell status API 读取 report manifest 和 read receipt，返回进度、完成态和 unreadCount。

### 4.1 Report-Generation Agent 设计

新增 Python runtime agent/worker，建议位置：

```text
../my-first-agent-langgraph/src/app/workers/report_generation_worker.py
../my-first-agent-langgraph/src/app/domain/report_generation.py
../my-first-agent-langgraph/src/app/schemas/interview_report.py
../my-first-agent-langgraph/scripts/run_report_generation_worker.py
```

模型/API key 复用主 agent DeepSeek 配置，不新增独立 provider：

- 复用现有 `MODEL_NAME` / `DEEPSEEK_API_KEY` / 主 agent DeepSeek client 初始化路径。
- 若当前 runtime 将主模型封装为 `mainagent-deepseek`，report-generation agent 使用相同 model alias。
- report-generation worker 只增加自己的 prompt version，例如 `report-generation-v1`，便于后续追踪。

Agent 输入必须包含：

- 面试基础信息：`interviewId`、`threadId`、目标岗位、语言、题目总数。
- 每个 answer attempt 的上下文：round type、target type、主问题、追问问题、候选回答、节点对话。
- 主问题召回时附带的 `referenceAnswer` 和 `evaluationPoints`。
- answer-evaluation worker 已生成的 LLM evaluation result：classification、五维分数、weightedTotal、strengths、missingPoints、incorrectPoints、followUpFocus。

Agent 输出使用结构化 JSON，再由代码渲染 markdown，避免模型输出格式漂移：

```ts
type ReportGenerationOutput = {
  summary: {
    overallScore: number;
    overallComment: string;
    strengths: string[];
    improvementPriorities: string[];
  };
  questionReviews: Array<{
    questionId: string;
    attemptId: string;
    targetType: 'main-question' | 'follow-up';
    question: string;
    score: number;
    comment: string;
    missingPoints: string[];
    improvementAdvice: string[];
  }>;
  markdown: string;
};
```

### 4.2 Report Agent 提示词草案

System prompt：

```text
You are a senior technical interviewer writing a post-interview report.
Use Chinese when responseLanguage is zh; otherwise use English.
Return JSON only and follow the provided schema exactly.
Do not reveal full reference answers or quote them as standard answers.
Use referenceAnswer and evaluationPoints only to judge coverage.
Be specific, fair, and actionable.

For each candidate answer:
- If targetType is main-question, compare the answer against the retrieved main question's evaluationPoints and referenceAnswer.
- Identify missingPoints only for important expected points that were not covered.
- If there are no missing points, return an empty missingPoints array and do not write a missing-points sentence in markdown.
- If targetType is follow-up, grade it across these four aspects:
  1. directness: whether it directly answers the follow-up question.
  2. technical_depth: whether it explains mechanisms, trade-offs, edge cases, or constraints.
  3. evidence_specificity: whether it uses concrete project evidence, implementation details, metrics, or examples.
  4. clarity_structure: whether the answer is structured and easy to follow.
- Use the existing answer-evaluation result as scoring evidence, but write your own concise interviewer comment.
- Do not invent candidate experience that was not in the answer.
- Do not include full reference answers in the report.
```

User prompt template：

```text
Interview metadata:
{interview_metadata_json}

Evaluation results:
{ordered_evaluation_results_json}

Question and answer context:
{question_answer_context_json}

Write a markdown interview report and structured per-answer review.
For main-question answers, compare against evaluationPoints/referenceAnswer coverage.
For follow-up answers, evaluate directness, technical_depth, evidence_specificity, and clarity_structure.
Only include missing points when missingPoints is non-empty.
```

Markdown 输出建议结构：

```md
## 模拟面试报告

### 总体评价

### 综合亮点

### 优先改进项

### 逐题点评

#### 题目 1：...
- 得分：x/10
- 点评：...
- 漏答点：...
- 改进建议：...

### 后续练习建议
```

其中“漏答点”只有在对应 `missingPoints.length > 0` 时渲染；如果没有漏答点，不渲染该行，也不写“无漏答点”。

### 4.3 主问题与追问评分规则

主问题回答：

- 以召回主问题时附带的 `evaluationPoints` 为主要比对标准。
- `referenceAnswer` 只作为内部判断参考，不得原文输出。
- 漏答点只记录对题目目标有实质影响的缺失项。
- 已用不同表述覆盖的要点不算漏答。

追问回答：

- 不依赖主问题 reference answer 做逐点对照。
- 固定从 4 个方面综合评分：
  - `directness`
  - `technical_depth`
  - `evidence_specificity`
  - `clarity_structure`
- 最终追问点评分数可以由这 4 项平均得到，再结合 answer-evaluation result 的 `weightedTotal` 做校准。
- 追问的 missingPoints 只写该追问本身明显要求但候选人没有回答的内容。

### 4.4 报告入库计划

报告必须入库，Redis 只作为任务状态和通知进度层，不作为最终报告的唯一持久层。

MVP 建议在 Python LangGraph runtime 新增独立 SQLite 数据库，默认文件：

```text
interview_reports.db
```

配置项：

```text
REPORT_DATABASE_URL=sqlite:///./interview_reports.db
```

后续如部署到生产，可平滑替换为 Postgres：

```text
REPORT_DATABASE_URL=postgresql://...
```

不要复用 LangGraph checkpoint DB 存业务报告，避免 checkpoint 生命周期和业务数据生命周期耦合。

建议表结构：

```sql
CREATE TABLE interview_reports (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL UNIQUE,
  thread_id TEXT NOT NULL,
  target_role TEXT NOT NULL,
  response_language TEXT NOT NULL,
  status TEXT NOT NULL,
  overall_score REAL,
  markdown TEXT NOT NULL,
  structured_json TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model_name TEXT NOT NULL,
  source_evaluation_manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE interview_report_items (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  interview_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  round_id TEXT NOT NULL,
  round_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  question TEXT NOT NULL,
  candidate_answer TEXT NOT NULL,
  score REAL NOT NULL,
  comment TEXT NOT NULL,
  missing_points_json TEXT NOT NULL,
  improvement_advice_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(report_id) REFERENCES interview_reports(id)
);

CREATE TABLE interview_report_reads (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  UNIQUE(interview_id, thread_id)
);
```

入库写入策略：

- `interview_reports.interview_id` 加唯一索引，保证同一场面试只保留一份当前报告。
- report-generation worker 使用 `interview_id` 做幂等键。
- 如果 worker 重试时发现 `interview_reports.status='succeeded'` 且 markdown 非空，直接把 Redis report manifest 补成 succeeded，不重复调用模型。
- 插入 `interview_reports` 和 `interview_report_items` 必须在同一个事务中完成。
- 写库成功后再更新 Redis report manifest 为 `succeeded`，避免 bell 看到 ready 但 DB 无报告。
- `markdown` 存完整 `.md` 内容，下载 API 直接从 DB 读取。
- `structured_json` 存 agent 原始结构化输出，便于后续 UI 做逐题卡片化展示。
- `source_evaluation_manifest_json` 存生成报告时使用的 evaluation manifest 快照，方便审计报告是否覆盖所有评分任务。

读取策略：

- `GET /report/status` 先读 Redis report manifest，再读 DB 确认 `markdownAvailable`。
- 如果 Redis 丢失但 DB 已有 `succeeded` 报告，status API 可用 DB 反向恢复 ready 状态。
- `GET /report/markdown` 只从 DB 读取，不从 Redis 读取。
- `POST /report/read` 写 `interview_report_reads`，并可同步写 Redis read receipt 作为加速缓存。

### 5. BFF 增加报告代理 API

在 `bff/src/modules/agent/agent.controller.ts` 增加：

```text
GET /api/agents/interviews/:threadId/report/status
GET /api/agents/interviews/:threadId/report/markdown
POST /api/agents/interviews/:threadId/report/read
```

在 `AgentService` 中按 runtime provider 转发：

- 默认 `python` 转发到 Python runtime 新 API。
- `mastra` rollback 可以先返回兼容状态，或按 Mastra Redis store 实现同等读取。

`.md` 下载响应：

- `Content-Type: text/markdown; charset=utf-8`
- `Content-Disposition: attachment; filename="interview-report-{threadId}.md"`

## 前端实施计划

### 1. 新增 BFF client 方法

在 `frontend/src/services/bff-api.ts` 增加：

```ts
fetchInterviewReportStatus(threadId)
downloadInterviewReportMarkdown(threadId)
markInterviewReportRead(threadId)
```

配套测试覆盖：

- ready/generating/failed 状态解析
- 非 2xx 错误处理
- markdown 下载 blob 处理

### 2. 新增 bell UI 组件

建议新增：

```text
frontend/src/components/InterviewReportBell.vue
frontend/src/services/interview-report-status.ts
```

组件职责：

- 显示 bell icon。
- unreadCount > 0 时显示角标。
- 点击后展开报告状态 popup。
- popup 中展示进度、失败、完成状态。
- ready 时显示下载按钮。
- 点击打开 popup 或下载后调用 mark-read。

样式要求：

- 放在 `AgentChatView.vue` 的 header 右上角。
- 使用现有 `agent-card__header` 风格，不引入大面积新视觉。
- 角标只在 `unreadCount > 0` 时渲染。

### 3. 面试完成后启动状态轮询

在 `AgentChatView.vue`：

- 当 `interviewThreadId` 存在且状态进入 wrap-up/completed 时启动轮询。
- 轮询间隔建议 2 秒。
- `ready` 或 `failed` 后降低频率或停止轮询。
- 清空对话/离开页面时停止轮询。

### 4. 隐藏旧报告消息

调整 `sanitizeAssistantContent()` 或后端文案后，确保聊天区不显示旧文案：

```text
面试题目已经完成，我正在等待异步评分完成后生成最终报告...
```

更推荐在后端彻底移除该文案；前端只保留一层兼容清理，避免旧 runtime 仍返回时污染 UI。

### 5. 下载 markdown

下载按钮逻辑：

- 调用 BFF markdown endpoint。
- 用 Blob + object URL 触发 `.md` 下载。
- 文件名建议：`interview-report-{threadId}.md`。
- 下载成功后 mark-read，并刷新 bell 状态。

## 测试计划

### Python LangGraph

- 单元测试 report status resolver：
  - manifest missing
  - not sealed
  - sealed pending
  - failed
  - ready
- 集成测试更新：
  - 面试结束后不再出现“等待异步评分完成”长文案。
  - final snapshot assistantReply 是新的短提示。
  - evaluation worker 完成后 status API 返回 ready。
  - markdown API 返回完整 markdown report。
  - report-generation worker 从 `report-generation:pending` 消费任务并写入 DB。
  - report status 在 DB 写入成功前不能返回 `markdownAvailable=true`。
  - report read API 写入 `interview_report_reads` 后 unreadCount 变为 0。

### BFF

- controller/service 测试：
  - status 转发成功
  - markdown 下载 header 正确
  - runtime provider 连接失败时报 502
  - read receipt 转发成功

### Frontend

- `InterviewReportBell.vue` 组件测试：
  - generating 显示进度
  - ready + unread 显示角标
  - ready + read 不显示角标
  - failed 显示失败提示
  - 下载按钮调用 API
- `AgentChatView.test.ts`：
  - 面试完成后启动报告状态查询
  - 旧等待文案不出现在聊天区
  - 清空对话时停止/重置 report 状态

### E2E

- `npm run test:e2e:interview:complete:python`
- 新增/扩展一条 complete flow：
  - 完成面试
  - 聊天区只提示报告生成中
  - bell 显示进度
  - worker 完成评分
  - report-generation worker 生成报告并入库
  - bell 显示未读角标
  - 下载 `.md`
  - 角标消失

## 验收标准

- 面试结束后聊天区不再出现旧的“等待异步评分完成...当前进度...”文案。
- bell 可显示 Redis manifest 的任务进度。
- 报告完成后 bell 有未读角标。
- 用户查看/下载后角标消失。
- 报告可作为 markdown 文件下载。
- 新增 `report-generation:pending` queue、report-generation worker/subagent，报告由该 worker 异步生成。
- report-generation agent 复用主 agent DeepSeek API key/model alias。
- 主问题点评会结合召回主问题附带的 `referenceAnswer/evaluationPoints`，但不泄露完整参考答案。
- 追问点评会按 directness、technical_depth、evidence_specificity、clarity_structure 四方面综合评分。
- 每题只在确有漏答时展示漏答点，没有漏答点时不展示“漏答点”行。
- 最终报告必须写入 DB，Redis 只保存任务状态/通知状态。
- 默认 Python runtime 路径通过测试。
- Mastra rollback 不因前端/BFF 新接口破坏现有启动与构建。
- 文档明确记录：Redis 会驱动 answer-evaluation subagent 和 report-generation subagent；最终 markdown 报告从 DB 下载。

## 建议实施顺序

1. Python runtime：新增 report DB schema、migration/init 逻辑和 repository。

   自验条件：启动 Python runtime 或运行对应 repository 单元测试时，能自动创建/迁移 `interview_reports`、`interview_report_items`、`interview_report_reads` 三张表；同一 `interview_id` 重复写入会触发幂等路径而不是生成重复报告；读写 markdown、structured_json、read receipt 的 repository 测试通过。

2. Python runtime：新增 report-generation Redis schema/store。

   自验条件：store 单元测试覆盖 enqueue、claim、mark running、mark succeeded、mark failed、retry/requeue；Redis key 与文档中的 `report-generation:pending`、`interview:{interviewId}:report:*` 一致；重复 enqueue 同一 interview 时不会产生多个有效 report 任务。

3. Python runtime：面试结束时 seal evaluation manifest 后 enqueue report generation task，并返回短提示。

   自验条件：完成面试的集成测试中，assistantReply 只包含“面试已结束，报告生成中...”短提示，不再包含旧的“等待异步评分完成/当前进度/稍后再发送消息”文案；Redis 中出现对应 report generation task；evaluation manifest 已 sealed。

4. Python runtime：新增 report-generation agent prompt、structured output schema、worker 和启动脚本。

   自验条件：worker 单元测试使用 mock model 可生成符合 schema 的 `ReportGenerationOutput`；prompt 中明确主问题按 `evaluationPoints/referenceAnswer` 比对、追问按四个方面评分；输出校验失败会进入 retry/failed 路径；启动脚本可被直接运行并进入轮询。

5. Python runtime：worker 等待全部 evaluation result ready，生成 markdown，事务写入 DB，再更新 Redis report manifest。

   自验条件：当 evaluation 未完成时不会生成 partial report；当 evaluation 有 failed task 时 report manifest 变为 failed；当 evaluation 全部完成时 DB 事务写入 report 和 item 后，Redis report manifest 才变为 succeeded；若 DB 写入失败，Redis 不会显示 `markdownAvailable=true`。

6. Python runtime：新增 report status/read/markdown contract 与 API。

   自验条件：API 测试覆盖 generating、ready、failed、manifest missing、Redis 丢失但 DB 已有报告的恢复场景；markdown API 只从 DB 返回 `.md` 内容并设置正确 content type；read API 写入 read receipt 后 status 的 `unreadCount` 从 1 变为 0。

7. BFF：新增 report status/read/markdown 代理 API。

   自验条件：BFF service/controller 测试覆盖三类 API 的成功代理、runtime provider 连接失败 502、markdown 响应头透传或重建；前端只访问 BFF 路径，不直接访问 Python runtime。

8. Frontend：新增 BFF client。

   自验条件：`bff-api` 测试覆盖 status JSON 解析、非 2xx 错误消息、markdown blob 下载、mark-read 请求；TypeScript 类型能表达 `reportState`、`unreadCount`、`markdownAvailable`、`reportId`。

9. Frontend：新增 `InterviewReportBell.vue` 与轮询逻辑。

   自验条件：组件测试覆盖 generating 进度、ready 未读角标、ready 已读无角标、failed 提示、下载按钮；`AgentChatView` 测试证明面试结束后开始轮询，ready/failed 后停止或降频，清空对话/卸载页面时停止轮询。

10. Frontend：移除/兼容清理旧等待文案。

   自验条件：前端测试中即使上游返回旧文案，聊天区也不会显示“等待异步评分完成/当前进度/稍后再发送消息”；正常短提示仍展示；不影响普通面试问题和追问展示。

11. 测试：补齐 Python、BFF、Frontend unit tests。

   自验条件：Python 相关测试、BFF 测试、Frontend 测试分别通过；新增测试覆盖 report queue、worker、DB repository、API、bell UI、下载和已读状态；失败路径至少覆盖 Redis pending、evaluation failed、DB write failed、download not found。

12. E2E：跑完整 Python provider 面试闭环，覆盖 answer-evaluation worker、report-generation worker、DB 入库、bell 下载和已读角标。

   自验条件：E2E 完成一场 Python provider 面试后，聊天区只出现报告生成中短提示；bell 显示进度并在报告入库后显示未读角标；点击下载得到 `.md` 文件；read 后角标消失；DB 中存在对应 `interview_reports` 和 `interview_report_items` 记录；Redis report manifest 为 succeeded。

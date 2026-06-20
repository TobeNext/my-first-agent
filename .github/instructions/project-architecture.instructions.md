---
applyTo: "src/**/*.ts"
description: "Use when coding in the Mastra TypeScript source tree. Captures the current project architecture, source-of-truth files, implementation boundaries, and the required post-edit project-architecture-sync skill."
---

# Mastra Project Architecture

本仓库的源码实现必须使用 TypeScript，并遵循根级 `.github/copilot-instructions.md` 中已有的 TypeScript 规范。这里补充的是**当前项目架构、真实运行入口、设计蓝图与已落地代码的边界**，让后续编码时优先基于现状而不是凭文档想象。

## Source Of Truth

- 运行时现状以 `src/mastra/**/*.ts` 为准，尤其是 `src/mastra/index.ts`。
- 前端交互层现状以 `frontend/**` 为准；它是独立应用，不属于 Mastra runtime。
- BFF 中间层现状以 `bff/**` 为准；它负责非 AI 业务边界与下游代理，不属于 Mastra runtime。
- 架构蓝图和后续规划以 `docs/*.md` 为参考，不得把未落地设计当成已实现能力。
- 如果代码和文档冲突，先按代码理解，再决定是否补正文档或本 instruction。

## Current Runtime Snapshot

- `src/mastra/index.ts` 是当前 Mastra 运行入口，负责注册 `interview-agent`、`answer-evaluation-agent`、logger、storage 和 observability。
- `src/mastra/index.ts` 的 bundler 配置会把 `@zilliz/milvus2-sdk-node` 作为 external 处理；Milvus SDK 不应被 Mastra build 内联打包。
- 当前 Mastra runtime 注册了两个 agent：`interview-agent` 负责主面试对话，`answer-evaluation-agent` 负责异步答题评分 worker 的结构化 LLM 评分。
- 当前 Mastra 运行时的环境变量不再只依赖 CLI 隐式加载；`src/mastra/lib/load-env.ts` 会在读取模型 API key 和向量库配置前，显式尝试加载仓库根目录下的 `.env.local` 和 `.env`，以兼容直接执行构建产物的场景。
- 当前 Docker Compose 运行环境包含独立 `redis` service；Redis 仅服务 legacy Mastra rollback 的异步 LLM 答题评分任务、状态和结果存储，默认 Python LangGraph provider 的报告生成、报告状态和 markdown 下载不依赖 Redis。Compose 同时定义了默认启用的 `python-agent` service，build context 指向同级 `../my-first-agent-langgraph`，透传模型与 embedding provider 环境变量，并通过 `PY_AGENT_BASE_URL=http://python-agent:8011` 供 BFF 在 `AGENT_RUNTIME_PROVIDER=python` 时代理到 Python LangGraph runtime；Python runtime 的 `MILVUS_ADDRESS` 必须带 `http://` / `tcp://` 等 scheme 以匹配 `pymilvus.MilvusClient`，Mastra rollback service 则继续使用 Node SDK 兼容的 `host:port` 形式；Mastra service 保留，用于双运行和回滚。
- 当前本地启动入口默认走 Python provider：`npm run dev`、`npm run start`、`npm run start:local` 和 `npm run start:all` 只启动 Python LangGraph runtime、BFF 和 frontend；只有显式运行 `npm run dev:mastra`、`npm run start:mastra`、`npm run start:local:mastra` 或 `npm run start:all:mastra` 时才启动 Mastra rollback provider，且不会同时启动 LangGraph runtime。
- 仓库现在新增了独立的 `frontend/` Vue 3 + TypeScript 应用，用于承载面向用户的交互页面。当前它已经接入 BFF，提供“简历必传 + 职位 JD 选填”的信息上传页：简历在前端只做文件类型与大小校验，经由 BFF 做大小、类型和结构的二次校验；职位 JD 只做前端文件校验和内容保留、简历模板仍可下载；由 BFF 返回权威专业技能组数量，前端按该数量默认把专业技能轮题数设置为“每个技能组一题”，再结合项目经历轮题数、逐题纠错、轮次跳过和 flow-test mode 等系统设置正式开始流式面试。当前前端配置页和开始前状态文案已经明确说明：上传 JD 后，下游会提取职责、技术要求、优先技能与领域词，并用于专业技能轮权重、项目经历交叉验证和缺口能力检查，而不再只是“透传待扩展”的上下文。面试页面 header 现在包含报告通知 bell；面试进入 wrap-up/completed 后通过 BFF report status API 轮询生成进度，ready/failed 后停止轮询，ready 未读时显示角标，打开通知或下载 markdown 后写 read receipt。
- 上述 interview 页面现在还包含一个仅用于联调的 flow-test mode 设置；开启后，前端会暴露“跳过本次回答”按钮，并把保留标记传给下游 interview 状态机，由状态机 mock 回答评分、追问与流程推进，而不是只在 UI 层本地跳过。
- 上述 interview 页面现在还会在浏览器本地持久化最近一次面试会话的 `threadId`、系统设置和阶段摘要；刷新或中断后，前端路由会允许用户重新进入 interview 页面，由页面显式提供“恢复上次面试 / 放弃并重新开始”的入口，并在后端 thread 失效时清理本地状态后回退到上传页。
- 仓库现在新增了独立的 `bff/` NestJS 中间层，用于承接前端请求、执行登录和输入验证、处理上传校验、返回权威专业技能组数量，并把基于 `threadId` 的 `interview-agent` SSE 流式响应代理到 agent runtime；默认 provider 已切到 Python，BFF 仍支持通过 `AGENT_RUNTIME_PROVIDER=mastra|python` 在 `MASTRA_BASE_URL` 和 `PY_AGENT_BASE_URL` 之间切换，用于 LangGraph 默认运行与 Mastra 回滚验证。在正式启动前，BFF 会校验专业技能轮自动/自定义题数模式、逐题纠错、轮次跳过和两轮分别配置的题数设置，并在默认模式下把专业技能轮题数归一到技能组数量，不再单独提供面试方向 setup 接口。当前启动态已经从自然语言 kickoff 文案切换为结构化 JSON 启动 payload：BFF 复用统一 contract 透传 `threadId`、`resumeMarkdown`、`jobDescriptionMarkdown`、`settings`，并在代理前通过 `bff/src/modules/resume/resume-parser.ts` 这个 canonical parser 补齐标准化 `resumeSections`。BFF 还提供 interview report status、markdown 下载和 read receipt 代理 API；默认 Python provider 下转发到 Python runtime，Mastra rollback provider 下 status/read 返回兼容兜底，避免新前端报告通知轮询破坏回滚 provider。
- BFF 现在还会校验并透传 flow-test mode 设置，在启动和答题流转时补充关键日志，便于前端联调 interview 流程。
- 当前 interview 能力已经引入显式状态机：专业技能轮按 6 个节点推进，项目经历轮按 2 个节点推进；每个节点都记录主问题、可选参考答案 `referenceAnswer`、参考答案拆分出的 `evaluationPoints`、追问槽位、回答尝试、评分、漏答点、错误点和偏题恢复计数。
- 当前 interview 状态管理工具除了返回下一条 interviewer reply，也会返回结构化进度摘要（总题数、已完成题数、当前题号、当前是否处于追问）以及模板化最终报告所需的聚合信息，供前端侧边栏和结束报告直接消费。
- 当前 interview 还会把每场面试的结构化 outcome 以时间戳目录的形式落盘到仓库根目录下的 `Interview outcome/`：Mastra 在初始化和每轮答题后持续写入两类目的不同的数据结构。其一是 `selectorTraining`，专门记录召回 trace、候选题排序信号和被选题目的结果标签，用于后续 lightweight selector / reranker 训练；其二是 `candidateImprovement`，专门记录逐题表现、优势信号、聚合后的知识薄弱点、改进建议和最终评分，供用户复盘与持续提升。BFF 在面试结束后把前端提交的用户反馈回写到 `candidateImprovement.feedback`。
- 仓库根目录现在还提供了独立的 live interview E2E harness：`vitest.e2e.config.ts` 负责统一 Node 环境与 alias，`e2e/**` 负责最小全链路回归场景，根命令 `npm run test:e2e:interview:smoke` / `npm run test:e2e:interview` 现在作为 Python provider 本地与 CI 共同入口，`.github/workflows/interview-e2e.yml` 复用同一 root 命令在 workflow_dispatch 下执行 Docker Compose 版 Python 回归。`scripts/run-interview-e2e-provider.mjs` 提供 provider-aware wrapper，Python provider complete flow 现在应验证 LangGraph background report flow、DB-backed report status 和 markdown 下载，不再依赖 Redis-compatible worker；`npm run test:e2e:interview:smoke:mastra` 和 `npm run test:e2e:interview:mastra` 保留 legacy rollback 验证；`scripts/run-provider-rollback-smoke.ps1` 会依次用 Python 和 Mastra provider 启动同一 stack 并跑 smoke，验证切换只依赖 env。
- 因此，涉及 interview 方向开发时，必须区分：哪些是已经存在的实现，哪些仍属于文档定义的目标架构。

## Folder Responsibilities

- `src/mastra/agents`: Agent 定义。优先保持一个 agent 一个文件，prompt、model、tools、memory 在这里组合。
- `src/mastra/tools`: Tool 定义。对外部能力、检索、查询、数据转换的边界优先放这里，并使用 Zod 定义输入输出。
- `src/mastra/workflows`: 多步骤编排。适合封装稳定的流程，而不是把所有流程逻辑都堆进 agent prompt。
- `src/mastra/lib`: 共享基础设施与库代码，例如向量存储、索引初始化、RAG 分块与嵌入。
- `src/mastra/lib/load-env.ts` 属于运行时基础设施的一部分，专门负责把仓库根目录环境变量文件加载进 Node 进程，避免不同启动方式下的行为漂移。
- `src/mastra/lib/answer-evaluation-schemas.ts`、`src/mastra/lib/redis-config.ts`、`src/mastra/lib/redis-client.ts`、`src/mastra/lib/redis-evaluation-store.ts`、`src/mastra/lib/answer-evaluation-task-enqueue.ts` 与 `src/mastra/lib/answer-evaluation-runner.ts` 是异步 LLM 答题评分的 Redis 任务/状态/结果基础层；Redis 配置来自 `REDIS_URL`，真实客户端由 `redis` npm 包创建，业务 store 通过构造函数注入 Redis client。当前主 interview state manager 已在真实答题后 fire-and-forget 写入 Redis 评估任务；最后一题完成时会先同步确保该轮 task 已写入 manifest，再 seal interview evaluation manifest，并通过 wait/read 流程等待完整 evaluation results。`answer-evaluation-agent` 可由独立 worker 消费 pending queue 并写入 LLM evaluation result；worker 默认最多尝试 3 次，前置失败会重新入队，最终失败会写入 task status 与 manifest 的 `failedTaskIds`；`waitAndReadInterviewEvaluationsTool` 已注册到 `interview-agent`，会等待 manifest sealed 且全部任务完成后才读取完整 evaluation results，遇到 failed task 或 timeout 不返回 partial report data；最终报告会用 Redis 中的 LLM evaluation result 覆盖本地规则评分后重新计算 node summary 和 report。
- `src/mastra/scripts`: 手动执行、导入、验证、E2E 测试脚本。脚本是验证流程的一部分，不应混入运行时入口；LibSQL 向量数据迁移到 Milvus、Milvus metadata backfill/rebuild、异步 answer evaluation worker 启动脚本等也放在这里。
- `src/mastra/scorers`: 评估/打分逻辑预留目录。当前 runtime 未注册 scorer；新增 interview scorer 时保持同样的职责边界。
- `src/mastra/data`: 预留数据目录。若新增样例或导入源，优先保持原始数据与运行时代码分离。
- `src/mastra/public`: 运行时静态资源目录，仅放需要被构建产物带出的内容。
- `frontend`: 独立前端应用目录。负责页面、组件、状态管理和用户输入校验，不直接承载 Mastra agent 运行逻辑。
- `bff`: 独立 NestJS 中间层目录。负责 auth、文件上传校验、agent 请求代理和前端适配，不直接承载 agent 本体。
- `bff/src/modules/resume/resume-parser.ts`: 当前简历结构提取的单一权威实现；BFF 校验、启动 payload 预填和 Mastra kickoff 恢复都应复用这里，而不是各自维护标题切分和技能组归一化逻辑。

## Interview Feature Flow

- `interview-agent.ts` 现在主要把初始化和后续回复统一委托给 `interviewStateManagerTool`，并暴露 `waitAndReadInterviewEvaluationsTool` 供最终报告前等待 Redis 异步评分结果；启动时不再由模型串行编排简历解析和两轮题库检索。
- `interview-state-manager-tool.ts` 是 interview 链路的状态拥有者，但当前它在初始化阶段只负责编排与持久化：结构化 kickoff 解析、主问题规划、召回、生成和裁决已经下沉到独立的 initialization pipeline 与 stage 模块；state manager 主要负责调用该 pipeline、恢复/持久化与当前会话 `resourceId` 绑定的 working memory、处理后续答题推进，并在需要时调用 generator 生成追问。答题分析的规则兜底现在会读取当前节点的 `referenceAnswer` / `evaluationPoints`，用参考要点覆盖度调整 accuracy/depth/specificity、missingPoints 和 follow-up focus；没有参考答案的旧节点仍沿用原有启发式评分。对真实、已评分的用户回答，state manager 会异步 enqueue answer evaluation task 到 Redis，Redis 写入失败只记录日志，不阻塞当前面试回复。
- `interview-outcome.ts` 负责把 interview outcome 拆成 `selectorTraining` 和 `candidateImprovement` 两块结构化数据，并维护 `Interview outcome/index` 下基于 `threadId` 的索引文件。其中 `selectorTraining` 面向选题训练，`candidateImprovement` 面向用户提升与知识薄弱点沉淀。
- `interview-state-manager-tool.ts` 在初始化分支里会优先识别结构化 JSON 启动 payload，并在兼容分支中继续支持旧版 kickoff 文本恢复；`resumeMarkdown`、`jobDescriptionMarkdown` 和可选的 `resumeSections` 都会被解包为初始化上下文。初始化时显式忽略模型传入的题目数组或派生段落，只允许 tool 根据 payload 内的简历内容自行做主问题规划与 RAG 检索。专业技能轮和项目经历轮不再各自重复切字符串，而是统一消费 canonical parser 产出的标准化 section 结果、`normalizedSkills` 和 `normalizedProjectTopics`；默认模式按标准化技能组逐条执行题库检索，自定义题数时优先保证每个技能组最多命中一次，若题数超过技能组数量则补充跨技能或综合场景题；项目经历轮则复用标准化项目主题作为 fallback topic，再按项目经历上下文检索并一次性建立首轮状态，从而避免启动阶段额外的多次 tool orchestration 开销。
- `interview-initialization-pipeline.ts` 现在是 kickoff 初始化主链路的唯一编排入口：它统一负责解析 structured / legacy kickoff、生成专业技能轮 question plan、调用 retriever 收集候选题、调用 generator 产出最终题目文案，并在进入状态机前调用 critic/judge 做最小质量闸门和 deterministic fallback。
- `interview-question-retriever.ts` 负责把初始化阶段的 plan 转成专业技能轮 / 项目经历轮查询、聚合召回结果，并集中收集 `RagRecallTrace`；state manager 不再直接持有 query 构造和 trace 聚合逻辑。
- `interview-question-generator.ts` 负责两类生成行为：一类是把召回结果适配成初始化主问题集合与 generation trace，另一类是基于当前题、对话记录和回答分析生成追问文案。
- `interview-question-critic.ts` 负责初始化主问题的最小质量闸门，当前会检查空题、重复题、明显目标错位、scenario 形状不匹配和项目题形状不匹配；不通过时以 deterministic fallback 替换，避免低质量题进入状态机。
- `interview-state-manager-tool.ts` 现在还负责返回结构化 progress 摘要；前端会从同一条 SSE 流里的 `tool-result` 事件读取这个摘要，并驱动侧边栏与最终权威回复展示。
- `interview-state-machine-schema.ts` 定义结构化 working memory schema；`interview-state-machine.ts` 负责纯 reducer/helper 逻辑，包括节点初始化、按 setup 中的专业技能轮 / 项目经历轮独立题数建立两轮题目、偏题恢复、追问推进、纠错信息汇总、基于本地规则的临时报告生成，以及把 Redis LLM evaluation result 映射回 attempt/node 后重算最终报告。
- `professional-question-query.ts` 负责把专业技能选题计划转换为 RAG 查询文本、召回日志 skill 标签和题目 lens 描述；`interview-state-manager-tool.ts` 只调用该 helper，不再内联维护专业技能查询拼接细节。
- `read-only-thread-memory.ts` 是对当前 Mastra memory 行为的兼容封装，用于让 interview agent 读取 thread working memory 上下文，但不直接暴露给模型自行更新。
- `resume-parser-tool.ts` 负责暴露 canonical parser 的结果，除“专业技能”和“项目经历”两段上下文外，还会返回 `normalizedSkills`、`normalizedProjectTopics`、`warnings` 和 `validationErrors` 供下游复用。
- `interview-question-tool.ts` 负责把查询文本转成 embedding，访问向量库，并在向量召回 top 20 后只用 JD/query 抽取出的 `skillArea` 与候选题 `skillArea` 做 hybrid rerank，再从 rerank 后的 top 10 中随机抽取候选问题；RAG trace 会记录每个候选命中的 `matchedSkillArea`。如果 embedding 或 Milvus 召回失败，该 tool 会记录错误并返回空候选与空 recall trace，让 initialization critic / state machine fallback 继续生成可用面试题，而不是让 Mastra runtime 因本地向量库不可用退出。
- `vector-store.ts` 负责 Milvus 向量库实例与索引常量；`milvus-vector-store.ts` 是对 Mastra Vector API 的本地 Milvus adapter，当前 `interview_questions` collection 会把 `role`、`difficulty`、`skillArea` 写为 Milvus scalar 字段，并把这些字段合并回查询结果 metadata 以保持上层兼容；Milvus client 采用懒初始化，只有真实 list/create/query/upsert/delete 调用才建立连接，避免 dev server 在未启动 Milvus 时仅因模块加载就崩溃；`rag-pipeline.ts` 负责文本分块和 embedding 生成。
- 典型数据流是：上传简历/可选职位 JD → 前端完成本地文件类型与大小校验，并把简历文件交给 BFF 做大小、类型和结构校验 → BFF 通过 `bff/src/modules/resume/resume-parser.ts` 完成简历结构校验、技能组标准化、项目主题标准化和权威专业技能组数量计算，并返回该数量给前端 → 前端按该数量默认启用“每个技能组一题”的专业技能轮设置；职位 JD 未上传时显式保留空值，已上传时在 store 中保留 Markdown 内容 → Begin Interview 时前端通过共享 contract 生成结构化 interview start request，并把简历 Markdown、职位 JD Markdown（可为空）和系统设置交给 BFF；一旦收到权威 interview progress，前端还会把最近一次会话的 `threadId`、系统设置和阶段摘要持久化到本地，供刷新后的恢复入口使用 → BFF 在默认模式下按 canonical parser 的 `normalizedSkills` 重新归一专业技能轮题数，并补齐标准化 `resumeSections` 后把同一份结构化 payload 以 JSON 形式继续代理给当前配置的 agent runtime。provider=mastra 时，`interview-agent` 仅把原始启动 payload 作为初始化上下文交给 `interviewStateManagerTool`，不自行传入主问题数组；provider=python 时，BFF 代理到同级 Python LangGraph runtime，要求它接受相同请求体、通过 checkpoint 恢复会话、输出兼容 `text-delta` / `tool-result` / `[DONE]` 的 SSE，并继续写入兼容的 outcome / RAG sample artifact。Mastra 路径下，`interviewStateManagerTool` 调用 `interview-initialization-pipeline.ts`，由 pipeline 复用 kickoff recovery 解析 structured / legacy payload、先通过 `job-description-signals.ts` 提取 JD 职责、技术要求、优先技能与领域词，再生成 professional question plan、调用 retriever 做专业技能轮 JD 加权召回与项目经历轮“JD 要求 × 项目证据”交叉验证召回、调用 generator 适配最终主问题，并在进入状态机前经过 critic/judge 质量闸门与 fallback；其中 professional planner 会显式产出 `questionDriver`、`jobDescriptionSignals` 和 `jd-gap-scenario` 缺口验证题，generator 与 outcome 会继续保留这些 provenance 字段 → 随后 state manager 只负责把 judged question set 初始化进 working memory、写入 outcome / rag sample，并在后续每一轮答题中做规则分类、偏题恢复、切轮和 wrap-up → 只有在需要追问时才把当前题对话记录和岗位信息交给 generator 生成下一问，同时持续返回 progress 摘要与权威 interviewer reply，并更新同一份 outcome 文件中的选题标签、generation trace、逐题复盘和知识薄弱点聚合；Python 路径下，面试 wrap-up 后 stream 立即返回“报告生成中”snapshot，Python FastAPI background task 再从 checkpoint 恢复 session 并执行 answer evaluation、report generation 和 report DB persistence，BFF/前端通过 report status API 短轮询 DB-backed ready/failed 状态并下载 markdown → 前端聊天页用这些结构化结果更新侧边栏、在刷新后显式提供恢复或放弃入口，并在面试结束后通过报告 bell 展示生成进度和下载入口 → 用户在前端提交反馈表单 → BFF 校验反馈并通过 `threadId` 索引把反馈回写到 `candidateImprovement.feedback`，完成“规划题目 → 召回候选 → 生成问题 → 裁决兜底 → 用户表现 → 最终评分 → 持久化报告 → 用户反馈”的闭环。
- 如果 setup 里开启了 flow-test mode，则后续用户点击“跳过本次回答”时，前端不会发送真实回答，而是发送保留 skip marker；BFF 原样代理该消息，`interviewStateManagerTool` 识别后在状态机内部生成 mock 分析结果，继续触发追问、切题或总结，同时保持同样的 progress 摘要输出路径。

## Coding Boundaries

- 新增源码必须按运行层归属放置：前端放 `frontend`，BFF 放 `bff`，新的 interview runtime 能力放同级 Python LangGraph 仓库；不要把运行时代码散落到仓库根目录。
- 新 interview runtime 能力优先放在同级 Python LangGraph 仓库 `../my-first-agent-langgraph`。`src/mastra/**` 已冻结为 legacy rollback provider，只接受回滚 blocker、安全、构建或兼容性修复。
- 新增前端页面和交互逻辑优先放在 `frontend` 体系内，不要混入 `src/mastra`。
- 新增中间层 HTTP 适配、登录与请求聚合逻辑优先放在 `bff` 体系内，不要混入 `frontend` 或 `src/mastra`。
- 对系统边界输入使用 Zod；对共享逻辑优先抽到 `lib` 或 `tools`，避免把工具实现塞进 agent 文件。
- 前端侧的输入校验、文件元数据处理、会话历史管理、启动态 UI 和 API 调用边界，优先通过 `frontend/src/schemas`、`frontend/src/services` 和 `frontend/src/stores` 管理。
- BFF 侧的登录、上传、基于 `threadId` 的面试启动与回答流式代理等边界，优先通过 controller/service/config 分层管理。
- 简历章节切分、技能组标准化和默认技能组计数必须优先复用 `bff/src/modules/resume/resume-parser.ts`，不要在 BFF、kickoff recovery 或 state manager 中再维护第二套核心解析规则。
- 修改 `index.ts` 时，要明确这是“接线变化”，可能会改变当前可运行能力；修改 docs 时，不代表运行时已经同步完成。
- 如果新增 interview 相关功能，优先复用现有的 `interview-agent.ts`、`interview-state-manager-tool.ts`、`interview-state-machine-schema.ts`、`interview-state-machine.ts`、`interview-question-tool.ts`、`vector-store.ts`、`rag-pipeline.ts` 模式，而不是另起一套并行架构。
- interview 流程推进、切题、偏题恢复、wrap-up 和评分记录优先放在状态机 helper 或状态管理 tool 中，不要重新把这些规则散回 prompt 文案里。

## High-Value References

- `docs/INTERVIEW_AGENT_ARCHITECTURE.md`: 面试系统总体蓝图与阶段规划。
- `docs/PHASE1_KNOWLEDGE_BASE_BUILD.md`: 知识库构建、RAG、向量化设计参考。
- `docs/PHASE2_INTERVIEW_AGENT.md`: 面试 Agent 行为、阶段与 memory 设计参考。
- `docs/PHASE3_QUALITY_OPTIMIZATION.md`: scorer、质量优化与后续迭代方向。
- `docs/PHASE4_OBSIDIAN_IMPORT.md`: Obsidian 导入方向参考。
- `PLAN/2026-06-07-milvus-metadata-bm25-answer-evaluation-plan.md`: Milvus metadata contract、`skillArea` 标准化、scalar schema 和 answer evaluation 后续设计参考。
- `PLAN/2026-06-11-python-langgraph-mastra-migration-plan.md`: 后续将 Mastra Agent 后台迁移到 Python + LangGraph/LangChain 的阶段性蓝图；它是未来迁移计划，不代表当前 runtime 已经切换。
- `PLAN/2026-06-11-langgraph-migration-minimal-verifiable-units-plan.md`: 上述 LangGraph 迁移蓝图的最小可验证单元执行拆分；强调 LangGraph-first、数据结构不变和逐步验收。
- `docs/RUNTIME_PROVIDER_CUTOVER.md`: 默认 provider 切到 Python 后的回滚步骤、Mastra freeze 规则和 Mastra runtime 下线 gate。
- `PLAN/2026-04-18-interview-state-machine-plan.md`: interview 显式状态机改造方案、风险应对和验收口径。
- `.github/instructions/frontend-architecture.instructions.md`: 前端页面、组件、store、service 分层约定。
- `.github/instructions/bff-architecture.instructions.md`: BFF 的 NestJS 模块、验证与代理边界约定。
- `.github/instructions/langgraph-architecture.instructions.md`: 同级 Python LangGraph 默认 runtime 的 FastAPI、LangGraph、SSE contract、artifact 和 persistence 边界约定。
- `README.md` 与 `package.json`: 常用命令、Node/Mastra 运行方式、依赖边界。
- `vitest.e2e.config.ts` 与 `e2e/**`: live interview E2E harness、场景拆分与 outcome / report status 断言入口。`src/mastra/lib/async-answer-evaluation-e2e-smoke.test.ts` 是 legacy Mastra rollback 的 deterministic async evaluation smoke；默认 Python provider 的完成流应断言 LangGraph 后台报告生成、report DB status ready 和 markdown 下载，不再依赖 Redis worker。

## Required Post-Edit Skill

- 只要本仓库发生了代码改动，结束编辑前都必须运行 `project-architecture-sync` skill。
- 这个 skill 的目标是检查当前代码改动是否影响本 instruction 中的运行入口、目录职责、数据流或参考列表，并在必要时更新本文件。
- 即使最终判断“不需要改 instruction”，也必须先完成这一步核对，不能跳过。
- 工作区 hook 会在 session 开始时记录基线，并在 session 结束时检查本次会话新增的 `src/mastra`、`frontend` 与 `bff` 代码改动是否完成了这一步验证。
- 完成 skill 核对后，执行 `node .github/hooks/scripts/project-architecture-sync-guard.mjs record`，把“已同步 / 已核对无需更新”的结果记录给 hook。

## Update Target

- 本 instruction 的维护目标文件就是当前文件：`.github/instructions/project-architecture.instructions.md`。
- 当项目入口、关键目录职责、Interview 链路或参考文档发生变化时，优先更新这里，避免后续编码继续基于过时架构信息。

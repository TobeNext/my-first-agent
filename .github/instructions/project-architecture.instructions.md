---
applyTo: "src/**/*.ts"
description: "Use when coding in the host TypeScript source tree. Captures the current frontend/BFF host architecture, source-of-truth files, implementation boundaries, and the required post-edit project-architecture-sync skill."
---

# Host Project Architecture

本仓库的源码实现必须使用 TypeScript，并遵循根级 `.github/copilot-instructions.md` 中已有的 TypeScript 规范。这里补充的是**当前项目架构、真实运行入口、设计蓝图与已落地代码的边界**，让后续编码时优先基于现状而不是凭文档想象。

## Source Of Truth

- 维护中的 interview runtime 现状以同级仓库 `../my-first-agent-langgraph/src/app/**` 为准；本仓库的 `src/mastra/**` 是已归档 legacy runtime，不再作为后续方案或维护目标。
- 前端交互层现状以 `frontend/**` 为准；它是独立应用，不属于 agent runtime。
- BFF 中间层现状以 `bff/**` 为准；它负责非 AI 业务边界与下游代理，不属于 agent runtime。
- 架构蓝图和后续规划以 `docs/*.md` 为参考，不得把未落地设计当成已实现能力。
- 如果代码和文档冲突，先按代码理解，再决定是否补正文档或本 instruction。

## Current Runtime Snapshot

- `src/mastra/**` 是已归档 legacy Mastra runtime，仅用于历史参考；不要为它设计新功能、回滚路径、兼容性维护或后续修复计划。
- 当前 Docker Compose 运行环境定义了默认启用的 `python-agent` service，build context 指向同级 `../my-first-agent-langgraph`，透传模型与 embedding provider 环境变量，并通过 `PY_AGENT_BASE_URL=http://python-agent:8011` 供 BFF 代理到 Python LangGraph runtime；Python runtime 的 `MILVUS_ADDRESS` 必须带 `http://` / `tcp://` 等 scheme 以匹配 `pymilvus.MilvusClient`。Compose 还包含本地观测栈 `otel-collector`、`tempo` 和 `grafana`，配置文件位于 `ops/observability/**`，用于后续 OpenTelemetry trace 采集、Tempo 存储和 Grafana 查询；`bff` 与 `python-agent` 已注入同一套 OTEL base endpoint、propagator 和 sampler 环境变量，Python runtime 还包含默认关闭的 LangSmith 配置；`LANGSMITH_TRACING=true` 且提供 `LANGSMITH_API_KEY` 时启用 LangSmith，`LANGSMITH_DATA_MODE` 仅作为数据模式 metadata。
- 当前本地启动入口走 Python LangGraph provider：`npm run dev`、`npm run start`、`npm run start:local` 和 `npm run start:all` 启动 Python LangGraph runtime、BFF 和 frontend。Mastra 启动脚本如仍存在，只用于归档检查，不是新方案、回滚验证或维护目标。
- 仓库现在新增了独立的 `frontend/` Vue 3 + TypeScript 应用，用于承载面向用户的交互页面。当前它已经接入 BFF，提供“简历必传 + 职位 JD 选填”的信息上传页：简历在前端只做文件类型与大小校验，经由 BFF 做大小、类型和结构的二次校验；职位 JD 只做前端文件校验和内容保留、简历模板仍可下载；由 BFF 返回权威专业技能组数量，前端按该数量默认把专业技能轮题数设置为“每个技能组一题”，再结合项目经历轮题数、逐题纠错、轮次跳过和 flow-test mode 等系统设置正式开始流式面试。当前前端配置页和开始前状态文案已经明确说明：上传 JD 后，下游会提取职责、技术要求、优先技能与领域词，并用于专业技能轮权重、项目经历交叉验证和缺口能力检查，而不再只是“透传待扩展”的上下文。面试页面 header 现在包含报告通知 bell；面试进入 wrap-up/completed 后通过 BFF report status API 轮询生成进度，ready/failed 后停止轮询，ready 未读时显示角标，打开通知或下载 markdown 后写 read receipt。
- 上述 interview 页面现在还包含一个仅用于联调的 flow-test mode 设置；开启后，前端会暴露“跳过本次回答”按钮，并把保留标记传给下游 interview 状态机，由状态机 mock 回答评分、追问与流程推进，而不是只在 UI 层本地跳过。
- 上述 interview 页面现在还会在浏览器本地持久化最近一次面试会话的 `threadId`、系统设置和阶段摘要；刷新或中断后，前端路由会允许用户重新进入 interview 页面，由页面显式提供“恢复上次面试 / 放弃并重新开始”的入口，并在后端 thread 失效时清理本地状态后回退到上传页。
- 仓库现在新增了独立的 `bff/` NestJS 中间层，用于承接前端请求、执行登录和输入验证、处理上传校验、返回权威专业技能组数量，并把基于 `threadId` 的 `interview-agent` SSE 流式响应代理到 Python LangGraph runtime。`bff/src/main.ts` 会在 Nest/HTTP runtime 加载前先 import `bff/src/telemetry.ts`，由该 bootstrap 初始化 OpenTelemetry NodeSDK、OTLP HTTP exporter 和 auto instrumentation；`OTEL_SDK_DISABLED=true` 可短路关闭。`bff/src/modules/agent/agent.service.ts` 的 stream 代理链路现在会创建 `bff.agent.stream_chat` 和 `bff.agent.runtime_stream_request` spans，只记录 thread、provider、protocol、flow-test、JD presence 和题数等非敏感 metadata；report status、markdown 下载和 read receipt 代理链路也会创建 `bff.agent.report_status`、`bff.agent.report_markdown`、`bff.agent.report_mark_read` 与 `bff.agent.report_runtime_request` spans，且不记录报告 markdown 正文。在正式启动前，BFF 会校验专业技能轮自动/自定义题数模式、逐题纠错、轮次跳过、historical memory 开关和两轮分别配置的题数设置，并在默认模式下把专业技能轮题数归一到技能组数量，不再单独提供面试方向 setup 接口。当前启动态已经从自然语言 kickoff 文案切换为结构化 JSON 启动 payload：BFF 复用统一 contract 透传 `threadId`、可选 `userId`（来自 `INTERVIEW_MEMORY_USER_ID`）、`resumeMarkdown`、`jobDescriptionMarkdown`、`settings`（默认 `enableHistoricalMemory=true`），并在代理前通过 `bff/src/modules/resume/resume-parser.ts` 这个 canonical parser 补齐标准化 `resumeSections`。BFF 还提供 interview report status、markdown 下载和 read receipt 代理 API，并转发到 Python runtime。
- BFF 现在还会校验并透传 flow-test mode 设置，在启动和答题流转时补充关键日志，便于前端联调 interview 流程。
- 当前 interview 能力已经引入显式状态机：专业技能轮按 6 个节点推进，项目经历轮按 2 个节点推进；每个节点都记录主问题、可选参考答案 `referenceAnswer`、参考答案拆分出的 `evaluationPoints`、追问槽位、回答尝试、评分、漏答点、错误点和偏题恢复计数。
- 当前 interview 状态管理工具除了返回下一条 interviewer reply，也会返回结构化进度摘要（总题数、已完成题数、当前题号、当前是否处于追问）以及模板化最终报告所需的聚合信息，供前端侧边栏和结束报告直接消费。
- 当前 interview 还会把每场面试的结构化 outcome 以时间戳目录的形式落盘到仓库根目录下的 `Interview outcome/`：Python LangGraph runtime 在初始化和流程推进后写入结构化 outcome。其一是 `selectorTraining`，专门记录召回 trace、候选题排序信号和被选题目的结果标签，用于后续 lightweight selector / reranker 训练；其二是 `candidateImprovement`，专门记录逐题表现、优势信号、聚合后的知识薄弱点、改进建议和最终评分，供用户复盘与持续提升。BFF 在面试结束后把前端提交的用户反馈回写到 `candidateImprovement.feedback`。
- 仓库根目录现在还提供了独立的 live interview E2E harness：`vitest.e2e.config.ts` 负责统一 Node 环境与 alias，`e2e/**` 负责最小全链路回归场景，根命令 `npm run test:e2e:interview:smoke` / `npm run test:e2e:interview` 现在作为 Python provider 本地与 CI 共同入口，`.github/workflows/interview-e2e.yml` 复用同一 root 命令在 workflow_dispatch 下执行 Docker Compose 版 Python 回归。`scripts/run-interview-e2e-provider.mjs` 提供 provider-aware wrapper，Python provider complete flow 现在应验证 LangGraph background report flow、DB-backed report status 和 markdown 下载，不再依赖 Redis-compatible worker。Mastra 相关 smoke 如仍存在，视为历史脚本，不作为后续验收目标。
- 因此，涉及 interview 方向开发时，必须区分：哪些是已经存在的实现，哪些仍属于文档定义的目标架构。

## Folder Responsibilities

- `src/mastra/**`: 已归档 legacy runtime。只可作为历史参考读取；不要把新 runtime 能力、回滚方案、兼容性修复或维护计划放回这里。
- `frontend`: 独立前端应用目录。负责页面、组件、状态管理和用户输入校验，不直接承载 agent runtime 逻辑。
- `bff`: 独立 NestJS 中间层目录。负责 auth、文件上传校验、agent 请求代理和前端适配，不直接承载 agent 本体。
- `bff/src/modules/resume/resume-parser.ts`: 当前简历结构提取的单一权威实现；BFF 校验和启动 payload 预填应复用这里，而不是各自维护标题切分和技能组归一化逻辑。

## Interview Feature Flow

- Python LangGraph runtime 是 interview 链路的唯一维护实现；具体模块职责以 `.github/instructions/langgraph-architecture.instructions.md` 和 `../my-first-agent-langgraph/src/app/**` 为准。
- 典型数据流是：上传简历/可选职位 JD → 前端完成本地文件类型与大小校验，并把简历文件交给 BFF 做大小、类型和结构校验 → BFF 通过 `bff/src/modules/resume/resume-parser.ts` 完成简历结构校验、技能组标准化、项目主题标准化和权威专业技能组数量计算，并返回该数量给前端 → 前端按该数量默认启用“每个技能组一题”的专业技能轮设置；职位 JD 未上传时显式保留空值，已上传时在 store 中保留 Markdown 内容 → Begin Interview 时前端通过共享 contract 生成结构化 interview start request，并把简历 Markdown、职位 JD Markdown（可为空）和系统设置交给 BFF → BFF 在默认模式下按 canonical parser 的 `normalizedSkills` 重新归一专业技能轮题数，并补齐标准化 `resumeSections` 后把同一份结构化 payload 以 JSON 形式代理给同级 Python LangGraph runtime。
- Python runtime 通过 FastAPI 接收 BFF 请求，经 LangGraph checkpoint 恢复会话，初始化时先生成内部三段简历-JD 匹配分析；JD 非空且匹配段为空时直接返回岗位不匹配的非报告终止 snapshot，非空匹配时继续完成历史 memory 召回、题目规划、按三段结构 RAG 召回、生成、裁决、状态推进、追问和 wrap-up，并输出前端/BFF 既有消费路径需要的 `text-delta` / `tool-result` / `[DONE]` SSE。
- 面试 wrap-up 后 stream 立即返回“报告生成中”snapshot，Python FastAPI background task 再从 checkpoint 恢复 session，并执行 answer evaluation、report generation 和 report DB persistence；BFF/前端通过 report status API 短轮询 DB-backed ready/failed 状态并下载 markdown。
- Python runtime 继续写入兼容的 outcome / RAG sample artifact；前端聊天页用结构化 progress 更新侧边栏，在刷新后显式提供恢复或放弃入口，并在面试结束后通过报告 bell 展示生成进度和下载入口。用户在前端提交反馈表单后，BFF 校验反馈并通过 `threadId` 索引把反馈回写到 `candidateImprovement.feedback`。
- 如果 setup 里开启了 flow-test mode，则后续用户点击“跳过本次回答”时，前端不会发送真实回答，而是发送保留 skip marker；BFF 原样代理该消息，Python LangGraph runtime 在 domain/state-machine 层识别后生成 mock 分析结果，继续触发追问、切题或总结，同时保持同样的 progress 摘要输出路径。

## Coding Boundaries

- 新增源码必须按运行层归属放置：前端放 `frontend`，BFF 放 `bff`，新的 interview runtime 能力放同级 Python LangGraph 仓库；不要把运行时代码散落到仓库根目录。
- 新 interview runtime 能力只能放在同级 Python LangGraph 仓库 `../my-first-agent-langgraph`。`src/mastra/**` 已归档，不再接受后续 runtime 方案、回滚维护或兼容性维护。
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
- `PLAN/2026-06-11-python-langgraph-mastra-migration-plan.md`: 历史迁移蓝图；只能作为背景参考，不能作为新的后续方案依据。
- `PLAN/2026-06-11-langgraph-migration-minimal-verifiable-units-plan.md`: 历史迁移拆分；当前已经进入 LangGraph-only 维护口径，新的执行计划应以 LangGraph runtime 为唯一目标。
- `docs/RUNTIME_PROVIDER_CUTOVER.md`: 历史 cutover 记录；涉及当前 provider、BFF proxy、Docker Compose 或 E2E harness 时，以本 instruction 和 LangGraph instruction 为准。
- `docs/observability.md`: 本地 OpenTelemetry、Tempo、Grafana 和 LangSmith 启动、查询、隐私边界与排障手册。
- `docs/INTERVIEW_AGENT_EVALUATION_USAGE.md`: 当前 DeepEval + Ragas 双引擎评测体系的命令、数据集、DeepSeek eval key 配置和排障手册。
- `PLAN/2026-06-22-deepeval-ragas-evaluation-simplification-plan.md`: 当前评测体系精简计划与阶段进度；评估相关后续工作以此为准，旧 broad evaluation plan 只作历史参考。
- `PLAN/2026-04-18-interview-state-machine-plan.md`: interview 显式状态机改造方案、风险应对和验收口径。
- `.github/instructions/frontend-architecture.instructions.md`: 前端页面、组件、store、service 分层约定。
- `.github/instructions/bff-architecture.instructions.md`: BFF 的 NestJS 模块、验证与代理边界约定。
- `.github/instructions/langgraph-architecture.instructions.md`: 同级 Python LangGraph 默认 runtime 的 FastAPI、LangGraph、SSE contract、artifact 和 persistence 边界约定。
- `README.md` 与 `package.json`: 常用命令、host app 运行方式和依赖边界。
- `vitest.e2e.config.ts` 与 `e2e/**`: live interview E2E harness、场景拆分与 outcome / report status 断言入口。Python LangGraph 完成流应断言后台报告生成、report DB status ready 和 markdown 下载，不再依赖 Redis worker。

## Required Post-Edit Skill

- 只要本仓库发生了代码改动，结束编辑前都必须运行 `project-architecture-sync` skill。
- 这个 skill 的目标是检查当前代码改动是否影响本 instruction 中的运行入口、目录职责、数据流或参考列表，并在必要时更新本文件。
- 即使最终判断“不需要改 instruction”，也必须先完成这一步核对，不能跳过。
- 工作区 hook 会在 session 开始时记录基线，并在 session 结束时检查本次会话新增的 `src/mastra`、`frontend` 与 `bff` 代码改动是否完成了这一步验证。
- 完成 skill 核对后，执行 `node .github/hooks/scripts/project-architecture-sync-guard.mjs record`，把“已同步 / 已核对无需更新”的结果记录给 hook。

## Update Target

- 本 instruction 的维护目标文件就是当前文件：`.github/instructions/project-architecture.instructions.md`。
- 当项目入口、关键目录职责、Interview 链路或参考文档发生变化时，优先更新这里，避免后续编码继续基于过时架构信息。

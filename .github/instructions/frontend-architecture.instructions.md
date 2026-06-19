---
applyTo: "frontend/src/**/*.{ts,vue}"
description: "Use when coding in the Vue frontend. Captures the frontend architecture, component and service boundaries, shared governance with the backend project, and the required post-edit project-architecture-sync skill."
---

# Frontend Architecture

本 instruction 适用于 `frontend/` 下的 Vue 3 + TypeScript 前端代码。它与根级 `.github/copilot-instructions.md` 配合使用，补充前端目录职责、状态管理、组件边界和服务层规范。

## Source Of Truth

- 前端运行时现状以 `frontend/src/**`、`frontend/package.json` 和 `frontend/vite.config.ts` 为准。
- 前端是独立于 `src/mastra` 的交互层，不应把前端状态、视图逻辑或样式塞回 Mastra runtime 目录。
- 如果前端计划文档与代码不一致，优先按已落地代码理解，再决定是否回写 instruction 或 plan。

## Current Frontend Snapshot

- 前端采用 Vue 3 + TypeScript + Vite。
- 路由由 `frontend/src/router` 管理，状态由 Pinia store 管理。
- 当前包含两个页面：信息上传页和 interview 对话页。
- 信息上传页当前同时支持“简历必传 + 职位 JD 选填”两类 Markdown 文件上传：简历在前端只做文件类型和大小校验，经由 BFF 做大小、类型和结构的二次校验，并提供静态模板下载；职位 JD 只做前端文件校验与内容保留，未上传时默认为空。前端不再接收 BFF 拆出的结构化技能对象，而是只消费 BFF 返回的权威专业技能组数量，不再自行从简历 Markdown 中提取技能语义。
- Agent 对话页当前定位为 interview 页面：通过 `frontend/src/services` 调用 BFF，再由 BFF 代理到 Mastra `interview-agent`；当前要求先上传并校验简历，然后直接在页面上确认系统设置。专业技能轮默认按 BFF 返回的专业技能组数量自动设置题数，并在开始面试前按“每个技能组一题”触发 RAG 召回；如果用户切换为自定义题数，则会优先覆盖不同技能组，题数超过技能组数量时再补充跨技能或综合场景题。项目经历轮仍由页面单独配置题数，另有逐题纠错开关和轮次跳过设置。若上传职位 JD，前端会在启动面试时通过共享 start contract 生成结构化请求，并把 JD Markdown 交给 BFF；当前下游已经会把 JD 用于提取职责、技术要求、优先技能与领域词，并参与专业技能轮权重、项目经历交叉验证和缺口能力检查，因此页面文案不能再把 JD 描述为“未来待扩展”的保留上下文。
- Agent 对话页现在还包含 flow-test mode 开关；只有在该模式开启且 interview 已启动后，页面才显示“跳过本次回答”按钮，并通过 service 层发送专用 skip marker，让下游状态机 mock 评分和追问行为。
- interview 页面现在还会从现有 SSE 流里解析 `interviewStateManagerTool` 的 `tool-result` 事件，提取结构化进度信息，并在聊天区旁边显示“剩余题数 / 当前题号 / 当前是否处于追问环节”的侧边栏。面试报告生成后，页面会切换到 feedback 闭环表单，通过 schema/service 层把用户对题目贴合度、难度匹配度、整体体验和文本意见提交给 BFF。
- `frontend/src/services/bff-api.ts` 现在还提供 interview report status、markdown 下载和 read receipt client 方法；前端报告通知/bell UI 必须通过这些 BFF client 访问 `/api/agents/interviews/:threadId/report/*`，不要直接访问 Python runtime 或 Redis。
- `frontend/src/services/assistant-content.ts` 负责 assistant 文案兼容清理；旧 runtime 返回“等待异步评分完成/当前进度/稍后再发送一条消息”这类报告等待文案时，页面应在 service 层过滤，正常短提示和普通面试问题不受影响。
- interview 页面 header 现在包含 `InterviewReportBell.vue` 报告通知入口；面试进入 wrap-up/completed 后页面会轮询 BFF report status，ready/failed 后停止轮询，打开 ready 通知或下载 markdown 后会调用 read receipt 让未读角标消失。
- interview 页面现在还会通过 `frontend/src/services/interview-session-storage.ts` 和 `frontend/src/services/interview-session-recovery.ts` 在浏览器本地持久化最近一次面试的 `threadId`、系统设置和阶段摘要；刷新或中断后，路由会允许用户重新进入 interview 页面，并由页面显式提供“恢复上次面试 / 放弃并重新开始”的入口。若恢复后的首轮续答被后端判定为失效 thread，前端会清理本地无效状态并回退到上传页重新开始。

## Folder Responsibilities

- `frontend/src/views`: 页面级组件，负责页面布局和组合，不承载底层校验细节。
- `frontend/src/components`: 可复用交互组件，聚焦展示和用户动作。
- `frontend/src/components/InterviewReportBell.vue`: 面试报告通知组件，只负责 bell、角标、popup 状态展示和用户动作事件；轮询、下载和 read receipt 调用由页面/service 层处理。
- `frontend/src/stores`: Pinia 状态容器，负责页面共享状态与动作协调。
- `frontend/src/services`: 服务层与纯逻辑函数。校验、API 封装和格式化优先放这里，不要直接塞进组件模板逻辑。
- HTTP 错误解析、SSE 流事件整理和 interview 进度显示文案这类跨页面/跨 service 的纯逻辑也放在 `frontend/src/services`，页面组件只消费整理后的结果。
- 流式响应解析也属于 service 边界；SSE 事件解析不要直接散落在页面组件里。
- 如果流式响应里包含 tool-result 等结构化事件，则在 service 层完成提取、校验和回调分发；页面组件只消费已经整理好的 interview 进度和权威回复。
- 面试线程 ID、启动请求和答题请求的映射也属于 service/view model 边界，不要把下游请求结构硬编码到模板里。
- 系统设置（包括专业技能轮的自动/自定义题数模式、两轮题数、逐题纠错和轮次跳过）到后端字段的映射，也属于 service/schema/store 边界；启动态 payload 现在必须通过共享的 start-request builder 生成，不要在模板里手写启动协议字段。
- `frontend/src/schemas`: Zod schema，负责系统边界和输入约束。
- `frontend/src/types`: 领域类型定义。
- `frontend/src/router`: 路由定义与页面入口。

## Component Boundaries

- 组件优先使用 Vue 3 `script setup` + TypeScript。
- 组件负责交互与展示，复杂校验规则放入 `services` 或 `schemas`。
- 不要在多个组件里重复写文件校验、提示拼接或 API 访问逻辑。
- 不要在组件里直接硬编码未来后端流程，先通过 store 或 service 形成边界。

## State And Validation Boundaries

- 文件上传状态优先集中在 Pinia store，避免层层 props 传递。
- 文件类型、大小等系统边界校验优先使用 Zod schema。
- 简历是否可启动面试仍是共享状态层的硬门槛；职位 JD 虽为选填，但一旦选择上传，也应通过同一套前端文件约束校验后才能进入“可启动”状态。
- 任何未来来自后端的响应，在进入页面前也应经过 service/schema 层处理，而不是直接散落在组件里。
- 如果页面只展示正式回答，则应在 service 层过滤或忽略非最终输出事件，避免把下游流式元事件直接泄漏到 UI。
- 如果面试页面依赖“已上传简历”前置条件，则上传状态、简历内容和可启动标记应由共享状态层统一管理，而不是在页面间临时拼接。
- 如果面试页面依赖简历驱动默认题数，则默认值应以 BFF 返回的专业技能组数量为准，并由共享状态层统一管理；前端不要再维护另一套本地技能拆解逻辑。
- 如果页面需要把选填职位 JD 传入后续链路，也应通过 schema/service/store 统一建模；未上传时明确透传空值，已上传时负责把 Markdown 上下文稳定带到 BFF，并通过 service/展示层准确反映它已经参与下游规划、交叉验证与缺口能力检查；不要在组件里重复实现 JD 解析或检索策略。
- 如果页面支持 flow-test mode，这类联调开关和 skip marker 也应通过 schema/service/view state 统一建模，不要把保留协议字符串直接散落在模板或按钮点击逻辑里。
- 如果页面需要采集 interview outcome 反馈，也应通过 schema/service/view state 统一建模，避免把评分范围、反馈字段和提交协议直接散落在模板里。
- 如果页面需要恢复最近一次面试会话，则 `threadId`、最近一次系统设置、阶段摘要和本地清理逻辑也应通过 `frontend/src/services` 统一建模；路由只负责放行可恢复会话，页面负责显式恢复或放弃交互，不要把 `localStorage` 读写和恢复判定散落在模板里。

## Shared Governance

- 前端继续沿用根级 `.github/copilot-instructions.md` 的 TypeScript 与代码结构规范。
- 前端与后端共用 `project-architecture-sync` skill 与 hook 机制。
- 只要前端代码发生改动，结束前也必须完成架构同步核对；必要时更新前端 instruction 或项目级架构 instruction。

## Required Post-Edit Skill

- 完成前端代码改动后，执行 `project-architecture-sync` skill。
- 如果改动影响 `frontend/` 目录职责、页面分层、状态管理或项目总体结构，按需更新 instruction。
- 完成核对后，执行 `node .github/hooks/scripts/project-architecture-sync-guard.mjs record`，避免 Stop hook 拦截。

## Update Targets

- 前端局部架构说明优先更新当前文件：`.github/instructions/frontend-architecture.instructions.md`。
- 影响仓库总体结构的变化，同时更新 `.github/instructions/project-architecture.instructions.md`。

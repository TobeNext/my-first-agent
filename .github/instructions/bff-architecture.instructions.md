---
applyTo: "bff/src/**/*.ts"
description: "Use when coding in the NestJS BFF layer. Captures the BFF architecture, module boundaries, validation responsibilities, proxy role between frontend and Mastra, and the required post-edit project-architecture-sync skill."
---

# BFF Architecture

本 instruction 适用于 `bff/` 下的 NestJS TypeScript 代码。BFF 是 `frontend/` 与 `src/mastra/` 之间的中间层，负责非 AI 的接口整合、登录、校验和转发。

## Source Of Truth

- BFF 运行时现状以 `bff/src/**`、`bff/package.json` 和 `bff/tsconfig.json` 为准。
- BFF 负责应用边界逻辑，不直接实现 Mastra agent/tool/workflow 本体。

## Current Responsibilities

- `auth`: 登录相关接口与输入校验
- `resume`: 文件上传、`.md` 校验、大小校验，以及返回供前端展示和后续启动态默认题数使用的权威专业技能组数量；技能语义拆解不再由 BFF 负责，而是保留原始 Markdown 给 Mastra 处理
- `agent`: 前端 interview 启动 / 答题请求验证；负责校验专业技能轮自动/自定义题数模式、专业技能轮 / 项目经历轮各自题数、逐题纠错/轮次跳过/flow-test mode / historical memory 等系统设置，并把基于 `threadId` 的 SSE 流式响应转发到当前 agent runtime。当前启动态已经收敛到统一的结构化 start contract：前端和 BFF 复用同一份 Zod schema，BFF 在默认模式下归一题数、补齐 `resumeSections`，settings 默认携带 `enableHistoricalMemory=true`，并在 `INTERVIEW_MEMORY_USER_ID` 存在时透传可选 `userId`，随后将同一份 payload 以 JSON 形式继续透传给下游。面试结束后，BFF 还会接收用户反馈评分与文本意见，并把它写回已落盘的 `Interview outcome` 结构化 outcome 记录。BFF 现在还暴露 `GET /api/agents/interviews/:threadId/report/status`、`GET /api/agents/interviews/:threadId/report/markdown` 和 `POST /api/agents/interviews/:threadId/report/read`，默认 Python provider 下代理到 Python runtime 的 report API，Mastra rollback provider 下 status/read 返回兼容兜底、markdown 返回不可用。

## Module Boundaries

- Controller 负责 HTTP 边界与参数接收
- Service 负责业务逻辑、校验调用和下游转发
- 面向前端的 agent 请求 Zod schema 与 parse helper 放在 `agent.schemas.ts`，Controller 只组合 schema 解析与 service 调用，避免把具体校验规则散落在 handler 中
- 配置优先统一通过 `config.ts` 管理，不在多个模块里散落环境变量读取
- BFF 不直接承载页面逻辑，也不把 agent prompt 放进 NestJS 层

## Validation Boundaries

- 前端校验不能替代 BFF 校验
- BFF 必须对登录输入、聊天输入、上传文件元数据做二次校验
- BFF 还负责把上传简历中“权威专业技能组数量”解析为权威结果返回给前端，避免前端和后端各自维护一套默认题数规则
- BFF 不再拆解专业技能语义本身；`### 专业技能` 和 `### 项目经历` 的纯文本内容仍由 Mastra 负责消费，但 BFF 现在会在结构化 start payload 中预填 `resumeSections`，让下游优先使用已切好的章节上下文，同时保留完整 `resumeMarkdown` 作为兼容输入
- BFF 在 interview 启动时仍需基于简历 Markdown 归一默认模式下的专业技能轮题数，确保 `per-skill-default` 始终等于技能组数量，而不是信任前端传入的数值
- BFF 还必须对 interview 启动态设置做二次校验，尤其是专业技能轮自动/自定义题数模式、“不能同时跳过两轮”的约束、两轮题数与启用轮次的对应关系，以及 flow-test mode 这类仅联调用的布尔开关
- BFF 还必须对 interview 结束后的反馈提交做二次校验，包括 `threadId`、反馈分值范围和反馈文本长度；前端不能直接假定 outcome 文件一定存在。
- 对于职位 JD 这类选填上下文字段，BFF 负责把“未上传为空、已上传则透传”的边界语义固定下来；在扩展策略真正落地前，不要让这个字段替代现有的简历驱动链路或在 BFF 内硬编码新的检索逻辑。
- 需要转发到 Mastra 的请求，先在 BFF 内校验，再发给下游
- 需要转发到当前 agent runtime 的报告状态、markdown 下载和已读回执请求，先在 BFF 内校验 `threadId`，再按 `AGENT_RUNTIME_PROVIDER` 处理；默认 Python provider 代理到 Python runtime，Mastra rollback provider 不应因为新报告轮询接口破坏旧面试启动和构建。
- 需要转发的流式响应优先保持为流，不要在 BFF 内先聚合成完整文本再返回给前端
- 如果前端维护本地会话历史，BFF 仍需单独校验 `threadId`、启动态和当前轮次输入，而不是把前端本地状态当成可信来源

## Shared Governance

- BFF 继续沿用根级 `.github/copilot-instructions.md`
- BFF 与前端、Mastra 共用 `project-architecture-sync` skill 和工作区 hooks
- 如果 BFF 改动影响总体分层、目录职责或数据流，同时更新项目级 architecture instruction

## Required Post-Edit Skill

- 完成 BFF 代码改动后，执行 `project-architecture-sync` skill
- 完成核对后，执行 `node .github/hooks/scripts/project-architecture-sync-guard.mjs record`

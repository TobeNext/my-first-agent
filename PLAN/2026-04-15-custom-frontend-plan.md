# Custom Frontend Plan

## Goal

为当前 Mastra 项目新增一个自建前端，作为后续用户交互入口。

这个前端的首个目标不是一次性做完整产品，而是先提供一个可控的交互壳层，便于后续承载“上传简历”等用户操作，而不是继续依赖 Mastra Studio 作为最终交互界面。

已确定的核心技术决策：

- 前端框架使用 Vue 3
- 前端语言使用 TypeScript
- 设计目标优先考虑易于扩展、易于理解和职责清晰

## Scope

本次计划包含：

- 明确采用自建前端作为用户交互层
- 为后续上传简历功能预留页面、组件和接口调用位置
- 定义前后端职责边界
- 规划最小可用页面结构与交互流

本次计划不包含：

- 立即实现完整前端页面
- 完成简历解析或面试流程联动
- 设计完整账户体系、鉴权或持久化能力
- 定义最终视觉设计稿

## Proposed Architecture

1. 前端定位

- 自建前端作为用户交互层，负责文件选择、基础前端校验、结果提示和后续页面承载。
- Mastra 继续作为 AI 与业务逻辑承载层，负责 agent、tool 和后端处理能力。

1. 目录策略

- 在仓库内新增独立前端目录，避免把前端代码混入 `src/mastra`。
- 前端目录直接定为 `frontend/`，与当前 `src/mastra` 并列，降低前后端职责混杂的风险。

1. 首屏能力

- 提供一个最小页面，至少包含：页面标题、简历上传区域、校验结果反馈区。
- 第一阶段先围绕“上传简历”建立交互骨架，不扩展为完整工作台。

1. 与 Mastra 的边界

- 前端负责收集文件和展示状态。
- 后端或服务层负责接收上传请求、执行类型校验与后续处理。
- 前端不直接承载 agent 逻辑，只通过接口与后端交互。

1. 为上传简历做准备

- 上传组件需支持文件选择、重新选择、失败提示和成功提示。
- 后续“仅支持 `.md` 且限制文件大小”的规则，优先在前端做即时反馈，同时保留服务端二次校验。

## Suggested Technical Direction

- 使用 Vue 3 + TypeScript 作为基础框架组合。
- 使用 Vite 作为构建与开发工具，理由是结构直观、启动快、默认配置轻，适合作为独立前端壳层。
- 使用 Vue Router 管理页面路由，便于后续从“上传简历”扩展到更多页面。
- 使用 Pinia 管理前端状态，避免在组件之间传递过多 props，并保持状态管理简单清晰。
- HTTP 调用优先采用轻量封装的 `fetch` 服务层，而不是一开始引入过重的数据访问框架。
- API 边界输入输出继续优先使用 Zod 做运行时校验，与当前仓库的 TypeScript 约定保持一致。
- 样式层第一阶段优先采用 Vue 单文件组件配合 scoped CSS 和 CSS variables，不急于引入复杂 UI 框架，保持可读性和可维护性。
- 测试层建议使用 Vitest + Vue Test Utils，覆盖关键组件交互和基础校验逻辑。
- 前端与 Mastra 保持解耦，优先通过 HTTP API 或中间服务调用，而不是把前端逻辑塞进 agent 文件。

## Proposed Frontend Structure

- `frontend/src/main.ts`: 前端入口
- `frontend/src/App.vue`: 应用根组件
- `frontend/src/router/`: 路由定义
- `frontend/src/stores/`: Pinia 状态管理
- `frontend/src/views/`: 页面级组件
- `frontend/src/components/`: 可复用 UI 组件
- `frontend/src/services/`: API 与文件上传相关服务层
- `frontend/src/types/`: 前端领域类型定义
- `frontend/src/schemas/`: Zod schema
- `frontend/src/assets/`: 静态资源

## Governance And Customization

- 前端项目继续沿用当前仓库的根级 `.github/copilot-instructions.md`，保持统一的 TypeScript、错误处理和模块边界规范。
- 前端项目也应采用与当前项目同类的 instructions、skills 和 hooks，而不是另起一套完全不同的治理方式。
- 实现前端时，应补充一个前端专用 instruction，例如 `.github/instructions/frontend-architecture.instructions.md`，用于描述 `frontend/` 目录职责、页面分层、状态管理和服务层边界。
- 继续复用现有的 `project-architecture-sync` skill，把前端架构变化也纳入同一套架构同步流程。
- 继续复用现有的 hook 机制，并在实现前端代码时把前端路径纳入校验范围，确保前端代码改动后也要完成架构同步核对。
- 原则上采用“共享根级规范 + 补充前端专用 instruction”的方式，既统一规则，又避免把 Mastra 后端架构说明直接套到前端代码上。

## Milestones

1. 建立 `frontend/` 目录并初始化 Vue 3 + TypeScript + Vite 工程
2. 接入 Vue Router 与 Pinia，形成可扩展的基础骨架
3. 补充前端专用 instruction，并将前端纳入同一套 skill 和 hook 治理
4. 建立最小页面骨架
5. 接入上传组件
6. 接入简历文件校验反馈
7. 再进入后续简历处理能力

## Acceptance Criteria

- 已明确项目后续采用自建前端作为用户交互层
- 已明确前端不是 Mastra runtime 的一部分，而是独立交互壳层
- 已明确前端技术栈为 Vue 3 + TypeScript + Vite + Vue Router + Pinia
- 已为“上传简历”预留合理的页面与组件位置
- 已明确前端项目沿用当前仓库同类 instructions、skills 和 hooks 的治理方式
- 已明确前端与后端的职责边界，避免后续实现时职责混乱

## Risks And Notes

- 当前仓库尚无前端工程目录，实现前需要先选定技术栈和目录位置
- 如果前端过早绑定具体业务细节，后续扩展到更多交互能力时会变得难以维护
- 上传校验应采用前端即时反馈 + 服务端最终校验的双层策略，避免仅靠前端限制
- 如果直接复用当前仅面向 `src/mastra` 的架构 instruction，而不补充前端专用 instruction，后续很容易出现规则缺口或上下文污染

## Relationship To Resume Upload Plan

- `2026-04-15-resume-upload-md-validation-plan.md` 应视为本计划之后的下一阶段计划
- 先确定自建前端，再进入具体的上传简历实现与校验细节

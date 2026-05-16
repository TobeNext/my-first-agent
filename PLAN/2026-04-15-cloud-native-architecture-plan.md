# Cloud Native Architecture Plan

## Goal

将当前仓库从“Mastra 单体 + 独立前端原型”演进为云原生分层架构：`Frontend -> BFF -> Mastra`。

## Target Architecture

1. `frontend/`

- Vue 3 + TypeScript 用户交互层
- 负责页面、基础输入校验、状态管理和结果展示

1. `bff/`

- NestJS 中间层
- 负责登录、输入验证、文件上传验证、聚合前端请求、转发到 Mastra

1. `src/mastra/`

- 仅保留 AI agent、tool、workflow、memory、RAG 与 observability 相关内容
- 不承载前端交互或 BFF 适配逻辑

## Cloud Native Requirements

- Frontend、BFF、Mastra 都可单独通过命令行启动
- Frontend、BFF、Mastra 都提供各自 Dockerfile
- 仓库根目录提供 `docker-compose.yml` 用于整体联调
- 各层之间通过显式 HTTP API 通信，避免代码层直接耦合

## Governance Requirements

- Frontend、BFF、Mastra 三层共享根级 `.github/copilot-instructions.md`
- Frontend 和 BFF 分别补充各自专用 architecture instruction
- 三层继续共用 `project-architecture-sync` skill
- 工作区 hooks 扩展到同时覆盖 `frontend/`、`bff/`、`src/mastra/`

## Milestones

1. 建立云原生分层计划与目录职责
2. 引入 NestJS BFF
3. 改造前端通过 BFF 访问 Mastra
4. 补充容器化支持
5. 完成 MVP 联调
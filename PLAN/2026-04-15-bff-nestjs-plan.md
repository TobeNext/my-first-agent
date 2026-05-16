# BFF NestJS Plan

## Goal

新增一个 `bff/` NestJS 项目，作为前端与 Mastra 之间的中间层。

## Scope

本次计划包含：

- 建立最小可运行的 NestJS BFF 工程
- 增加登录接口
- 增加文件上传与校验接口
- 增加 agent 请求转发接口
- 增加 Dockerfile
- 将 BFF 纳入 instructions、skills、hooks 治理

本次计划不包含：

- 完整鉴权系统
- 数据库持久化
- 复杂用户体系
- 生产级审计与权限模型

## Proposed Modules

1. `auth`

- 提供最小登录接口
- 当前阶段用静态示例用户或配置驱动模式返回 mock token

1. `resume`

- 处理上传文件
- 使用 NestJS + Multer 接收 multipart 文件
- 校验 `.md` 后缀与文件大小

1. `agent`

- 接收前端 agent 页面请求
- 验证输入后转发到 Mastra REST API
- 当前实现代理已注册的 `interview-agent`

1. `common`

- 统一 DTO、配置、校验与错误处理

## Acceptance Criteria

- `bff/` 可以单独安装依赖并启动
- 存在可调用的登录接口
- 存在可调用的文件校验接口
- 存在可调用的 agent 转发接口
- BFF 有独立 Dockerfile
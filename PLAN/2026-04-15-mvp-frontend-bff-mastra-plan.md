# MVP Frontend BFF Mastra Plan

## MVP Target

完成一个最小闭环：

- 前端上传页先在浏览器本地校验文件
- 前端再把文件发送给 BFF 做二次校验
- 前端存在基础 agent 页面
- Agent 页面通过 BFF 请求 Mastra，并展示返回结果

## Task Split

1. 前端任务

- 保留并增强上传页面
- 增加上传到 BFF 的动作与结果展示
- 新增基础 agent 页面
- 增加前端 API service

1. BFF 任务

- 登录接口
- 上传校验接口
- Agent 转发接口
- CORS 与环境配置

1. Mastra 任务

- 保持 AI runtime 角色清晰
- 继续提供 agent HTTP API
- 当前实现使用 `interview-agent` 完成端到端联调

1. 容器化任务

- 为 `frontend/`、`bff/`、根级 Mastra 添加 Dockerfile
- 增加 `docker-compose.yml`

## Definition Of Done

- 浏览器可以完成文件上传并看到前端 + BFF 双重校验结果
- 浏览器可以在 agent 页面输入内容并收到来自 Mastra 的 AI 回复
- `docker compose up --build` 可以启动 MVP 所需服务
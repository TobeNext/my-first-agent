# 可观测性使用说明：OpenTelemetry + Tempo + Grafana + LangSmith

本文说明本项目的可观测性方案如何使用、有什么作用、适合排查哪些问题，以及如何通过示例触发和查询一次完整的跨服务 trace。

本项目当前默认运行链路是：

```text
Frontend -> BFF -> Python LangGraph Runtime -> RAG / Milvus / LLM / Embedding
```

可观测性链路是：

```text
BFF / Python Runtime
  -> OpenTelemetry SDK
  -> OpenTelemetry Collector
  -> Grafana Tempo
  -> Grafana Explore
```

LangSmith 是可选链路；当你显式开启并提供 API key 后，会用于观察 Python LangGraph run。

## 这套方案的作用

这套方案主要解决以下问题：

1. 查看一次面试请求从 BFF 到 Python LangGraph runtime 的完整调用链。
2. 判断 BFF 和 Python runtime 是否处在同一个 trace id 下，确认 trace context 是否正确传播。
3. 分析慢请求，例如面试初始化、问题召回、模型调用、报告生成哪个阶段耗时高。
4. 定位错误发生在哪一层，例如 BFF 代理失败、Python runtime 处理失败、Milvus 检索失败、LLM 调用失败。
5. 在本地用 Grafana Tempo 调试 trace，不依赖外部云服务。
6. 正常使用时也可以接入 LangSmith，观察 LangGraph run tree。

注意：OpenTelemetry span 里只能放运行元数据，不能放候选人简历、JD、回答正文、prompt、模型 response、报告正文、检索 query、embedding 向量或题目原文。

## 关键组件说明

### OpenTelemetry

OpenTelemetry 是统一的埋点和 trace 标准。BFF 和 Python runtime 都会创建 span，并通过 trace context 把一次请求串起来。

常见 span 名称包括：

- `bff.agent.stream_chat`
- `bff.agent.runtime_stream_request`
- `bff.agent.report_status`
- `python_agent.stream_interview_agent`
- `langgraph.invoke_interview_graph`
- `langgraph.node.initialize_session`
- `langgraph.node.process_user_reply`
- `langgraph.node.evaluate_answers`
- `langgraph.node.generate_report`
- `langgraph.node.persist_report`
- `rag.question_retrieval.query`
- `milvus.question_retrieval.search`
- `embedding.create`
- `llm.chat_completion`

### OpenTelemetry Collector

Collector 负责接收 BFF 和 Python runtime 上报的 OTLP trace，再转发给 Tempo。

本项目配置文件：

```text
ops/observability/otel-collector-config.yml
```

本地端口：

```text
OTLP HTTP: http://localhost:4318
OTLP gRPC: localhost:4317
```

### Tempo

Tempo 是 trace 存储。Collector 会把 trace 写入 Tempo，Grafana 再从 Tempo 查询。

本项目配置文件：

```text
ops/observability/tempo.yml
```

本地地址：

```text
http://localhost:3200
```

### Grafana

Grafana 用来可视化查询 Tempo 中的 trace。

本地地址：

```text
http://localhost:3001
```

默认本地账号密码：

```text
admin / admin
```

Tempo datasource 会自动 provision，名称为：

```text
Tempo
```

配置文件：

```text
ops/observability/grafana/provisioning/datasources/datasources.yml
```

### LangSmith

LangSmith 是可选的 LangGraph/LangChain 追踪平台。本项目默认关闭 LangSmith；当你显式设置 `LANGSMITH_TRACING=true` 并提供 API key 后，正常使用流程也会启用完整 LangSmith tracing。

满足以下条件时，Python runtime 会开启完整 LangSmith tracing：

```text
LANGSMITH_TRACING=true
LANGSMITH_API_KEY 已设置
```

完全关闭 LangSmith：

```env
LANGSMITH_TRACING=false
```

## 如何启动本地观测栈

在项目根目录执行：

```powershell
cd G:\project\my-first-agent\my-first-agent
docker compose up -d tempo otel-collector grafana
```

检查容器状态：

```powershell
docker compose ps tempo otel-collector grafana
```

检查 Tempo 是否 ready：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3200/ready
```

正常情况下会看到类似：

```text
ready
```

## 如何启动应用服务

本地开发推荐：

```powershell
npm run start:all
```

它会启动：

- Python LangGraph runtime: `http://localhost:8011`
- BFF: `http://localhost:3000`
- Frontend: `http://localhost:4173`
- 应用依赖：etcd、MinIO、Milvus

如果只想启动应用服务，不启动 Docker 依赖：

```powershell
npm run start:local
```

如果要手动启动三个应用服务，也可以分别执行：

```powershell
cd G:\project\my-first-agent\my-first-agent-langgraph
$env:PYTHONPATH='src'
python -m uvicorn app.main:app --host 0.0.0.0 --port 8011
```

```powershell
cd G:\project\my-first-agent\my-first-agent\bff
$env:AGENT_RUNTIME_PROVIDER='python'
$env:PY_AGENT_BASE_URL='http://localhost:8011'
npm run start:dev
```

```powershell
cd G:\project\my-first-agent\my-first-agent\frontend
npm run dev
```

## 本地环境变量示例

BFF 和 Python runtime 都使用标准 OpenTelemetry 环境变量。

本地推荐全量采样，便于调试：

```env
OTEL_SDK_DISABLED=false
OTEL_SERVICE_NAME=interview-bff
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_PROPAGATORS=tracecontext,baggage
OTEL_TRACES_SAMPLER=always_on
OTEL_TRACES_SAMPLER_ARG=1
```

Python runtime 的 service name 通常是：

```env
OTEL_SERVICE_NAME=interview-python-agent
```

Docker Compose 内部服务之间通信时，OTLP endpoint 使用 collector 容器名：

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

本机直接运行 Node/Python 进程时，使用 localhost：

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## 触发一次 trace：方式一，使用前端

1. 打开前端：

```text
http://localhost:4173
```

2. 上传或输入简历内容。
3. 开始一次面试。
4. 等待页面出现第一轮面试问题。
5. 打开 Grafana 查询 trace。

这种方式最接近真实用户路径，适合验证：

- Frontend 是否能访问 BFF。
- BFF 是否能访问 Python runtime。
- Python runtime 是否能初始化面试。
- 跨服务 trace 是否串起来。

## 触发一次 trace：方式二，直接请求 BFF

如果只想快速生成 trace，可以直接请求 BFF 的 stream API。

```powershell
$threadId = "trace-demo-" + [guid]::NewGuid().ToString("N").Substring(0, 8)

$body = @{
  requestKind = "interview-start"
  protocolVersion = "2026-05-structured-start-v1"
  startInterview = $true
  threadId = $threadId
  resumeMarkdown = @"
# Candidate

## Professional Skills
- Python
- RAG
- OpenTelemetry

## Project Experience
Built a demo interview system with retrieval and tracing.
"@
  jobDescriptionMarkdown = ""
  settings = @{
    reviewIncorrectOrMissingPoints = $true
    skipProfessionalSkillsRound = $false
    skipProjectExperienceRound = $true
    enableFlowTestMode = $true
    professionalQuestionMode = "custom-count"
    professionalQuestionCount = 1
    projectQuestionCount = 0
  }
} | ConvertTo-Json -Depth 8

Invoke-WebRequest `
  -UseBasicParsing `
  -Method Post `
  -Uri http://localhost:3000/api/agents/chat/stream `
  -ContentType "application/json" `
  -Body $body `
  -TimeoutSec 90

$threadId
```

记下输出的 `$threadId`，稍后可以用它在 Grafana 或 Tempo 中查询。

因为 SDK 和 Collector 都有 batch flush，触发请求后建议等待几秒再查询。

## 在 Grafana 中查询 trace

打开：

```text
http://localhost:3001
```

进入：

```text
Explore -> 选择 Tempo datasource
```

### 查询 BFF trace

```traceql
{ resource.service.name = "interview-bff" }
```

### 查询 Python runtime trace

```traceql
{ resource.service.name = "interview-python-agent" }
```

### 通过 thread id 查询

把示例里的 thread id 替换成你自己的：

```traceql
{ .interview.thread_id = "trace-demo-1234abcd" }
```

### 查询错误 span

```traceql
{ status = error }
```

### 查询 BFF stream 入口

```traceql
{ name = "bff.agent.stream_chat" }
```

### 查询 LangGraph 主调用

```traceql
{ name = "langgraph.invoke_interview_graph" }
```

一次正常的面试启动 trace 至少应该看到：

- `bff.agent.stream_chat`
- `bff.agent.runtime_stream_request`
- `python_agent.stream_interview_agent`
- `langgraph.invoke_interview_graph`

并且同一个 trace 中应该同时出现：

- `interview-bff`
- `interview-python-agent`

如果 BFF 和 Python runtime 分成了两个 trace，通常说明 trace context 没有正确传播。

## 直接用 Tempo API 查询

不打开 Grafana，也可以直接查询 Tempo API。

按 thread id 搜索：

```powershell
$threadId = "trace-demo-1234abcd"
$query = [uri]::EscapeDataString('{ .interview.thread_id = "' + $threadId + '" }')
Invoke-WebRequest -UseBasicParsing "http://localhost:3200/api/search?q=$query&limit=20"
```

拿到 trace id 后查询详情：

```powershell
$traceId = "<trace-id-from-search>"
Invoke-WebRequest -UseBasicParsing "http://localhost:3200/api/traces/$traceId"
```

## 如何理解一个 trace

一次完整请求通常可以按这条链路看：

```text
bff.agent.stream_chat
  -> bff.agent.runtime_stream_request
    -> Python FastAPI HTTP server span
      -> python_agent.stream_interview_agent
        -> langgraph.invoke_interview_graph
          -> langgraph.node.initialize_session 或 process_user_reply
            -> rag.question_retrieval.query
              -> milvus.question_retrieval.search
            -> embedding.create
            -> llm.chat_completion
```

如果是报告生成链路，还会看到：

```text
langgraph.node.evaluate_answers
langgraph.node.generate_report
langgraph.node.persist_report
```

排查时可以先看最外层 span 是否报错，再向内展开：

1. BFF span 报错：优先检查 BFF 到 Python runtime 的网络、URL、provider 配置。
2. Python FastAPI span 报错：优先检查请求 schema、runtime 日志、依赖配置。
3. LangGraph span 报错：优先检查 checkpoint、状态机、节点逻辑。
4. Milvus span 报错：优先检查 Milvus 是否启动、collection 是否存在、embedding dimension 是否匹配。
5. LLM span 报错：优先检查模型 provider、API key、base URL、timeout。

## 采样策略怎么用

本地建议全量采样：

```env
APP_ENV=local
OTEL_TRACES_SAMPLER=always_on
OTEL_TRACES_SAMPLER_ARG=1
```

staging 可以使用较高比例采样：

```env
APP_ENV=staging
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.2
```

prod 可以使用更低比例采样：

```env
APP_ENV=prod
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.05
```

BFF 和 Python runtime 应保持相同采样配置。使用 `parentbased_traceidratio` 的好处是：如果上游 BFF 已经决定采样，下游 Python runtime 会跟随这个决定，避免一个请求在两个服务中出现采样不一致。

临时禁用 OpenTelemetry：

```env
OTEL_SDK_DISABLED=true
```

禁用后不会向 Collector 上报 trace。

## LangSmith 使用示例

LangSmith 适合观察 LangGraph run tree，例如本地开发调试图执行过程，也可以在正常使用流程中启用。

启用配置：

```env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=my-first-agent-local
LANGSMITH_DATA_MODE=standard
```

关闭配置：

```env
LANGSMITH_TRACING=false
```

Python runtime 写入 LangSmith metadata 时只允许包含安全元数据，例如：

- `thread_id`
- `runtime_provider`
- `app_env`
- `model_provider`
- `model_name`
- `otel.trace_id`

不要把简历、JD、候选人回答、prompt、response 或报告正文放入 LangSmith metadata。

## 常见问题排查

### Grafana 里没有 trace

检查 OTEL 是否被禁用：

```powershell
echo $env:OTEL_SDK_DISABLED
```

如果是 `true`，就不会上报 trace。

检查 Tempo：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3200/ready
```

检查 Collector 日志：

```powershell
docker compose logs --tail=100 otel-collector
```

检查 Tempo 日志：

```powershell
docker compose logs --tail=100 tempo
```

检查 Grafana datasource：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3001
```

然后登录 Grafana，确认 Explore 里有 `Tempo` datasource。

### Collector 无法写入 Tempo

检查 Tempo 是否 ready：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3200/ready
```

检查 Tempo OTLP receiver 是否监听在容器可访问地址。配置中应使用：

```yaml
endpoint: 0.0.0.0:4317
endpoint: 0.0.0.0:4318
```

不要只监听 `localhost`，因为 Collector 容器无法通过 Tempo 容器内部的 localhost 访问 Tempo receiver。

### BFF 和 Python runtime 不在同一个 trace

重点检查：

```env
OTEL_PROPAGATORS=tracecontext,baggage
```

同时检查：

1. BFF fetch/undici instrumentation 是否启用。
2. Python FastAPI instrumentation 是否在 app 创建后立即接入。
3. BFF 请求 Python runtime 时是否带了 `traceparent` header。
4. BFF 和 Python runtime 是否都没有设置 `OTEL_SDK_DISABLED=true`。

### 只看到 BFF span，看不到 Python span

检查 Python runtime 是否配置了 OTLP endpoint：

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

如果 Python runtime 在 Docker Compose 里运行，应使用：

```env
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

再检查 Python runtime 健康状态：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8011/health
```

### SSE 请求 span 时间很长

这是正常现象。SSE HTTP server span 会覆盖整个流式连接生命周期。

如果要看实际业务耗时，应优先看这些子 span：

- `bff.agent.runtime_stream_request`
- `python_agent.stream_interview_agent`
- `langgraph.invoke_interview_graph`
- `langgraph.node.*`

### LangSmith 没有 run

检查：

```env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=my-first-agent-local
LANGSMITH_DATA_MODE=standard
```

如果仍然没有 run，检查 Python 日志里是否有 LangSmith 初始化或网络错误。

## 推荐验证流程

新开发者可以按这个顺序验证：

1. 启动观测栈：

```powershell
docker compose up -d tempo otel-collector grafana
```

2. 启动应用：

```powershell
npm run start:all
```

3. 检查健康状态：

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3200/ready
Invoke-WebRequest -UseBasicParsing http://localhost:8011/health
Invoke-WebRequest -UseBasicParsing http://localhost:3000
Invoke-WebRequest -UseBasicParsing http://localhost:4173
```

4. 通过前端开始一次面试，或用上文 BFF 示例触发一次 trace。
5. 打开 Grafana：

```text
http://localhost:3001
```

6. 在 Explore 中选择 `Tempo`。
7. 查询：

```traceql
{ resource.service.name = "interview-bff" }
```

8. 再用 thread id 查询：

```traceql
{ .interview.thread_id = "trace-demo-1234abcd" }
```

9. 展开 trace，确认同一个 trace 中同时包含：

- `interview-bff`
- `interview-python-agent`
- `bff.agent.stream_chat`
- `python_agent.stream_interview_agent`
- `langgraph.invoke_interview_graph`

## 相关文件

Host repo：

```text
G:\project\my-first-agent\my-first-agent\docker-compose.yml
G:\project\my-first-agent\my-first-agent\.env.example
G:\project\my-first-agent\my-first-agent\bff\src\telemetry.ts
G:\project\my-first-agent\my-first-agent\bff\src\modules\agent\agent.service.ts
G:\project\my-first-agent\my-first-agent\ops\observability\otel-collector-config.yml
G:\project\my-first-agent\my-first-agent\ops\observability\tempo.yml
G:\project\my-first-agent\my-first-agent\ops\observability\grafana\provisioning\datasources\datasources.yml
G:\project\my-first-agent\my-first-agent\docs\observability.md
```

Python LangGraph runtime：

```text
G:\project\my-first-agent\my-first-agent-langgraph\.env.example
G:\project\my-first-agent\my-first-agent-langgraph\src\app\telemetry.py
G:\project\my-first-agent\my-first-agent-langgraph\src\app\main.py
G:\project\my-first-agent\my-first-agent-langgraph\src\app\langsmith_tracing.py
G:\project\my-first-agent\my-first-agent-langgraph\src\app\graphs\interview_graph.py
G:\project\my-first-agent\my-first-agent-langgraph\src\app\integrations\models.py
G:\project\my-first-agent\my-first-agent-langgraph\src\app\integrations\embeddings.py
G:\project\my-first-agent\my-first-agent-langgraph\src\app\integrations\milvus_store.py
```

## 一句话总结

本项目的可观测性方案用于把一次面试请求从 BFF 到 Python LangGraph runtime 的执行过程串成同一个 trace，并通过 Grafana Tempo 在本地查询、分析和排错；LangSmith 是可选的 LangGraph run 观察工具，显式开启并提供 API key 后正常使用流程也会进入 LangSmith。

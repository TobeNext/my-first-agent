# OpenTelemetry + Tempo + Grafana + LangSmith Observability Plan

## 背景

当前仓库是 interview system 的 frontend/BFF host，默认运行时已经切到 sibling Python LangGraph 项目：

- Frontend: `frontend/`
- BFF: `bff/`, NestJS, 入口 `bff/src/main.ts`
- 默认 runtime: `../my-first-agent-langgraph`, FastAPI + LangGraph, 入口 `../my-first-agent-langgraph/src/app/main.py`
- rollback runtime: `src/mastra/**`
- 本地依赖: `docker-compose.yml` 中已有 Redis、Milvus、Mastra、Python runtime、BFF、Frontend

目标是实现可查看分布式系统全链路调用：

- 记录每个服务的入口接口、下游调用接口、耗时、状态码、错误。
- 能从一次面试请求追踪到 BFF、Python LangGraph runtime、Redis、Milvus、LLM/embedding 调用。
- 能在 Grafana 里查看系统级 trace，在 LangSmith 里查看 LangGraph/LLM 级 run trace。
- 对 Mastra rollback provider 保持兼容，但第一阶段不主动改造 Mastra runtime。

## 方案结论

采用：

```text
OpenTelemetry SDK
  -> OpenTelemetry Collector
  -> Grafana Tempo
  -> Grafana

LangGraph runtime
  -> LangSmith
```

分工：

- OpenTelemetry 负责跨服务 trace、span、耗时、错误、上下文传播。
- Collector 负责统一接收 OTLP 并转发给 Tempo。
- Tempo 负责 trace 存储和查询。
- Grafana 负责可视化 trace、service graph、trace/log 跳转入口。
- LangSmith 负责 LangGraph 节点、LLM 调用、prompt、token、run tree 等 AI 级可观测性。

参考官方资料：

- OpenTelemetry traces: https://opentelemetry.io/docs/concepts/signals/traces/
- OpenTelemetry context propagation: https://opentelemetry.io/docs/concepts/context-propagation/
- OpenTelemetry JavaScript getting started: https://opentelemetry.io/docs/languages/js/getting-started/nodejs/
- OpenTelemetry Python FastAPI instrumentation: https://opentelemetry-python-contrib.readthedocs.io/en/latest/instrumentation/fastapi/fastapi.html
- OpenTelemetry Collector: https://opentelemetry.io/docs/collector/
- Grafana Tempo: https://grafana.com/docs/tempo/latest/
- Grafana Tempo with OpenTelemetry Collector: https://grafana.com/docs/tempo/latest/configuration/grafana-agent/
- LangSmith observability: https://docs.langchain.com/langsmith/observability
- LangGraph observability: https://docs.langchain.com/oss/python/langgraph/observability

## 目标架构

```text
Browser
  |
  | HTTP/SSE
  v
Frontend
  |
  | HTTP POST /api/agents/chat/stream
  v
BFF NestJS
  |  spans:
  |  - HTTP server span
  |  - runtime proxy span
  |  - fetch python-agent span
  |
  | W3C traceparent header
  v
Python FastAPI LangGraph runtime
  |  spans:
  |  - HTTP server span
  |  - invoke_interview_graph span
  |  - LangGraph node spans
  |  - Redis spans
  |  - Milvus retrieval spans
  |  - model/embedding spans
  |
  +---------------------------> LangSmith
  |
  | OTLP
  v
OpenTelemetry Collector
  |
  v
Tempo
  |
  v
Grafana
```

## Trace 字段约定

所有服务统一设置：

- `service.name`
  - `interview-frontend`
  - `interview-bff`
  - `interview-python-agent`
  - `interview-mastra-runtime`，仅 rollback provider 后续接入时使用
- `deployment.environment`
  - 本地默认 `local`
  - Docker 默认 `docker`
  - 生产按部署环境设置
- `service.version`
  - 优先使用 package/version 或 git sha

业务 attributes：

- `interview.thread_id`
- `interview.runtime_provider`: `python` 或 `mastra`
- `interview.protocol`: `structured-start-v1` 或 `reply`
- `interview.start_interview`: `true` 或 `false`
- `interview.flow_test_mode`
- `interview.has_job_description`
- `interview.professional_question_count`
- `llm.provider`
- `llm.model`
- `rag.vector_store`: `milvus`
- `rag.collection`

注意：

- 不把完整简历、JD、面试回答、prompt、LLM response 放入 OpenTelemetry span attributes。
- LangSmith 可按项目安全策略记录 LLM/prompt 细节；生产环境需要通过 LangSmith masking/redaction 或采样控制敏感数据。

## Phase 0: 观测栈落地

### 0.1 新增 Collector 配置

新增文件：

- `ops/observability/otel-collector-config.yml`

建议配置：

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch: {}
  memory_limiter:
    check_interval: 1s
    limit_mib: 256

exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls:
      insecure: true
  debug:
    verbosity: basic

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/tempo, debug]
```

执行后自验收：

- `ops/observability/otel-collector-config.yml` 存在且 YAML 可被 Collector 解析。
- Collector 日志显示 OTLP receiver 已监听 `4317` 和 `4318`。
- Collector 日志中没有 exporter 连接 Tempo 的持续错误。

### 0.2 新增 Tempo 配置

新增文件：

- `ops/observability/tempo.yml`

本地优先用 local backend，避免引入对象存储：

```yaml
server:
  http_listen_port: 3200

distributor:
  receivers:
    otlp:
      protocols:
        grpc:
        http:

storage:
  trace:
    backend: local
    local:
      path: /tmp/tempo/traces

compactor:
  compaction:
    block_retention: 24h
```

执行后自验收：

- `ops/observability/tempo.yml` 存在且 Tempo 容器能成功启动。
- `http://localhost:3200/ready` 返回 ready，或 Tempo 日志显示服务已就绪。
- Tempo 日志中没有 storage/backend 配置错误。

### 0.3 新增 Grafana datasource provisioning

新增文件：

- `ops/observability/grafana/provisioning/datasources/datasources.yml`

建议配置：

```yaml
apiVersion: 1

datasources:
  - name: Tempo
    type: tempo
    access: proxy
    url: http://tempo:3200
    isDefault: true
    jsonData:
      tracesToLogsV2:
        datasourceUid: logs
      serviceMap:
        datasourceUid: prometheus
```

第一阶段没有 Prometheus/Loki 也可以先保留 Tempo datasource，后续再补 metrics/logs。

执行后自验收：

- Grafana 启动后 datasource 列表中存在 `Tempo`。
- `Tempo` datasource 的 URL 指向 `http://tempo:3200`。
- 在 Grafana Explore 中选择 `Tempo` 不报 datasource 初始化错误。

### 0.4 修改 docker-compose

在 `docker-compose.yml` 新增 services：

- `otel-collector`
- `tempo`
- `grafana`

建议端口：

- Collector OTLP gRPC: `4317:4317`
- Collector OTLP HTTP: `4318:4318`
- Tempo HTTP: `3200:3200`
- Grafana UI: `3001:3000`

新增 volumes：

- `tempo-data`
- `grafana-data`

给 `bff` 和 `python-agent` 增加环境变量：

```yaml
OTEL_SERVICE_NAME: interview-bff
OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
OTEL_TRACES_EXPORTER: otlp
OTEL_PROPAGATORS: tracecontext,baggage
OTEL_RESOURCE_ATTRIBUTES: deployment.environment=docker
```

Python runtime：

```yaml
OTEL_SERVICE_NAME: interview-python-agent
OTEL_EXPORTER_OTLP_ENDPOINT: http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
OTEL_TRACES_EXPORTER: otlp
OTEL_PROPAGATORS: tracecontext,baggage
OTEL_RESOURCE_ATTRIBUTES: deployment.environment=docker
LANGSMITH_TRACING: ${LANGSMITH_TRACING:-false}
LANGSMITH_API_KEY: ${LANGSMITH_API_KEY:-}
LANGSMITH_PROJECT: ${LANGSMITH_PROJECT:-my-first-agent-local}
```

执行后自验收：

- `docker compose config` 能成功渲染，不出现 YAML 或变量解析错误。
- `otel-collector`、`tempo`、`grafana` 三个 service 存在于渲染后的 compose 配置中。
- `bff` 和 `python-agent` 容器环境变量中包含 OTEL 配置，`python-agent` 还包含 LangSmith 配置。
- `docker compose up` 后 Grafana、Tempo、Collector 端口可访问。

### 0.5 更新 env 模板

更新本仓库 `.env.example`：

```dotenv
# OpenTelemetry
OTEL_SERVICE_NAME=interview-bff
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_PROPAGATORS=tracecontext,baggage
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=local

# LangSmith, only used by Python LangGraph runtime
LANGSMITH_TRACING=false
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=my-first-agent-local
```

更新 sibling repo `../my-first-agent-langgraph/.env.example`：

```dotenv
OTEL_SERVICE_NAME=interview-python-agent
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_TRACES_EXPORTER=otlp
OTEL_PROPAGATORS=tracecontext,baggage
OTEL_RESOURCE_ATTRIBUTES=deployment.environment=local

LANGSMITH_TRACING=false
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=my-first-agent-local
```

执行后自验收：

- 根 `.env.example` 包含 BFF 本地 OTEL 默认值和 LangSmith 占位变量。
- `../my-first-agent-langgraph/.env.example` 包含 Python runtime 本地 OTEL 默认值和 LangSmith 占位变量。
- 默认模板中 `LANGSMITH_TRACING=false`，无 API key 时不会要求连接 LangSmith。

## Phase 1: BFF OpenTelemetry 接入

### 1.1 安装依赖

在 `bff/package.json` 增加依赖：

```json
{
  "dependencies": {
    "@opentelemetry/api": "latest",
    "@opentelemetry/auto-instrumentations-node": "latest",
    "@opentelemetry/exporter-trace-otlp-http": "latest",
    "@opentelemetry/resources": "latest",
    "@opentelemetry/sdk-node": "latest",
    "@opentelemetry/semantic-conventions": "latest"
  }
}
```

版本落地时用 npm lock 固化，不在计划中硬编码具体版本。

执行后自验收：

- `npm --prefix bff install` 或等价依赖安装成功。
- `bff/package-lock.json` 中包含新增 OpenTelemetry 包。
- `npm --prefix bff run build` 不因新增依赖产生 TypeScript/module resolution 错误。

### 1.2 新增 telemetry bootstrap

新增文件：

- `bff/src/telemetry.ts`

职责：

- 在 Nest app 初始化前启动 NodeSDK。
- 使用 OTLP HTTP exporter。
- 启用 HTTP/fetch 自动 instrumentation。
- 设置 `service.name`、`deployment.environment`。
- 支持 `OTEL_SDK_DISABLED=true` 本地关闭。

执行后自验收：

- `bff/src/telemetry.ts` 存在，且只负责 telemetry 初始化，不启动 Nest app。
- 设置 `OTEL_SDK_DISABLED=true` 时 BFF 能正常启动且不尝试连接 Collector。
- 未关闭 telemetry 时，BFF 启动日志或 Collector debug exporter 能看到 `interview-bff` spans。

### 1.3 修改 BFF 启动顺序

修改：

- `bff/src/main.ts`

第一行引入 telemetry：

```ts
import './telemetry';
```

确保 OpenTelemetry 在 Nest、HTTP、fetch 被加载前初始化。

执行后自验收：

- `bff/src/main.ts` 中 `import './telemetry';` 位于其他会加载 HTTP/Nest runtime 的 import 之前。
- `npm --prefix bff run build` 成功。
- BFF health 或任意 API 请求能生成 HTTP server span。

### 1.4 给业务链路增加手动 span

修改：

- `bff/src/modules/agent/agent.service.ts`

在 `streamChat` 中增加手动 span：

- span name: `bff.agent.stream_chat`
- attributes:
  - `interview.thread_id`
  - `interview.runtime_provider`
  - `interview.protocol`
  - `interview.start_interview`
  - `interview.flow_test_mode`
  - `interview.has_job_description`
  - `interview.professional_question_count`

在调用 runtime 的 fetch 周围增加 child span：

- span name: `bff.agent.runtime_stream_request`
- attributes:
  - `http.request.method=POST`
  - `server.address`
  - `url.path=/api/agents/interview-agent/stream`
  - `interview.runtime_provider`

错误处理：

- catch 网络错误时 `recordException(error)`。
- upstream 非 2xx 时设置 span status `ERROR`，记录 status code。

执行后自验收：

- 执行一次面试 stream 请求后，Tempo 中能看到 `bff.agent.stream_chat` span。
- span attributes 中能看到 `interview.thread_id` 和 `interview.runtime_provider`。
- 模拟 runtime 不可达时，相关 span status 为 `ERROR`，并包含 exception event 或错误信息。
- SSE 正常返回，不因 span 包裹破坏流式输出。

### 1.5 上下文传播

Node HTTP/fetch instrumentation 应自动把 `traceparent` 注入下游请求。

验收时需要确认：

- BFF 收到 frontend 请求产生 root/server span。
- BFF 调 Python runtime 的 client span 和 Python FastAPI server span 在同一 trace 下。
- 如果自动 fetch instrumentation 没有覆盖当前 Node 版本，则在 `agent.service.ts` 中使用 `propagation.inject(context.active(), headersCarrier)` 手动注入 `traceparent`。

执行后自验收：

- BFF 到 Python runtime 的请求 headers 中包含 `traceparent`。
- Tempo 中 BFF client span 和 Python FastAPI server span 拥有相同 trace id。
- 如果自动传播失败，手动注入实现后再次验证同 trace id 成立。

## Phase 2: Python LangGraph runtime OpenTelemetry 接入

### 2.1 安装依赖

修改 sibling repo：

- `../my-first-agent-langgraph/pyproject.toml`

新增依赖：

```toml
"opentelemetry-api>=1.0.0",
"opentelemetry-sdk>=1.0.0",
"opentelemetry-exporter-otlp-proto-http>=1.0.0",
"opentelemetry-instrumentation-fastapi>=0.0.0",
"opentelemetry-instrumentation-requests>=0.0.0",
"opentelemetry-instrumentation-redis>=0.0.0",
```

实际版本由 lock 文件固化。若项目使用 `uv`/pip-tools 生成 `requirements.lock`，需要同步更新 lock。

执行后自验收：

- `../my-first-agent-langgraph/pyproject.toml` 和 lock 文件都包含新增 OpenTelemetry 依赖。
- `cd ../my-first-agent-langgraph && python -m pytest tests/test_health.py` 成功。
- Python runtime 镜像或本地环境能 import 新增 OpenTelemetry 包。

### 2.2 新增 telemetry bootstrap

新增文件：

- `../my-first-agent-langgraph/src/app/telemetry.py`

职责：

- 初始化 TracerProvider。
- 设置 resource:
  - `service.name=interview-python-agent`
  - `deployment.environment`
- 配置 OTLP HTTP exporter。
- 配置 BatchSpanProcessor。
- 支持 `OTEL_SDK_DISABLED=true`。
- 暴露 `instrument_fastapi(app: FastAPI) -> None`。

执行后自验收：

- `../my-first-agent-langgraph/src/app/telemetry.py` 存在，且没有在 import 时执行不可恢复的网络请求。
- `OTEL_SDK_DISABLED=true` 时 FastAPI app 可以正常启动。
- telemetry 开启时 Collector 能收到 `interview-python-agent` spans。

### 2.3 修改 FastAPI 入口

修改：

- `../my-first-agent-langgraph/src/app/main.py`

在创建 app 后：

```py
from app.telemetry import instrument_fastapi

app = FastAPI(...)
instrument_fastapi(app)
```

执行后自验收：

- `../my-first-agent-langgraph/src/app/main.py` 在创建 FastAPI app 后调用 `instrument_fastapi(app)`。
- `/health` 请求能生成 FastAPI HTTP server span。
- 现有 `/api/agents/interview-agent/stream` SSE 行为不变。

### 2.4 给 LangGraph 主流程增加 span

修改：

- `../my-first-agent-langgraph/src/app/main.py`
- `../my-first-agent-langgraph/src/app/graphs/interview_graph.py`
- `../my-first-agent-langgraph/src/app/graphs/nodes/*.py`

最低可行范围：

- `stream_interview_agent`
  - span name: `python_agent.stream_interview_agent`
  - attributes:
    - `interview.thread_id`
    - `interview.protocol`
- `invoke_interview_graph`
  - span name: `langgraph.invoke_interview_graph`
- 关键节点：
  - `langgraph.node.initialize_interview`
  - `langgraph.node.retrieve_questions`
  - `langgraph.node.generate_question`
  - `langgraph.node.process_user_reply`
  - `langgraph.node.generate_final_report`

对 Redis/Milvus/LLM 调用建议加显式 span：

- `redis.answer_evaluation.enqueue`
- `redis.answer_evaluation.read`
- `milvus.question_retrieval.search`
- `llm.chat_completion`
- `embedding.create`

执行后自验收：

- 一次 start interview 请求在 Tempo 中包含 `langgraph.invoke_interview_graph` span。
- 至少一个关键 LangGraph node span 出现在该 trace 下。
- 关键节点异常时 span status 为 `ERROR`，并记录 exception。
- 单元测试和短流程集成测试仍通过。

### 2.5 Milvus 和模型调用的 span attributes

修改：

- `../my-first-agent-langgraph/src/app/integrations/milvus_store.py`
- `../my-first-agent-langgraph/src/app/integrations/models.py`
- `../my-first-agent-langgraph/src/app/integrations/embeddings.py`

建议 attributes：

- Milvus:
  - `db.system=milvus`
  - `db.operation=search`
  - `rag.collection`
  - `rag.top_k`
  - `rag.result_count`
- LLM:
  - `llm.provider`
  - `llm.model`
  - `llm.temperature`
  - `llm.timeout_seconds`
  - `llm.max_retries`
  - 不记录 prompt/response 原文
- Embedding:
  - `embedding.provider`
  - `embedding.model`
  - `embedding.dimension`

执行后自验收：

- 触发 RAG 后，Tempo 中出现 `milvus.question_retrieval.search` span，且包含 collection/top_k/result_count 等非敏感 attributes。
- 触发模型调用后，Tempo 中出现 `llm.chat_completion` span，且包含 provider/model/timeout 等 metadata。
- 抽查 span attributes，确认没有完整简历、JD、用户回答、prompt 或 LLM response 原文。

## Phase 3: LangSmith 接入

### 3.1 环境变量

在 `../my-first-agent-langgraph/.env.example` 和根 `.env.example` 中补充：

```dotenv
LANGSMITH_TRACING=false
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=my-first-agent-local
```

Docker Compose 中把这些变量传给 `python-agent`。

执行后自验收：

- 根 `.env.example`、Python runtime `.env.example` 和 `docker-compose.yml` 中 LangSmith 变量一致。
- 默认 `LANGSMITH_TRACING=false` 时无 API key 也能启动。
- 设置 `LANGSMITH_TRACING=true` 且提供 key 后，Python runtime 进程能读取对应变量。

### 3.2 LangGraph tracing

LangGraph/LangChain 通常通过环境变量启用 LangSmith tracing。实现时优先遵循当前安装版本官方文档，不在业务代码里强绑 SDK。

最低目标：

- 本地默认 `LANGSMITH_TRACING=false`，避免无 key 时启动失败。
- 设置 `LANGSMITH_TRACING=true` 且提供 `LANGSMITH_API_KEY` 后，LangSmith 项目中能看到每次 interview graph run。
- LangSmith run metadata 包含：
  - `thread_id`
  - `runtime_provider=python`
  - `app_env`
  - `model_provider`
  - `model_name`

执行后自验收：

- 开启 LangSmith 后，一次面试请求在指定 `LANGSMITH_PROJECT` 中产生 run。
- LangSmith run 中可以看到 LangGraph/LLM 的 run tree。
- run metadata 包含 `thread_id`、`runtime_provider=python`、`model_provider`、`model_name`。
- LangSmith 写入失败时业务请求不失败，只记录 warning 或 telemetry 错误。

### 3.3 隐私策略

默认策略：

- local/dev 可以完整打开 LangSmith，用于调试。
- shared/staging/prod 需要确认简历、JD、用户回答是否允许出现在 LangSmith。
- 若不允许，需要启用 LangSmith masking/redaction 或只保留 metadata。

执行后自验收：

- 文档明确说明 local/dev 与 shared/staging/prod 的 LangSmith 开关策略。
- 若生产或共享环境启用 LangSmith，必须有 masking/redaction 或明确的数据授权记录。
- 抽查一次 LangSmith run，确认记录内容符合当前环境的数据策略。

## Phase 4: Frontend trace 关联

第一阶段不强制在 browser 端接入 OpenTelemetry，因为当前主要诉求是“服务间调用接口和时间”，BFF 已能作为服务端 trace 起点。

后续可选：

- 在 `frontend/src/services/bff-api.ts` 或 fetch 封装中生成 `x-request-id`。
- BFF 把 `x-request-id` 写入 span attributes。
- 若需要 browser performance trace，再引入 OpenTelemetry Web SDK，但要先评估体积、采样、隐私。

执行后自验收：

- 第一阶段实施完成时，确认 frontend 代码没有引入新的 browser telemetry 依赖。
- 若后续增加 `x-request-id`，BFF span attributes 中能按该 ID 查询请求。
- 若后续启用 OpenTelemetry Web SDK，需验证 bundle size、采样率、隐私策略，并确认页面交互不受影响。

## Phase 5: Mastra rollback provider 策略

按仓库约束，新 runtime 功能优先落到 LangGraph repo。Mastra 只保持 rollback provider 可用。

第一阶段：

- 不改 `src/mastra/**`。
- BFF span 中记录 `interview.runtime_provider=mastra`。
- 如果用户切到 `npm run start:local:mastra`，至少能看到 BFF 到 Mastra 的 HTTP client span。

第二阶段，只有当 rollback provider 需要同等级观测时再做：

- 查当前安装的 `@mastra/observability` 和 Mastra embedded docs。
- 在 `src/mastra/index.ts` 中接入 Mastra 官方当前版本支持的 observability/exporter。
- 不凭旧 API 改 Mastra 代码。

执行后自验收：

- 第一阶段完成后，`src/mastra/**` 无非必要修改。
- 使用 `npm run start:local:mastra` 时，Tempo 至少能看到 BFF 到 Mastra runtime 的 HTTP client span。
- 如果后续改 Mastra，提交中必须包含当时 Mastra embedded docs 或官方 docs 的核对记录，并通过 rollback smoke test。

## Phase 6: 验收标准

### 6.1 本地启动

命令：

```bash
npm run start:all
```

预期：

- Frontend: http://localhost:8080
- BFF: http://localhost:3000
- Python runtime: http://localhost:8011/health
- Grafana: http://localhost:3001
- Tempo: http://localhost:3200
- Collector:
  - OTLP HTTP: http://localhost:4318
  - OTLP gRPC: localhost:4317

### 6.2 Trace 验收

在前端完成一次 start interview 请求后，Grafana Tempo 中应能看到一条 trace，包含：

- `interview-bff` HTTP server span
- `bff.agent.stream_chat`
- `bff.agent.runtime_stream_request`
- `interview-python-agent` FastAPI server span
- `python_agent.stream_interview_agent`
- `langgraph.invoke_interview_graph`
- 至少一个 LangGraph node span
- 若触发 RAG，包含 `milvus.question_retrieval.search`
- 若触发 LLM，包含 `llm.chat_completion`
- 如果发生错误，span status 为 `ERROR`，并有 exception event

### 6.3 Context propagation 验收

确认以下两个 span 在同一个 trace id 下：

- BFF 调用 `http://python-agent:8011/api/agents/interview-agent/stream` 的 client span
- Python runtime 接收 `/api/agents/interview-agent/stream` 的 server span

如果不是同一 trace：

1. 检查 BFF fetch instrumentation 是否注入 `traceparent`。
2. 检查 FastAPI instrumentation 是否提取 `traceparent`。
3. 必要时在 BFF 手动注入 headers。

### 6.4 LangSmith 验收

设置：

```dotenv
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=<real-key>
LANGSMITH_PROJECT=my-first-agent-local
```

运行一次面试流程后：

- LangSmith 项目中出现 graph run。
- run tree 能看到 LangGraph 节点或 LangChain model 调用。
- metadata 中可检索 `thread_id`。
- 不应因为 LangSmith 网络失败导致 interview runtime 请求失败；失败只记录 warning。

### 6.5 测试验收

本仓库：

```bash
npm --prefix bff run test
npm run test:e2e:interview:smoke:python
```

Sibling Python repo：

```bash
cd ../my-first-agent-langgraph
pytest
```

新增/调整测试建议：

- BFF unit test: telemetry disabled 时业务逻辑不变。
- BFF unit test: runtime fetch 保留原有 headers 和 SSE 行为。
- Python unit test: telemetry disabled 时 FastAPI app 正常启动。
- Python integration smoke: 打开 telemetry 环境变量后 `/health` 和 stream endpoint 正常返回。

## Phase 7: 实施顺序

建议按以下 PR/提交拆分：

1. `observability-stack`
   - 新增 `ops/observability/**`
   - 修改 `docker-compose.yml`
   - 修改 `.env.example`
   - 验证 Grafana/Tempo/Collector 可启动
   - 执行后自验收：`docker compose config` 成功，`docker compose up` 后 Grafana/Tempo/Collector 健康，Grafana Explore 可选择 Tempo datasource。

2. `bff-otel`
   - 修改 `bff/package.json`
   - 新增 `bff/src/telemetry.ts`
   - 修改 `bff/src/main.ts`
   - 修改 `bff/src/modules/agent/agent.service.ts`
   - 验证 BFF spans 进入 Tempo
   - 执行后自验收：`npm --prefix bff run build` 和 `npm --prefix bff run test` 成功，一次 BFF API 请求能在 Tempo 查询到 `interview-bff` span。

3. `python-agent-otel`
   - 修改 sibling repo `pyproject.toml` 和 lock
   - 新增 `src/app/telemetry.py`
   - 修改 `src/app/main.py`
   - 给 graph、Redis、Milvus、LLM 关键路径加 span
   - 验证跨服务同 trace id
   - 执行后自验收：`cd ../my-first-agent-langgraph && pytest` 成功，一次面试请求能在同一个 trace id 下看到 BFF 和 Python runtime spans。

4. `langsmith`
   - 增加 LangSmith env
   - 给 graph run 写 metadata
   - 验证 LangSmith run tree
   - 执行后自验收：开启 `LANGSMITH_TRACING=true` 后 LangSmith 项目出现 run tree，关闭或缺少 key 时本地流程仍正常。

5. `observability-docs`
   - 更新 README 或 `docs/`，记录如何启动和如何在 Grafana/LangSmith 查询
   - 补 troubleshooting
   - 执行后自验收：文档能指导新开发者从零启动 stack、触发一次 trace、在 Grafana 和 LangSmith 中找到对应记录，并覆盖常见无 trace/不同 trace id/无 LangSmith run 的排障路径。

## Phase 8: Grafana 查询与排障手册

### 常用 Grafana TraceQL

按 service 查询：

```text
{ resource.service.name = "interview-bff" }
```

按 thread id 查询：

```text
{ span.interview.thread_id = "<thread-id>" }
```

查错误：

```text
{ status = error }
```

查 Python runtime：

```text
{ resource.service.name = "interview-python-agent" }
```

### 常见问题

没有 trace：

- 检查 `OTEL_SDK_DISABLED` 是否为 `true`。
- 检查 app 容器是否能访问 `http://otel-collector:4318`。
- 检查 Collector 日志是否收到 OTLP 请求。
- 检查 Tempo datasource 是否已在 Grafana 配好。

BFF 和 Python 不在同一 trace：

- 检查 BFF 到 Python 的请求是否有 `traceparent` header。
- 检查 FastAPI instrumentation 是否在 route 注册前完成。
- 检查 `OTEL_PROPAGATORS=tracecontext,baggage`。

LangSmith 没有 run：

- 检查 `LANGSMITH_TRACING=true`。
- 检查 `LANGSMITH_API_KEY`。
- 检查 `LANGSMITH_PROJECT` 是否看错项目。
- 检查当前 LangGraph/LangChain 版本的 tracing 环境变量名称。

SSE trace 时间过长：

- 这是正常现象，SSE endpoint span 会覆盖整个流式连接生命周期。
- 若需要区分“上游生成耗时”和“客户端连接保持耗时”，在 BFF 和 Python 内部分别增加 child span：
  - `runtime.first_token_latency`
  - `runtime.stream_write_duration`
  - `runtime.graph_execution_duration`

## 风险与控制

### 性能开销

风险：

- 全量 tracing 会增加 CPU、内存、网络开销。

控制：

- 本地/开发全量采样。
- staging/prod 使用 parent-based trace id ratio sampler，例如 5% 到 20%。
- Collector 使用 batch processor。

### 隐私泄露

风险：

- 简历、JD、回答、prompt、response 进入外部系统。

控制：

- OpenTelemetry span 只记录结构化 metadata，不记录正文。
- LangSmith 默认关闭。
- 开启 LangSmith 前确认数据策略。
- 必要时实现 masking/redaction。

### SSE span 生命周期

风险：

- `/stream` 请求 span 持续时间包含客户端连接时间，容易误读为模型慢。

控制：

- 额外记录 graph execution、first token、upstream fetch、stream pipe 等 child spans。

### 多 provider 迁移期

风险：

- Python 和 Mastra provider span 覆盖程度不同。

控制：

- 第一阶段以 BFF 记录 provider 差异。
- Mastra 只在 rollback 需要时补齐。

## DoD

完成后应满足：

- `npm run start:all` 可以启动完整本地 observability stack。
- Grafana `http://localhost:3001` 可以查询 Tempo trace。
- 一次前端面试请求可以看到跨 BFF 和 Python runtime 的同一条 trace。
- trace 中能定位每个关键服务接口和耗时。
- Python LangGraph runtime 可以在启用 LangSmith 后生成 LangSmith run。
- 默认无 LangSmith key 时系统仍可正常本地启动。
- 敏感正文不会进入 OpenTelemetry span attributes。

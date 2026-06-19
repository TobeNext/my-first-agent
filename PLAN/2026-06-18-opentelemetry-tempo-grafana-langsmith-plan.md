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
- Grafana Tempo configuration: https://grafana.com/docs/tempo/latest/configuration/
- Grafana Tempo OTLP receiver: https://grafana.com/docs/tempo/latest/configuration/#distributor
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
```

第一阶段只配置 Tempo datasource，不配置 `tracesToLogsV2` 或 `serviceMap`，因为当前计划没有同时引入 Loki、Prometheus 或 Tempo metrics-generator。后续如果需要 logs 跳转或 service graph，应单独增加 metrics/logs phase，并在引入对应数据源后再启用这些 Grafana 配置。

执行后自验收：

- Grafana 启动后 datasource 列表中存在 `Tempo`。
- `Tempo` datasource 的 URL 指向 `http://tempo:3200`。
- 在 Grafana Explore 中选择 `Tempo` 不报 datasource 初始化错误。
- Grafana datasource provisioning 中不引用尚未配置的 `logs` 或 `prometheus` datasource。

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

OTLP endpoint 约定：

- 优先让 JS/Python SDK 从环境变量读取 `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`，不要在代码里重复手动拼接 exporter URL。
- 如果某个 SDK 必须显式传入 trace exporter URL，则使用 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://otel-collector:4318/v1/traces`，避免把 base endpoint 误当成 traces endpoint。
- BFF 和 Python runtime 必须使用同一套 endpoint 约定，不能一个使用 base endpoint、另一个使用 `/v1/traces` 硬编码。

执行后自验收：

- `docker compose config` 能成功渲染，不出现 YAML 或变量解析错误。
- `otel-collector`、`tempo`、`grafana` 三个 service 存在于渲染后的 compose 配置中。
- `bff` 和 `python-agent` 容器环境变量中包含 OTEL 配置，`python-agent` 还包含 LangSmith 配置。
- `docker compose up` 后 Grafana、Tempo、Collector 端口可访问。
- BFF 和 Python runtime 的 OTLP endpoint 配置遵循同一约定：要么都让 SDK 读取 base endpoint，要么都使用明确的 traces endpoint。

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

实现要求：

- 手动 span 必须成为 runtime fetch 和关键 SSE pipe 逻辑的 active context，例如使用 `context.with(trace.setSpan(context.active(), span), async () => { ... })`。
- 避免只 `startSpan()` 后手动 `end()`，否则自动生成的 fetch client span 可能不会挂在 `bff.agent.stream_chat` 下面。

执行后自验收：

- 执行一次面试 stream 请求后，Tempo 中能看到 `bff.agent.stream_chat` span。
- span attributes 中能看到 `interview.thread_id` 和 `interview.runtime_provider`。
- `bff.agent.runtime_stream_request` 或自动生成的 runtime HTTP client span 是 `bff.agent.stream_chat` 的 child span。
- 模拟 runtime 不可达时，相关 span status 为 `ERROR`，并包含 exception event 或错误信息。
- SSE 正常返回，不因 span 包裹破坏流式输出。

### 1.5 上下文传播

Node HTTP/fetch instrumentation 可能自动把 `traceparent` 注入下游请求，但当前 BFF 使用 Node 22 global `fetch`，底层实现依赖 undici。实施时必须核对当前安装版本是否启用了 undici/fetch instrumentation，不能只依赖普通 HTTP instrumentation 的假设。

验收时需要确认：

- BFF 收到 frontend 请求产生 root/server span。
- BFF 调 Python runtime 的 client span 和 Python FastAPI server span 在同一 trace 下。
- 如果自动 fetch/undici instrumentation 没有覆盖当前 Node 版本，则在 `agent.service.ts` 中使用 `propagation.inject(context.active(), headersCarrier)` 手动注入 `traceparent`。

执行后自验收：

- BFF 到 Python runtime 的请求 headers 中包含 `traceparent`。
- Tempo 中 BFF client span 和 Python FastAPI server span 拥有相同 trace id。
- 如果自动传播失败，手动注入实现后再次验证同 trace id 成立。

### 1.6 给 BFF report runtime 链路增加 span

当前 `bff/src/modules/agent/agent.service.ts` 除了 `streamChat`，还代理 report status、report markdown、report read 等 runtime 请求。观测方案不能只覆盖 stream 链路，否则面试结束后的报告生成和下载链路在 Tempo 中缺少业务语义。

修改：

- `bff/src/modules/agent/agent.service.ts`

给以下方法增加手动 span：

- `fetchInterviewReportStatus`
  - span name: `bff.agent.report_status`
- `fetchInterviewReportMarkdown`
  - span name: `bff.agent.report_markdown`
- `markInterviewReportRead`
  - span name: `bff.agent.report_mark_read`
- `fetchReportRuntime`
  - span name: `bff.agent.report_runtime_request`，或作为上述 operation span 的 child span。

建议 attributes：

- `interview.thread_id`
- `interview.runtime_provider`
- `report.operation`: `status`、`markdown`、`mark_read`
- `http.response.status_code`
- `runtime.base_url_host`

注意：

- 不记录报告 markdown 正文。
- 不记录简历、JD、回答、prompt 或 response 原文。
- report runtime fetch 同样需要继承 active context，并传播 `traceparent`。

执行后自验收：

- 查询报告状态后，Tempo 中出现 `bff.agent.report_status`。
- 下载报告 markdown 后，Tempo 中出现 `bff.agent.report_markdown`，但 span attributes 不包含 markdown 正文。
- 标记已读后，Tempo 中出现 `bff.agent.report_mark_read`。
- report API 的 runtime HTTP client span 与对应业务 span 在同一 trace 下。

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
"langsmith",
```

实际版本由 lock 文件固化，不在计划中硬编码具体版本。若项目使用 `uv`/pip-tools 生成 `requirements.lock`，需要同步更新 lock。显式添加 `langsmith`，避免依赖 LangChain 的 transitive dependency 来提供 tracing API、metadata、anonymizer 或后续 redaction 能力。

执行后自验收：

- `../my-first-agent-langgraph/pyproject.toml` 和 lock 文件都包含新增 OpenTelemetry 依赖。
- `../my-first-agent-langgraph/pyproject.toml` 和 lock 文件都包含显式 `langsmith` 依赖。
- `cd ../my-first-agent-langgraph && python -m pytest tests/test_health.py` 成功。
- Python runtime 镜像或本地环境能 import 新增 OpenTelemetry 包。
- Python runtime 镜像或本地环境能 import `langsmith`。

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
  - `otel.trace_id`

关联策略：

- OpenTelemetry span attributes 中记录 `langsmith.project`。
- 如果运行时能安全拿到 LangSmith run id，则在当前 active span 中记录 `langsmith.run_id`。
- LangSmith metadata 中记录 `otel.trace_id`，用于从 LangSmith 反查 Grafana/Tempo trace。
- 不把 OpenTelemetry trace id 当作安全边界；它只是排障关联键。

执行后自验收：

- 开启 LangSmith 后，一次面试请求在指定 `LANGSMITH_PROJECT` 中产生 run。
- LangSmith run 中可以看到 LangGraph/LLM 的 run tree。
- run metadata 包含 `thread_id`、`runtime_provider=python`、`model_provider`、`model_name`、`otel.trace_id`。
- Tempo 中对应 trace 的 Python span attributes 包含 `langsmith.project`，如果可用则包含 `langsmith.run_id`。
- LangSmith 写入失败时业务请求不失败，只记录 warning 或 telemetry 错误。

### 3.3 隐私策略

默认策略：

- 只有 local mock data 可以完整打开 LangSmith，用于调试。
- 任何包含真实简历、JD、面试回答、姓名、邮箱、手机号或公司敏感信息的数据，即使在 local/dev，也必须启用 masking/redaction/anonymizer 或关闭 LangSmith。
- shared/staging/prod 默认关闭 LangSmith 原文记录；如需开启，必须先确认数据授权、脱敏策略和保留周期。
- 若无法完成脱敏，只允许记录 metadata，不允许记录 prompt/response 原文。

执行后自验收：

- 文档明确说明 local mock、local real data、shared/staging/prod 的 LangSmith 开关策略。
- 若生产或共享环境启用 LangSmith，必须有 masking/redaction 或明确的数据授权记录。
- 使用包含邮箱、手机号、真实姓名占位符的测试输入抽查一次 LangSmith run，确认记录内容符合当前环境的数据策略，或明确记录当前环境只允许 mock data。

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
- metadata 中可检索 `thread_id` 和 `otel.trace_id`。
- Tempo 中对应 Python span 可看到 `langsmith.project`，如果可用则看到 `langsmith.run_id`。
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
   - 覆盖 stream 和 report runtime fetch spans
   - 验证 BFF spans 进入 Tempo，并验证 Node 22 global fetch 的 undici/fetch trace context 传播
   - 执行后自验收：`npm --prefix bff run build` 和 `npm --prefix bff run test` 成功，一次 BFF stream 请求和一次 report API 请求都能在 Tempo 查询到 `interview-bff` 相关 spans。

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
   - 建立 `otel.trace_id`、`langsmith.project`、`langsmith.run_id` 的跨系统关联
   - 明确真实数据脱敏/anonymizer 策略
   - 验证 LangSmith run tree
   - 执行后自验收：开启 `LANGSMITH_TRACING=true` 后 LangSmith 项目出现 run tree，关闭或缺少 key 时本地流程仍正常；真实数据不会以明文进入 LangSmith。

5. `observability-sampling`
   - 为 local/staging/prod 定义采样策略
   - 通过环境变量控制 sampler 类型和比例
   - 验证 parent-based sampling 下跨服务 trace 决策一致
   - 执行后自验收：local 全量采样可用，staging/prod 不默认全量采样，高频请求下 trace 数量大致符合采样比例。

6. `observability-docs`
   - 更新 README 或 `docs/`，记录如何启动和如何在 Grafana/LangSmith 查询
   - 补 troubleshooting
   - 执行后自验收：文档能指导新开发者从零启动 stack、触发一次 trace、在 Grafana 和 LangSmith 中找到对应记录，并覆盖常见无 trace/不同 trace id/无 LangSmith run 的排障路径。

## Phase 7.1: 逐步执行计划

本节把 Phase 0 到 Phase 5 拆成更小的执行 step。每个 step 的代码改动目标控制在 200 行左右；如果实际 diff 明显超过 200 行，应继续拆分，优先按文件边界、运行时边界或验收边界拆开。每个 step 都必须在完成后执行自己的“自验收”，验收通过后再进入下一步。

### Step 1: 新增本地观测配置目录

引用设计：

- `方案结论` 中的 `OpenTelemetry SDK -> OpenTelemetry Collector -> Grafana Tempo -> Grafana`。
- `Phase 0.1 新增 Collector 配置`。
- `Phase 0.2 新增 Tempo 配置`。
- `Phase 0.3 新增 Grafana datasource provisioning`。

执行范围：

- 新增 `ops/observability/otel-collector-config.yml`。
- 新增 `ops/observability/tempo.yml`。
- 新增 `ops/observability/grafana/provisioning/datasources/datasources.yml`。

代码改动预算：

- 约 80 到 140 行。
- 只添加配置文件，不改应用代码。

自验收：

- `Test-Path ops/observability/otel-collector-config.yml` 为 true。
- `Test-Path ops/observability/tempo.yml` 为 true。
- `Test-Path ops/observability/grafana/provisioning/datasources/datasources.yml` 为 true。
- YAML 文件缩进可读，且 `otel-collector-config.yml` 包含 `receivers.otlp`、`exporters.otlp/tempo`、`service.pipelines.traces`。
- `datasources.yml` 包含名为 `Tempo` 的 datasource，URL 为 `http://tempo:3200`。
- `datasources.yml` 不引用尚未配置的 Loki/Prometheus datasource。

### Step 2: 将观测栈接入 docker-compose

引用设计：

- `目标架构` 中 Collector、Tempo、Grafana 的位置。
- `Phase 0.4 修改 docker-compose`。

执行范围：

- 修改 `docker-compose.yml`。
- 新增 `otel-collector`、`tempo`、`grafana` services。
- 新增 `tempo-data`、`grafana-data` volumes。
- 为 `otel-collector`、`tempo`、`grafana` 选择明确 image tag，避免使用 floating `latest`。
- 暂不修改 `bff` 和 `python-agent` 的 OTEL 环境变量，避免一个 step 过大。

代码改动预算：

- 约 60 到 120 行。
- 只改 compose 编排，不改业务服务配置。

自验收：

- `docker compose config` 成功。
- 渲染后的 compose 配置中存在 `otel-collector`、`tempo`、`grafana`。
- 渲染后的 compose 配置中存在 `tempo-data` 和 `grafana-data`。
- 启动观测栈后，`http://localhost:3001` 可访问 Grafana，`http://localhost:3200` 可访问 Tempo HTTP 端口。
- Tempo 日志显示 OTLP receiver 配置生效；如果启动失败，先按固定 image tag 的官方配置修正 `tempo.yml`。

### Step 3: 为 BFF 和 Python runtime 注入 OTEL/LangSmith 环境变量

引用设计：

- `Trace 字段约定` 中的 `service.name` 和 `deployment.environment`。
- `Phase 0.4 修改 docker-compose` 中的 BFF、Python runtime 环境变量。
- `Phase 3.1 环境变量`。

执行范围：

- 修改 `docker-compose.yml` 中 `bff.environment`。
- 修改 `docker-compose.yml` 中 `python-agent.environment`。
- 为 `bff` 设置 `OTEL_SERVICE_NAME=interview-bff`。
- 为 `python-agent` 设置 `OTEL_SERVICE_NAME=interview-python-agent` 和 LangSmith 变量。

代码改动预算：

- 约 30 到 80 行。
- 只改服务环境变量。

自验收：

- `docker compose config` 成功。
- 渲染后的 `bff` service 包含 `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`。
- 渲染后的 `python-agent` service 包含 `LANGSMITH_TRACING`、`LANGSMITH_API_KEY`、`LANGSMITH_PROJECT`。
- 默认 `LANGSMITH_TRACING` 为空或 false 时，compose 渲染不要求真实 LangSmith key。
- BFF 和 Python runtime 使用同一种 OTLP endpoint 约定，不混用 base endpoint 和手写 `/v1/traces` URL。

### Step 4: 更新环境变量模板

引用设计：

- `Phase 0.5 更新 env 模板`。
- `Phase 3.1 环境变量`。

执行范围：

- 修改根 `.env.example`。
- 修改 sibling repo `../my-first-agent-langgraph/.env.example`。
- 补充本地 OTEL 默认值和 LangSmith 占位变量。

代码改动预算：

- 约 20 到 60 行。
- 只改模板，不改真实 `.env`。

自验收：

- 根 `.env.example` 包含 `OTEL_SERVICE_NAME=interview-bff`。
- Python runtime `.env.example` 包含 `OTEL_SERVICE_NAME=interview-python-agent`。
- 两个模板都包含 `LANGSMITH_TRACING=false`、`LANGSMITH_API_KEY=`、`LANGSMITH_PROJECT=my-first-agent-local`。
- `git diff -- .env.example ../my-first-agent-langgraph/.env.example` 中没有真实密钥。

### Step 5: 安装 BFF OpenTelemetry 依赖

引用设计：

- `Phase 1.1 安装依赖`。

执行范围：

- 修改 `bff/package.json`。
- 更新 `bff/package-lock.json`。
- 不新增 `bff/src/telemetry.ts`，把依赖安装和代码接入拆开。

代码改动预算：

- `package.json` 约 6 到 12 行。
- lock 文件可能超过 200 行；这是依赖锁文件的机械变更，允许单独作为本 step 的主要 diff，不与业务代码混合。

自验收：

- `npm --prefix bff install` 成功。
- `npm --prefix bff run build` 成功。
- `bff/package.json` 中包含 `@opentelemetry/api`、`@opentelemetry/sdk-node`、`@opentelemetry/exporter-trace-otlp-http`、`@opentelemetry/auto-instrumentations-node`。
- 核对当前安装版本是否包含 undici/fetch instrumentation；如果未由 auto instrumentations 覆盖，则显式添加 `@opentelemetry/instrumentation-undici`。
- `bff/package-lock.json` 已同步更新。

### Step 6: 新增 BFF telemetry bootstrap

引用设计：

- `Phase 1.2 新增 telemetry bootstrap`。
- `Trace 字段约定` 中的 `service.name`、`deployment.environment`。

执行范围：

- 新增 `bff/src/telemetry.ts`。
- 支持 `OTEL_SDK_DISABLED=true`。
- 配置 NodeSDK、OTLP HTTP exporter、resource attributes、auto instrumentations。
- 明确启用或核对 undici/fetch instrumentation，以覆盖 Node 22 global `fetch`。
- 暂不修改 `main.ts`。

代码改动预算：

- 约 70 到 140 行。
- 只新增 bootstrap 文件。

自验收：

- `npm --prefix bff run build` 成功。
- `bff/src/telemetry.ts` 不启动 Nest app，不 import `AppModule`。
- 设置 `OTEL_SDK_DISABLED=true` 时 telemetry 初始化应短路。
- 文件中显式设置或读取 `OTEL_SERVICE_NAME`，默认值为 `interview-bff`。
- telemetry 初始化不在代码中硬编码错误的 OTLP traces URL；优先尊重环境变量。

### Step 7: 接入 BFF 启动顺序

引用设计：

- `Phase 1.3 修改 BFF 启动顺序`。

执行范围：

- 修改 `bff/src/main.ts`。
- 在最前面引入 `./telemetry`。
- 不改业务 service。

代码改动预算：

- 约 1 到 5 行。

自验收：

- `bff/src/main.ts` 的第一组 import 中包含 `import './telemetry';`。
- `npm --prefix bff run build` 成功。
- `OTEL_SDK_DISABLED=true npm --prefix bff run test` 或 Windows 等价命令成功。

### Step 8: 为 BFF streamChat 增加业务 span

引用设计：

- `Phase 1.4 给业务链路增加手动 span`。
- `Trace 字段约定` 中的 `interview.*` attributes。

执行范围：

- 修改 `bff/src/modules/agent/agent.service.ts`。
- 为 `streamChat` 增加 `bff.agent.stream_chat` span。
- 记录 thread、provider、protocol、flowTestMode、jobDescription、professionalQuestionCount 等非敏感 attributes。
- 用 active context 包住 runtime fetch 和关键 SSE pipe 逻辑，保证下游 client span 挂到 `bff.agent.stream_chat` 下面。
- 不在本 step 处理手动 `traceparent` 注入。

代码改动预算：

- 约 80 到 160 行。
- 若需要抽 helper，helper 与调用代码仍控制在本预算内。

自验收：

- `npm --prefix bff run build` 成功。
- `npm --prefix bff run test` 成功。
- span attributes 不包含 `resumeMarkdown`、`jobDescriptionMarkdown`、用户回答正文。
- runtime HTTP client span 是 `bff.agent.stream_chat` 的 child span。
- 现有 SSE 流式响应测试或 smoke 流程仍通过。

### Step 8.1: 为 BFF report runtime 链路增加业务 span

引用设计：

- `Phase 1.6 给 BFF report runtime 链路增加 span`。
- `Trace 字段约定` 中的非敏感业务 attributes。

执行范围：

- 修改 `bff/src/modules/agent/agent.service.ts`。
- 为 `fetchInterviewReportStatus`、`fetchInterviewReportMarkdown`、`markInterviewReportRead` 增加业务 span。
- 必要时让 `fetchReportRuntime` 生成 child span。
- 不记录报告 markdown 正文。

代码改动预算：

- 约 80 到 160 行。
- 如果和 Step 8 合并后超过 200 行，应保持本 step 独立。

自验收：

- `npm --prefix bff run build` 成功。
- `npm --prefix bff run test` 成功。
- 查询报告状态、下载报告、标记已读分别能看到 `bff.agent.report_status`、`bff.agent.report_markdown`、`bff.agent.report_mark_read`。
- span attributes 不包含报告 markdown 正文。

### Step 9: 验证并补齐 BFF 到 Python 的 trace context 传播

引用设计：

- `目标架构` 中的 `W3C traceparent header`。
- `Phase 1.5 上下文传播`。
- `Phase 6.3 Context propagation 验收`。

执行范围：

- 先验证 auto instrumentation 是否已经注入 `traceparent`。
- 重点核对 Node 22 global `fetch` 是否被 undici/fetch instrumentation 覆盖。
- 如果没有，修改 `bff/src/modules/agent/agent.service.ts` 手动注入 `traceparent`。
- 手动注入时只改 headers 构造，不改变请求 body 或 SSE pipe 行为。

代码改动预算：

- 如果只验证，0 行代码。
- 如果需要手动注入，约 20 到 80 行。

自验收：

- 在 Python runtime 侧临时查看或测试请求 headers，确认存在 `traceparent`。
- Tempo 中 BFF client span 与 Python server span 位于同一 trace id。
- `npm --prefix bff run test` 成功。
- report runtime fetch 也能传播同一套 `traceparent`。

### Step 10: 安装 Python runtime OpenTelemetry 依赖

引用设计：

- `Phase 2.1 安装依赖`。

执行范围：

- 修改 `../my-first-agent-langgraph/pyproject.toml`。
- 更新 `../my-first-agent-langgraph/requirements.lock`。
- 显式添加 `langsmith`，不要依赖 transitive dependency。
- 不新增 Python telemetry 代码。

代码改动预算：

- `pyproject.toml` 约 6 到 12 行。
- lock 文件可能超过 200 行；这是依赖锁文件的机械变更，允许单独作为本 step 的主要 diff，不与业务代码混合。

自验收：

- `cd ../my-first-agent-langgraph && python -m pytest tests/test_health.py` 成功。
- Python 环境能 import `opentelemetry.sdk`、`opentelemetry.exporter.otlp.proto.http.trace_exporter`、`opentelemetry.instrumentation.fastapi`。
- Python 环境能 import `langsmith`。
- lock 文件已同步更新。

### Step 11: 新增 Python telemetry bootstrap

引用设计：

- `Phase 2.2 新增 telemetry bootstrap`。
- `Trace 字段约定` 中的 `service.name`、`deployment.environment`。

执行范围：

- 新增 `../my-first-agent-langgraph/src/app/telemetry.py`。
- 初始化 TracerProvider、Resource、OTLP HTTP exporter、BatchSpanProcessor。
- 暴露 `instrument_fastapi(app)`。
- 支持 `OTEL_SDK_DISABLED=true`。
- 暂不修改 `main.py`。

代码改动预算：

- 约 80 到 160 行。

自验收：

- `cd ../my-first-agent-langgraph && python -m pytest tests/test_health.py` 成功。
- `python -c "from app.telemetry import instrument_fastapi"` 在项目 pythonpath 下成功。
- `OTEL_SDK_DISABLED=true` 时 import telemetry 不连接 Collector、不抛异常。
- 默认 service name 为 `interview-python-agent`。

### Step 12: 接入 FastAPI instrumentation

引用设计：

- `Phase 2.3 修改 FastAPI 入口`。

执行范围：

- 修改 `../my-first-agent-langgraph/src/app/main.py`。
- 在 app 创建后调用 `instrument_fastapi(app)`。
- 不改 graph 逻辑。

代码改动预算：

- 约 3 到 12 行。

自验收：

- `cd ../my-first-agent-langgraph && python -m pytest tests/test_health.py` 成功。
- `/health` 请求能生成 `interview-python-agent` HTTP server span。
- `/api/agents/interview-agent/stream` 仍返回 `text/event-stream`。

### Step 13: 为 LangGraph 主入口增加 span

引用设计：

- `Phase 2.4 给 LangGraph 主流程增加 span`。
- `Phase 6.2 Trace 验收`。

执行范围：

- 修改 `../my-first-agent-langgraph/src/app/main.py` 或 `../my-first-agent-langgraph/src/app/graphs/interview_graph.py`。
- 增加 `python_agent.stream_interview_agent` 和 `langgraph.invoke_interview_graph` spans。
- 只记录 thread/protocol/model provider 等 metadata。
- 不拆每个 node，不改 Redis/Milvus/LLM。

代码改动预算：

- 约 60 到 140 行。

自验收：

- `cd ../my-first-agent-langgraph && pytest tests/unit/test_interview_graph.py` 成功。
- 一次 start interview 请求在 Tempo 中包含 `langgraph.invoke_interview_graph`。
- span attributes 不包含简历、JD、回答、prompt、response 原文。

### Step 14: 为关键 LangGraph 节点增加 span

引用设计：

- `Phase 2.4 给 LangGraph 主流程增加 span` 中的关键节点列表。

执行范围：

- 修改 `../my-first-agent-langgraph/src/app/graphs/nodes/*.py`。
- 给初始化、检索、问题生成、回答处理、最终报告等关键节点增加 spans。
- 如节点分散导致 diff 超过 200 行，则按节点文件继续拆成多个 step。

代码改动预算：

- 每次提交约 120 到 200 行。
- 单个 step 最多覆盖 2 到 3 个节点文件。

自验收：

- 相关节点单元测试成功，例如 `pytest tests/unit/test_interview_graph.py tests/unit/test_process_user_reply.py`。
- 一次短流程 trace 中至少出现一个 `langgraph.node.*` span。
- 节点异常路径会设置 error status 或记录 exception。

### Step 15: 为 Redis 任务链路增加 span

引用设计：

- `目标架构` 中的 `Redis spans`。
- `Phase 2.4` 中的 `redis.answer_evaluation.enqueue`、`redis.answer_evaluation.read`。

执行范围：

- 修改 `../my-first-agent-langgraph/src/app/integrations/redis_evaluation_store.py`。
- 必要时修改 `../my-first-agent-langgraph/src/app/domain/answer_evaluation_enqueue.py`。
- 给 enqueue/read/update 等关键操作加 spans。

代码改动预算：

- 约 80 到 180 行。

自验收：

- `cd ../my-first-agent-langgraph && pytest tests/unit/test_redis_evaluation_store.py tests/unit/test_answer_evaluation_enqueue.py` 成功。
- 触发异步评分任务后，Tempo 中出现 `redis.answer_evaluation.*` spans。
- span attributes 只包含 thread/task/status/count 等 metadata，不包含回答正文。

### Step 16: 为 Milvus/RAG 检索增加 span

引用设计：

- `目标架构` 中的 `Milvus retrieval spans`。
- `Phase 2.5 Milvus 和模型调用的 span attributes`。

执行范围：

- 修改 `../my-first-agent-langgraph/src/app/integrations/milvus_store.py`。
- 必要时修改 `../my-first-agent-langgraph/src/app/domain/question_retriever.py`。
- 增加 `milvus.question_retrieval.search` span。

代码改动预算：

- 约 80 到 180 行。

自验收：

- `cd ../my-first-agent-langgraph && pytest tests/unit/test_milvus_store.py tests/unit/test_question_retriever.py` 成功。
- 触发 RAG 后，Tempo 中出现 `milvus.question_retrieval.search`。
- span attributes 包含 `db.system=milvus`、`rag.top_k`、`rag.result_count`，不包含检索原文全文。

### Step 17: 为 LLM 和 Embedding 调用增加 span

引用设计：

- `目标架构` 中的 `model/embedding spans`。
- `Phase 2.5 Milvus 和模型调用的 span attributes`。
- `隐私泄露` 风险控制。

执行范围：

- 修改 `../my-first-agent-langgraph/src/app/integrations/models.py`。
- 修改 `../my-first-agent-langgraph/src/app/integrations/embeddings.py`。
- 增加 `llm.chat_completion` 和 `embedding.create` spans。

代码改动预算：

- 约 100 到 200 行。

自验收：

- `cd ../my-first-agent-langgraph && pytest tests/unit/test_models.py tests/integration/test_runtime_dependencies_smoke.py` 成功。
- 使用 mock provider 时不会因为 telemetry 破坏 mock 流程。
- span attributes 包含 provider/model/dimension/timeout 等 metadata。
- 抽查 trace，确认没有 prompt、response、简历、JD、回答正文。

### Step 18: 接入 LangSmith 环境变量和 run metadata

引用设计：

- `LangGraph runtime -> LangSmith`。
- `Phase 3.2 LangGraph tracing`。
- `Phase 3.3 隐私策略`。

执行范围：

- 优先通过环境变量启用 LangSmith。
- 如当前 LangGraph/LangChain 版本需要代码传 metadata，则修改 graph invoke 入口。
- metadata 只写 `thread_id`、`runtime_provider`、`app_env`、`model_provider`、`model_name`、`otel.trace_id`。
- OTel span attributes 写入 `langsmith.project`，如果能安全取得 run id，则写入 `langsmith.run_id`。
- 对真实数据启用 masking/redaction/anonymizer；如果暂时做不到，只允许 mock data 开启完整 LangSmith tracing。

代码改动预算：

- 约 40 到 140 行。
- 不引入 prompt/response 额外记录逻辑。

自验收：

- `LANGSMITH_TRACING=false` 时完整测试仍通过。
- 设置真实 `LANGSMITH_API_KEY` 后，一次面试请求能在 `LANGSMITH_PROJECT` 中看到 run tree。
- LangSmith 写入失败不会导致 `/api/agents/interview-agent/stream` 失败。
- run metadata 可按 `thread_id` 和 `otel.trace_id` 检索。
- 用包含邮箱、手机号、真实姓名占位符的测试输入确认敏感字段不以明文进入 LangSmith，或明确记录当前环境只允许 mock data。

### Step 19: 完成跨服务端到端 trace 验收

引用设计：

- `Phase 6.1 本地启动`。
- `Phase 6.2 Trace 验收`。
- `Phase 6.3 Context propagation 验收`。

执行范围：

- 不优先写代码，先执行端到端验证。
- 若发现缺口，只做最小修复；单次修复仍控制在 200 行左右。
- 记录验证命令和观察结果到后续 docs step。

代码改动预算：

- 0 行到 100 行。

自验收：

- `npm run start:all` 启动完整本地 stack。
- 前端触发一次 start interview 后，Grafana Tempo 能看到同一 trace 下的 BFF 和 Python spans。
- trace 中至少包含 `bff.agent.stream_chat`、`bff.agent.runtime_stream_request`、`python_agent.stream_interview_agent`、`langgraph.invoke_interview_graph`。
- 如果 trace 不完整，必须先补齐缺口再进入下一 step。

### Step 20: 更新使用文档和排障说明

引用设计：

- `Phase 8: Grafana 查询与排障手册`。
- `DoD`。

执行范围：

- 更新 README 或 `docs/observability.md`。
- 记录如何启动、如何触发 trace、如何在 Grafana 查询、如何启用 LangSmith。
- 把 Phase 8 中的常见问题整理成开发者可执行的排障步骤。

代码改动预算：

- 约 100 到 200 行文档。
- 不改业务代码。

自验收：

- 新文档包含本地启动命令、Grafana URL、Tempo datasource、LangSmith env 示例。
- 新文档至少包含按 service、按 thread id、查 error 的 TraceQL 示例。
- 按文档从零启动后，可以触发一次 trace 并在 Grafana 中找到。
- 文档明确提醒 OpenTelemetry 不记录敏感正文，LangSmith 默认关闭，真实数据必须脱敏或不进入 LangSmith。

### Step 21: 配置环境级采样策略

引用设计：

- `风险与控制` 中的性能开销控制。
- `Trace 字段约定` 中的环境区分。

执行范围：

- 为 BFF 和 Python runtime 设计环境级采样配置。
- local/dev mock 默认全量采样。
- staging/prod 使用 parent-based trace id ratio sampler。
- 采样配置优先通过环境变量控制，不在业务代码中硬编码生产比例。

建议默认值：

- local: `always_on`
- staging: `parentbased_traceidratio`，比例 `0.2`
- prod: `parentbased_traceidratio`，比例 `0.05`，后续按流量和成本调整

代码改动预算：

- 约 20 到 100 行。
- 主要是环境变量、telemetry bootstrap 读取 sampler 设置和文档。

自验收：

- local 环境可以看到每次 smoke 请求的 trace。
- staging/prod 配置中存在 sampler 类型和比例，不默认全量采样。
- 高频请求下 Tempo trace 数量大致符合采样比例。
- parent trace 被采样时，下游 BFF/Python spans 保持同一采样决策。

### Step 22: 最终回归与改动边界检查

引用设计：

- `Phase 5: Mastra rollback provider 策略`。
- `Phase 6.5 测试验收`。
- `DoD`。

执行范围：

- 不新增功能。
- 运行最终测试和 smoke。
- 检查 Mastra rollback provider 未被非必要修改。
- 检查每个 step 是否满足 200 行左右改动原则；超出部分需要说明是否为 lock 文件或继续拆分。

代码改动预算：

- 0 行到 40 行，只允许补文档或修小问题。

自验收：

- `npm --prefix bff run test` 成功。
- `npm run test:e2e:interview:smoke:python` 成功。
- `cd ../my-first-agent-langgraph && pytest` 成功。
- `git diff --stat` 显示除 lock 文件外，单个 step 的代码改动维持在 200 行左右。
- `src/mastra/**` 无非必要改动；若有改动，必须符合 Phase 5 的 Mastra rollback provider 策略。
- sampling、LangSmith 隐私策略、OTel/LangSmith trace 关联字段均已通过文档和实际 trace 抽查。

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
- 采样比例必须通过环境变量或部署配置控制，不在业务代码中硬编码。
- 采样策略必须保持 parent-based，避免 BFF 与 Python runtime 对同一条请求做出不同采样决策。

### 隐私泄露

风险：

- 简历、JD、回答、prompt、response 进入外部系统。

控制：

- OpenTelemetry span 只记录结构化 metadata，不记录正文。
- LangSmith 默认关闭。
- 只有 local mock data 可以完整开启 LangSmith；真实数据必须先完成脱敏/anonymizer 或关闭 LangSmith。
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
- LangSmith run metadata 可以通过 `otel.trace_id` 关联回 Grafana/Tempo trace。
- 默认无 LangSmith key 时系统仍可正常本地启动。
- 敏感正文不会进入 OpenTelemetry span attributes。
- 真实简历、JD、面试回答不会以明文进入 LangSmith，除非已有明确授权和脱敏策略。
- staging/prod 不默认全量采样。

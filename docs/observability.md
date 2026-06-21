# Observability

This project uses OpenTelemetry for cross-service traces, Grafana Tempo for trace
storage, Grafana for exploration, and optional LangSmith tracing for Python
LangGraph runs.

OpenTelemetry spans must only contain operational metadata. Do not add resume,
job description, candidate answer, prompt, response, report markdown, retrieval
query text, embedding vector, or raw question text to span attributes.

## Local Stack

Start the observability services:

```powershell
docker compose up -d tempo otel-collector grafana
```

Start the application dependencies and local app services:

```powershell
npm run start:all
```

`npm run start:all` starts the Python LangGraph runtime, BFF, and frontend after
starting the app dependency services `etcd`, `minio`, and `milvus`. The
observability services are started separately so they can be restarted without
restarting the app.

Local URLs:

- Frontend: `http://localhost:4173`
- BFF: `http://localhost:3000`
- Python runtime: `http://localhost:8011`
- Grafana: `http://localhost:3001`
- Tempo API: `http://localhost:3200`
- OTLP HTTP collector: `http://localhost:4318`
- OTLP gRPC collector: `localhost:4317`

Local sampling defaults:

```env
OTEL_TRACES_SAMPLER=always_on
OTEL_TRACES_SAMPLER_ARG=1
```

Grafana credentials are the default local credentials unless changed by Docker
volume state:

```text
admin / admin
```

Grafana provisions a Tempo datasource named `Tempo` from:

```text
ops/observability/grafana/provisioning/datasources/datasources.yml
```

The datasource URL inside Docker is:

```text
http://tempo:3200
```

## Trigger A Trace

Use the frontend to start an interview, or trigger the BFF directly with a mock
start request:

```powershell
$threadId = "trace-smoke-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
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

## Project Experience
Built a demo interview system with tracing and retrieval.
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

Wait a few seconds for SDK batch processors and the collector batch processor to
flush spans to Tempo.

## Query In Grafana

Open Grafana:

```text
http://localhost:3001
```

Go to Explore, select the `Tempo` datasource, and use TraceQL.

Find traces by service:

```traceql
{ resource.service.name = "interview-bff" }
```

Find Python runtime traces:

```traceql
{ resource.service.name = "interview-python-agent" }
```

Find a trace by interview thread id:

```traceql
{ .interview.thread_id = "trace-smoke-1234abcd" }
```

Find errored spans:

```traceql
{ status = error }
```

A successful start-interview trace should include at least:

- `bff.agent.stream_chat`
- `bff.agent.runtime_stream_request`
- `python_agent.stream_interview_agent`
- `langgraph.invoke_interview_graph`

The same trace should include both services:

- `interview-bff`
- `interview-python-agent`

## Query Tempo Directly

Tempo can be queried without Grafana. Search by thread id:

```powershell
$threadId = "trace-smoke-1234abcd"
$query = [uri]::EscapeDataString('{ .interview.thread_id = "' + $threadId + '" }')
Invoke-WebRequest -UseBasicParsing "http://localhost:3200/api/search?q=$query&limit=20"
```

Fetch a trace by id:

```powershell
$traceId = "<trace-id-from-search>"
Invoke-WebRequest -UseBasicParsing "http://localhost:3200/api/traces/$traceId"
```

## LangSmith

LangSmith is optional and disabled by default.

Enable LangSmith when you want Python LangGraph runs to appear in your
LangSmith project:

```env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=my-first-agent-local
LANGSMITH_DATA_MODE=standard
```

Disable LangSmith completely with:

```env
LANGSMITH_TRACING=false
```

The Python runtime enables full LangSmith tracing when both of these are true:

- `LANGSMITH_TRACING=true`
- `LANGSMITH_API_KEY` is set

LangSmith metadata is limited to:

- `thread_id`
- `runtime_provider`
- `app_env`
- `model_provider`
- `model_name`
- `otel.trace_id`
- `LANGSMITH_DATA_MODE` remains available as an informational data-mode marker.

LangSmith failures must not fail interview requests. They should be treated as
observability failures, not runtime failures.

## Sampling

The BFF and Python runtime both read standard OpenTelemetry sampler variables:

```env
OTEL_TRACES_SAMPLER=always_on
OTEL_TRACES_SAMPLER_ARG=1
```

Use full sampling for local development and mock-data debugging:

```env
APP_ENV=local
OTEL_TRACES_SAMPLER=always_on
OTEL_TRACES_SAMPLER_ARG=1
```

Use parent-based ratio sampling outside local development so downstream spans
follow the upstream sampling decision:

```env
APP_ENV=staging
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.2
```

```env
APP_ENV=prod
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.05
```

Keep the same sampler variables on BFF and Python runtime. A parent-based
sampler prevents a sampled BFF request from losing Python child spans, and
prevents unsampled upstream requests from being re-sampled independently by the
runtime.

## Troubleshooting

No traces in Grafana:

- Check that `OTEL_SDK_DISABLED` is not `true`.
- Check Tempo: `Invoke-WebRequest http://localhost:3200/ready`.
- Check Collector logs: `docker compose logs --tail=100 otel-collector`.
- Check Tempo logs: `docker compose logs --tail=100 tempo`.
- Check that Grafana has the `Tempo` datasource.
- Confirm app services use OTLP HTTP endpoint `http://localhost:4318` locally or
  `http://otel-collector:4318` in Docker.

Collector cannot export to Tempo:

- Check Tempo is running and ready.
- Check Tempo logs for storage permission errors.
- Check `ops/observability/tempo.yml` exposes OTLP receivers on `0.0.0.0:4317`
  and `0.0.0.0:4318`; `localhost` inside the Tempo container is not reachable
  from the collector container.

BFF and Python spans are in different traces:

- Check BFF fetch/undici instrumentation is enabled.
- Check Python FastAPI instrumentation runs immediately after `FastAPI(...)`.
- Check both services use `OTEL_PROPAGATORS=tracecontext,baggage`.
- Inspect the BFF-to-Python request for a `traceparent` header if needed.

Expected spans are missing:

- For BFF stream spans, check `bff/src/modules/agent/agent.service.ts`.
- For Python stream and graph spans, check `../my-first-agent-langgraph/src/app/main.py`
  and `../my-first-agent-langgraph/src/app/graphs/interview_graph.py`.
- For RAG spans, trigger an initialization path that performs question retrieval.
- For LLM/embedding spans, ensure the code path calls the model or embedding
  provider.

LangSmith has no run:

- Check `LANGSMITH_TRACING=true`.
- Check `LANGSMITH_API_KEY`.
- Check `LANGSMITH_PROJECT`.
- Check Python logs for LangSmith warning messages.

SSE spans look long:

- This is expected. HTTP server spans for SSE cover the stream lifetime.
- Use child spans such as `langgraph.invoke_interview_graph`,
  `bff.agent.runtime_stream_request`, and `python_agent.stream_interview_agent`
  for runtime execution timing.

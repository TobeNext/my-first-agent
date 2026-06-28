# my-first-agent

AI interview practice system with a Vue frontend, a NestJS BFF, and a Python LangGraph interview runtime. The legacy Mastra runtime under `src/mastra/` is archived and no longer part of future development.

## Architecture

The project is split into three runtime layers:

- `frontend/`: Vue 3 + TypeScript app for resume upload, interview setup, streaming chat, session recovery, progress display, and feedback submission.
- `bff/`: NestJS backend-for-frontend. It validates uploads, normalizes resume sections, owns the frontend API contract, and proxies streaming interview traffic to the configured agent runtime by `threadId`.
- `../my-first-agent-langgraph/`: default Python LangGraph runtime. It accepts the same structured interview start/reply contract, checkpoints interview state, returns Mastra-compatible SSE, and writes compatible outcome/RAG artifacts.
- `src/mastra/`: archived legacy Mastra runtime. It is kept for reference only and is not a target for new features, rollback, or maintenance.

Supporting services:

- Milvus stores embedded interview questions and scalar metadata such as `role`, `difficulty`, and `skillArea`.
- Redis is only needed for the legacy Mastra rollback provider's async answer evaluation path. The default Python LangGraph provider does not use Redis for answer evaluation, report generation, or report status.
- LibSQL stores Mastra runtime persistence such as traces and memory.
- The Python report DB stores generated markdown reports, structured report JSON, and read receipts.

## Interview Flow

1. The user uploads a resume and optionally a job description in the frontend.
2. The frontend performs local file checks, then sends the resume to the BFF.
3. The BFF validates size, type, and structure, then uses its canonical resume parser to extract normalized skill groups and project topics.
4. The frontend builds a structured interview start request with resume Markdown, optional JD Markdown, and interview settings.
5. The BFF normalizes defaults, fills `resumeSections`, and forwards the structured payload to the configured agent runtime.
6. By default, the Python LangGraph runtime initializes the session, retrieves or falls back to interview questions, checkpoints state, advances follow-ups, returns progress summaries, and writes outcome/RAG artifacts.
7. When the interview reaches wrap-up, LangGraph returns the report-generating message immediately, then a Python background task runs answer evaluation, report generation, and report DB persistence. The frontend bell short-polls the BFF report status API until the Python report DB shows the report is ready or failed.
8. User feedback is later written back through the BFF using the unchanged outcome index and feedback shape.

Generated local artifacts such as `Interview outcome/`, RAG recall samples, logs, coverage, databases, and build outputs are intentionally ignored by Git.

## Requirements

- Node.js `>=22.13.0`
- npm
- Docker Desktop for the full containerized stack
- A root `.env` file based on `.env.example`

Minimum root `.env` values:

```env
OPENAI_API_KEY=your-api-key
MILVUS_ADDRESS=localhost:19530
LIBSQL_VECTOR_DB_URL=file:./interview-vectors.db
REDIS_URL=redis://localhost:6379
EMBEDDING_PROVIDER=hash
```

`REDIS_URL` is only required when running the Mastra rollback provider or its legacy async answer-evaluation worker. The default Python provider can complete the report flow without Redis.

BFF defaults are defined in `bff/src/config.ts`:

- `PORT=3000`
- `AGENT_RUNTIME_PROVIDER=python`
- `MASTRA_BASE_URL=http://localhost:4111`
- `PY_AGENT_BASE_URL=http://localhost:8011`
- `RESUME_MAX_FILE_SIZE_BYTES=2097152`
- `DEMO_USERNAME=demo`
- `DEMO_PASSWORD=demo123`

Python embedding defaults are `EMBEDDING_PROVIDER=hash`,
`EMBEDDING_MODEL=text-embedding-3-small`, and `EMBEDDING_DIMENSION=384`.
Set `EMBEDDING_PROVIDER=openai` plus `EMBEDDING_API_KEY` or `OPENAI_API_KEY`
to query Milvus with provider-backed embeddings; no-key local startup keeps the
deterministic hash fallback.

## Install

Install dependencies for all three workspaces:

```powershell
npm install
npm --prefix bff install
npm --prefix frontend install
```

The Windows local startup script installs missing `node_modules` for each service automatically, but explicit install keeps setup predictable.

## Run Locally

For local Windows development:

```powershell
npm run start:local
```

To start Docker dependencies first, then launch the local Python/BFF/frontend dev services:

```powershell
npm run start:all
```

This starts three PowerShell windows by default:

- Python LangGraph runtime: `http://localhost:8011`
- BFF API: `http://localhost:3000`
- Frontend: `http://localhost:4173`

The frontend proxies `/api` requests to the BFF. The startup script also frees the required app ports before launching services. `start:local` starts only the Python agent, BFF, and frontend; it does not start Redis or any answer/report worker. `start:all` additionally starts the Docker Compose dependency services `etcd`, `minio`, and `milvus`, then waits for Milvus before opening the app service windows. Redis is started only by the Mastra rollback variant, `start:all:mastra`.

For Grafana Tempo, OpenTelemetry Collector, and optional LangSmith tracing, see [docs/observability.md](docs/observability.md).

You can also run services manually:

```powershell
Set-Location ../my-first-agent-langgraph
$env:PYTHONPATH='src'; python -m uvicorn app.main:app --host 0.0.0.0 --port 8011
Set-Location ../my-first-agent
npm --prefix bff run start:dev
npm --prefix frontend run dev
```

To force the rollback provider locally:

```powershell
npm run start:local:mastra
```

## Run With Docker

Start the full stack:

```powershell
docker compose up --build
```

Docker Compose starts:

- etcd, MinIO, and Milvus
- Redis
- Python LangGraph runtime on `http://localhost:8011`
- Mastra on `http://localhost:4111`
- BFF on `http://localhost:3000`
- Frontend on `http://localhost:8080`

The BFF defaults to `AGENT_RUNTIME_PROVIDER=python`. Set `AGENT_RUNTIME_PROVIDER=mastra` before `docker compose up` to roll back to Mastra without code changes.

## Useful Commands

```powershell
npm run dev                         # Default local Python/BFF/frontend stack
npm run dev:mastra                  # Mastra dev server
npm run build                       # Mastra production build
npm run start                       # Default local Python/BFF/frontend stack
npm run start:mastra                # Start built Mastra server
npm run worker:answer-evaluation    # Legacy Mastra rollback async evaluation worker
npm run migrate:vectors:milvus      # Recreate Milvus question vectors from LibSQL source
npm run backfill:vectors:milvus-metadata
```

Workspace tests:

```powershell
npm run test:unit
npm run test:coverage
npm --prefix bff run test:coverage
npm --prefix frontend run test:coverage
npm run test:workspace
```

## Live Interview E2E

Start the full stack first with Docker or `npm run start:local`, then run:

```powershell
npm run test:e2e:interview:smoke
npm run test:e2e:interview
npm run test:e2e:interview:smoke:mastra
npm run test:e2e:interview:rollback-smoke
```

- `test:e2e:interview:smoke`: Python provider readiness plus the minimal upload-resume-to-start-interview path.
- `test:e2e:interview`: Python provider full live suite covering completion, outcome persistence, report status readiness, edge scenarios, and feedback submission.
- `test:e2e:interview:smoke:mastra`: rollback smoke against the legacy provider.
- `test:e2e:interview:rollback-smoke`: starts the stack with Python, runs smoke, restarts with Mastra, and runs the same smoke again.

Override service targets when needed:

```powershell
$env:INTERVIEW_E2E_FRONTEND_URL = 'http://localhost:8080'
$env:INTERVIEW_E2E_BFF_URL = 'http://localhost:3000'
$env:INTERVIEW_E2E_MASTRA_URL = 'http://localhost:4111'
$env:INTERVIEW_E2E_PY_AGENT_URL = 'http://localhost:8011'
npm run test:e2e:interview
```

The manual GitHub Actions workflow at `.github/workflows/interview-e2e.yml` writes the `E2E_ENV_FILE` repository secret to `.env`, starts Docker Compose, and runs the same root E2E command.

## Key Directories

- `src/mastra/agents`: archived agent definitions and tool/model composition.
- `src/mastra/tools`: archived Mastra tools with Zod input/output boundaries.
- `src/mastra/lib`: archived runtime infrastructure, state machine helpers, RAG, vector store, Redis evaluation store, and parsers/adapters.
- `src/mastra/scripts`: archived manual scripts for migration, legacy rollback workers, imports, and local verification.
- `frontend/src`: Vue views, components, services, stores, schemas, and router.
- `bff/src/modules`: NestJS modules for auth, resume validation, and agent proxy APIs.
- `e2e/`: live interview E2E harness.
- `docs/` and `PLAN/`: architecture references and implementation plans. Code is the source of truth when docs and implementation differ.

## Development Notes

- The Mastra runtime is archived; see `AGENTS.md` for LangGraph development guidance.
- New interview runtime features belong in `../my-first-agent-langgraph`; `src/mastra/**` is archived and no longer maintained. Do not add new features, rollback work, or compatibility work in Mastra.
- Keep resume parsing rules centralized in `bff/src/modules/resume/resume-parser.ts`.
- Keep interview progression in the state machine and state manager instead of scattering flow rules into prompts.
- Do not commit generated artifacts, local databases, `.env` files, coverage, logs, or build outputs.
- After code changes that affect architecture, update `.github/instructions/project-architecture.instructions.md` and record the project-architecture-sync check.
- See `docs/RUNTIME_PROVIDER_CUTOVER.md` for the historical provider cutover record and the Mastra decommission gate.

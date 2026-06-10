# my-first-agent

AI interview practice system built on Mastra, with a Vue frontend, a NestJS BFF, and a Mastra runtime that manages interview state, RAG question selection, async answer evaluation, and final reports.

## Architecture

The project is split into three runtime layers:

- `frontend/`: Vue 3 + TypeScript app for resume upload, interview setup, streaming chat, session recovery, progress display, and feedback submission.
- `bff/`: NestJS backend-for-frontend. It validates uploads, normalizes resume sections, owns the frontend API contract, and proxies streaming interview traffic to Mastra by `threadId`.
- `src/mastra/`: Mastra runtime. It registers `interview-agent` and `answer-evaluation-agent`, stores runtime state with LibSQL, retrieves interview questions from Milvus, queues async answer evaluations in Redis, and writes structured interview outcomes.

Supporting services:

- Milvus stores embedded interview questions and scalar metadata such as `role`, `difficulty`, and `skillArea`.
- Redis stores async answer evaluation tasks, manifests, statuses, and LLM scoring results.
- LibSQL stores Mastra runtime persistence such as traces and memory.

## Interview Flow

1. The user uploads a resume and optionally a job description in the frontend.
2. The frontend performs local file checks, then sends the resume to the BFF.
3. The BFF validates size, type, and structure, then uses its canonical resume parser to extract normalized skill groups and project topics.
4. The frontend builds a structured interview start request with resume Markdown, optional JD Markdown, and interview settings.
5. The BFF normalizes defaults, fills `resumeSections`, and forwards the structured payload to `interview-agent`.
6. Mastra delegates setup to `interviewStateManagerTool`, which runs the initialization pipeline: JD signal extraction, question planning, RAG retrieval, generation, critic checks, fallback, and state-machine initialization.
7. During the interview, the state manager advances professional-skill and project-experience rounds, creates follow-ups, returns progress summaries, writes outcome artifacts, and enqueues async Redis answer-evaluation tasks.
8. At wrap-up, Mastra waits for complete evaluation results and uses them to produce the final report. User feedback is later written back through the BFF.

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
```

BFF defaults are defined in `bff/src/config.ts`:

- `PORT=3000`
- `MASTRA_BASE_URL=http://localhost:4111`
- `RESUME_MAX_FILE_SIZE_BYTES=2097152`
- `DEMO_USERNAME=demo`
- `DEMO_PASSWORD=demo123`

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

This starts three PowerShell windows:

- Mastra Studio and API: `http://localhost:4111`
- BFF API: `http://localhost:3000`
- Frontend: `http://localhost:4173`

The frontend proxies `/api` requests to the BFF. The startup script also frees the required ports before launching services.

You can also run services manually:

```powershell
npm run dev
npm --prefix bff run start:dev
npm --prefix frontend run dev
```

## Run With Docker

Start the full stack:

```powershell
docker compose up --build
```

Docker Compose starts:

- etcd, MinIO, and Milvus
- Redis
- Mastra on `http://localhost:4111`
- BFF on `http://localhost:3000`
- Frontend on `http://localhost:8080`

The Mastra container reads the root `.env`; Compose overrides `MILVUS_ADDRESS` and `REDIS_URL` for in-network service names.

## Useful Commands

```powershell
npm run dev                         # Mastra dev server
npm run build                       # Mastra production build
npm run start                       # Start built Mastra server
npm run worker:answer-evaluation    # Run async answer evaluation worker
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
```

- `test:e2e:interview:smoke`: environment readiness plus the minimal upload-resume-to-start-interview path.
- `test:e2e:interview`: full live suite covering completion, outcome persistence, edge scenarios, and feedback submission.

Override service targets when needed:

```powershell
$env:INTERVIEW_E2E_FRONTEND_URL = 'http://localhost:8080'
$env:INTERVIEW_E2E_BFF_URL = 'http://localhost:3000'
$env:INTERVIEW_E2E_MASTRA_URL = 'http://localhost:4111'
npm run test:e2e:interview
```

The manual GitHub Actions workflow at `.github/workflows/interview-e2e.yml` writes the `E2E_ENV_FILE` repository secret to `.env`, starts Docker Compose, and runs the same root E2E command.

## Key Directories

- `src/mastra/agents`: agent definitions and tool/model composition.
- `src/mastra/tools`: Mastra tools with Zod input/output boundaries.
- `src/mastra/lib`: shared runtime infrastructure, state machine helpers, RAG, vector store, Redis evaluation store, and parsers/adapters.
- `src/mastra/scripts`: manual scripts for migration, workers, imports, and local verification.
- `frontend/src`: Vue views, components, services, stores, schemas, and router.
- `bff/src/modules`: NestJS modules for auth, resume validation, and agent proxy APIs.
- `e2e/`: live interview E2E harness.
- `docs/` and `PLAN/`: architecture references and implementation plans. Code is the source of truth when docs and implementation differ.

## Development Notes

- Load the Mastra skill before editing or answering Mastra-specific questions; Mastra APIs change frequently.
- Keep resume parsing rules centralized in `bff/src/modules/resume/resume-parser.ts`.
- Keep interview progression in the state machine and state manager instead of scattering flow rules into prompts.
- Do not commit generated artifacts, local databases, `.env` files, coverage, logs, or build outputs.
- After code changes that affect architecture, update `.github/instructions/project-architecture.instructions.md` and record the project-architecture-sync check.

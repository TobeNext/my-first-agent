# Runtime Provider Cutover

## Current Default

The default interview runtime provider is now `python`.

- BFF default: `AGENT_RUNTIME_PROVIDER=python`
- Docker Compose default: `AGENT_RUNTIME_PROVIDER=${AGENT_RUNTIME_PROVIDER:-python}`
- Local startup default: `npm run start:local` starts the Python LangGraph runtime and points BFF at it
- Main E2E command: `npm run test:e2e:interview` runs the Python provider suite

Mastra remains available only as a rollback provider while the cutover is being stabilized.

## Behavior Parity Status

The provider switch means runtime wiring is complete, not that behavior parity is complete.
As of the Phase A baseline:

- Python can start sessions, stream Mastra-compatible snapshots, checkpoint state, write
  outcome/RAG artifacts, and complete the deterministic short flow.
- Python now has a LangChain chat model factory and can use a configured
  OpenAI-compatible provider for LLM-generated follow-up questions. The default
  mock/no-key path and model failures still use deterministic fallback logic.
- Python now has Redis-compatible async evaluation schemas/store key layout, main
  graph best-effort enqueue, a LangChain structured-output worker loop, wait/read,
  and final report reduction from complete LLM evaluation results. Failed, pending,
  or timed-out evaluations block final report readiness instead of returning partial
  local rule-based reports.
- Python now has metadata normalization and hybrid rerank parity tests for the
  existing Mastra RAG path. `bm25Score` remains the legacy trace field name, but
  currently records skillArea match score rather than a true lexical BM25 score.
- Python can use provider-backed OpenAI-compatible embeddings when
  `EMBEDDING_PROVIDER` and credentials are configured. The default no-key path
  remains deterministic hash embedding so local fallback behavior still passes.
- Golden transcript fixtures in `PLAN/fixtures/contracts` are a baseline for the current
  deterministic behavior only. They intentionally do not prove LLM evaluation parity.

## Rollback Smoke

Run the reproducible double-run rollback smoke from the repository root:

```powershell
npm run test:e2e:interview:rollback-smoke
```

Phase G local verification on 2026-06-15 passed the Python provider smoke,
Python full E2E suite, Python complete flow with the answer-evaluation worker,
and the Mastra provider smoke. Docker rollback smoke was not executed in that
environment because Docker Desktop was not running and `docker compose` could not
connect to `npipe:////./pipe/dockerDesktopLinuxEngine`; rerun the command above
in a Docker-enabled environment before treating rollback as release-proven.

The script starts the stack with `AGENT_RUNTIME_PROVIDER=python`, runs the Python smoke, restarts the stack with `AGENT_RUNTIME_PROVIDER=mastra`, and runs the same smoke against Mastra.

Manual rollback is also env-only:

```powershell
$env:AGENT_RUNTIME_PROVIDER = 'mastra'
docker compose up -d --build
npm run test:e2e:interview:smoke:mastra
```

Switching back to the default provider is the inverse:

```powershell
$env:AGENT_RUNTIME_PROVIDER = 'python'
docker compose up -d --build
npm run test:e2e:interview:smoke:python
```

## Mastra Freeze

New interview runtime features must be implemented in the sibling Python LangGraph repository, `../my-first-agent-langgraph`.

`src/mastra/**` is frozen for new product/runtime capabilities. Changes there should be limited to rollback blockers, security fixes, build breakages, or compatibility fixes needed to keep the fallback provider available during the cutover window.

## Decommission Gate

Do not remove or archive `src/mastra/**` until all of the following are true:

- Python provider full E2E passes in Docker/CI.
- Mastra rollback smoke has passed at least once after the Python default switch.
- BFF and frontend tests pass without depending on Mastra runtime startup.
- Outcome and RAG sample shape remain backward compatible.
- The team explicitly accepts that production scripts and CI no longer need Mastra fallback.

After those gates pass, remove Mastra from production Docker/CI/start scripts first, then archive or delete the runtime source in a separate PR that preserves historical fixtures and migration docs.

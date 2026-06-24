# AGENTS.md

This document provides guidance for AI coding agents working in this repository.

## Project Overview

This repository is the frontend/BFF host for an interview system whose only maintained runtime provider is the sibling Python LangGraph project at `../my-first-agent-langgraph`.

The legacy **Mastra** runtime under `src/mastra/**` is archived and no longer part of future maintenance or solution design. Do not add new interview runtime features, rollback work, compatibility work, or follow-up plans in Mastra; all future interview runtime work belongs in `../my-first-agent-langgraph`.

## CRITICAL: LangGraph Architecture Instruction Required

**BEFORE reading implementation files, executing a plan step, or editing anything under `../my-first-agent-langgraph`, first load and read `.github/instructions/langgraph-architecture.instructions.md` from this host repository.**

This requirement applies even when the user points directly to a plan file or a specific Python source file. If a single request advances multiple numbered plan steps, reload/recheck the LangGraph architecture instruction before each step. After making LangGraph runtime changes, run the `project-architecture-sync` skill and record the guard as instructed there.

### LangGraph / Python Guidance

The sibling project `../my-first-agent-langgraph` is the maintained Python runtime for the interview system. Treat it as the only place for new interview runtime features, while this host repository owns the frontend, BFF, and local stack orchestration.

1. **Load the LangGraph architecture instruction FIRST** - Read `.github/instructions/langgraph-architecture.instructions.md` before inspecting Python runtime implementation, answering LangGraph runtime design questions, or editing `../my-first-agent-langgraph`.
2. **Never rely on cached LangGraph or LangChain knowledge** - APIs and project wiring can change quickly. Verify behavior against the installed project code, `pyproject.toml`, and the architecture instruction before choosing an implementation.
3. **Keep changes inside the established Python layers** - FastAPI handlers stay at HTTP/SSE boundaries; LangGraph graph files own routing/checkpoint orchestration; business logic goes in `src/app/domain`; external clients and persistence adapters go in `src/app/integrations`; contracts stay in `src/app/schemas`.
4. **Preserve the BFF/frontend contract** - SSE and report/status/markdown/read APIs must keep the shapes consumed by the BFF and frontend unless those layers are intentionally updated in the same change.
5. **Use the Python project tooling** - The runtime targets Python 3.12+, Pydantic v2, FastAPI, LangGraph, LangChain, pytest, and Ruff with 100-column lines. Prefer focused unit tests for domain changes, contract tests for stream/API shape, and integration tests for runtime wiring.
6. **Run scoped verification** - For LangGraph changes, run the most relevant `python -m pytest ...` and `python -m ruff check ...` commands from `../my-first-agent-langgraph`. Broaden to full tests when changing graph routing, schemas, persistence, or API behavior.

## Commands

Use these commands to interact with the project.

### Installation

```bash
npm install
```

### Development

Start the default local stack with the Python runtime, BFF, and frontend:

```bash
npm run start:local
```

The legacy Mastra Studio can still be started for archival inspection at localhost:4111, but it is not a target for new runtime work:

```bash
npm run dev:mastra
```

### Build

In order to build a production-ready server, run the `build` script:

```bash
npm run build
```

## Project Structure

Folders organize this host app and the archived legacy runtime.

| Folder                 | Description                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend`             | Vue frontend application for upload, interview, report notification, and feedback flows.                                                  |
| `bff`                  | NestJS BFF for validation, auth boundaries, frontend contracts, and proxying to the LangGraph runtime.                                    |
| `src/mastra`           | Archived legacy Mastra runtime. Do not use as a target for future interview runtime work.                                                |
| `../my-first-agent-langgraph` | Maintained Python LangGraph interview runtime. New interview runtime features go here.                                           |

### Top-level files

Top-level files define how the host project is configured, built, and connected to its environment.

| File                  | Description                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `.env.example`        | Template for environment variables - copy and rename to `.env` to add your secret [model provider](/models) keys. |
| `package.json`        | Defines project metadata, dependencies, and available npm scripts.                                                |
| `tsconfig.json`       | Configures TypeScript options such as path aliases, compiler settings, and build output.                          |

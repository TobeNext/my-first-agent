# AGENTS.md

This document provides guidance for AI coding agents working in this repository.

## CRITICAL: Mastra Skill Required

**BEFORE doing ANYTHING with Mastra code or answering Mastra questions, load the Mastra skill FIRST.**

See [Mastra Skills section](#mastra-skills) for loading instructions.

## Project Overview

This repository is now the frontend/BFF host for an interview system whose default runtime provider is the sibling Python LangGraph project at `../my-first-agent-langgraph`.

The legacy **Mastra** runtime under `src/mastra/**` remains available only as a rollback provider during the cutover window. New interview runtime features must be implemented in the LangGraph repository. Mastra source changes should be limited to rollback blockers, security fixes, build breakages, or compatibility fixes that keep the fallback provider usable.

## CRITICAL: LangGraph Architecture Instruction Required

**BEFORE reading implementation files, executing a plan step, or editing anything under `../my-first-agent-langgraph`, first load and read `.github/instructions/langgraph-architecture.instructions.md` from this host repository.**

This requirement applies even when the user points directly to a plan file or a specific Python source file. If a single request advances multiple numbered plan steps, reload/recheck the LangGraph architecture instruction before each step. After making LangGraph runtime changes, run the `project-architecture-sync` skill and record the guard as instructed there.

### LangGraph / Python Guidance

The sibling project `../my-first-agent-langgraph` is the default Python runtime for the interview system. Treat it as the primary place for new interview runtime features, while this host repository owns the frontend, BFF, local stack orchestration, and Mastra rollback provider.

1. **Load the LangGraph architecture instruction FIRST** - Read `.github/instructions/langgraph-architecture.instructions.md` before inspecting Python runtime implementation, answering LangGraph runtime design questions, or editing `../my-first-agent-langgraph`.
2. **Never rely on cached LangGraph or LangChain knowledge** - APIs and project wiring can change quickly. Verify behavior against the installed project code, `pyproject.toml`, and the architecture instruction before choosing an implementation.
3. **Keep changes inside the established Python layers** - FastAPI handlers stay at HTTP/SSE boundaries; LangGraph graph files own routing/checkpoint orchestration; business logic goes in `src/app/domain`; external clients and persistence adapters go in `src/app/integrations`; contracts stay in `src/app/schemas`.
4. **Preserve the BFF/frontend contract** - SSE must remain Mastra-compatible, and report/status/markdown/read APIs must keep the shapes consumed by the BFF and frontend unless those layers are intentionally updated in the same change.
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

To force the rollback provider locally:

```bash
npm run start:local:mastra
```

Start the legacy Mastra Studio at localhost:4111 explicitly:

```bash
npm run dev:mastra
```

### Build

In order to build a production-ready server, run the `build` script:

```bash
npm run build
```

## Project Structure

Folders organize your agent's resources, like agents, tools, and workflows.

| Folder                 | Description                                                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `src/mastra`           | Entry point for all Mastra-related code and configuration.                                                                               |
| `src/mastra/agents`    | Define and configure your agents - their behavior, goals, and tools.                                                                     |
| `src/mastra/workflows` | Define multi-step workflows that orchestrate agents and tools together.                                                                  |
| `src/mastra/tools`     | Create reusable tools that your agents can call                                                                                          |
| `src/mastra/mcp`       | (Optional) Implement custom MCP servers to share your tools with external agents                                                         |
| `src/mastra/scorers`   | (Optional) Define scorers for evaluating agent performance over time                                                                     |
| `src/mastra/public`    | (Optional) Contents are copied into the `.build/output` directory during the build process, making them available for serving at runtime |
| `../my-first-agent-langgraph` | Default Python LangGraph interview runtime. New interview runtime features go here.                                               |

### Top-level files

Top-level files define how your Mastra project is configured, built, and connected to its environment.

| File                  | Description                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/mastra/index.ts` | Central entry point where you configure and initialize Mastra.                                                    |
| `.env.example`        | Template for environment variables - copy and rename to `.env` to add your secret [model provider](/models) keys. |
| `package.json`        | Defines project metadata, dependencies, and available npm scripts.                                                |
| `tsconfig.json`       | Configures TypeScript options such as path aliases, compiler settings, and build output.                          |

## Mastra Skills

Skills are modular capabilities that extend agent functionalities. They provide pre-built tools, integrations, and workflows that agents can leverage to accomplish tasks more effectively.

This project has skills installed for the following agents:

- Claude Code
- Cursor

### Loading Skills

1. **Load the Mastra skill FIRST** - Use `/mastra` command or Skill tool
2. **Never rely on cached knowledge** - Mastra APIs change frequently between versions
3. **Always verify against current docs** - The skill provides up-to-date documentation

**Why this matters:** Your training data about Mastra is likely outdated. Constructor signatures, APIs, and patterns change rapidly. Loading the skill ensures you use current, correct APIs.

Skills are automatically available to agents in your project once installed. Agents can access and use these skills without additional configuration.

## Resources

- [Mastra Documentation](https://mastra.ai/llms.txt)
- [Mastra .well-known skills discovery](https://mastra.ai/.well-known/skills/index.json)

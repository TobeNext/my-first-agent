# Unit 00 Baseline Record

Date: 2026-06-11

## Commands

- `npm run test:workspace`
  - Result: passed.
  - Summary: Mastra unit coverage passed, BFF coverage passed, frontend coverage passed.
- `npm run test:e2e:interview:smoke`
  - Result: failed because the live E2E frontend service was not running.
  - Failure: `E2E service frontend is unreachable at http://localhost:4173: fetch failed`.
- `npm --prefix bff run test:unit`
  - Result: passed.
  - Summary: 36 tests passed, including provider=python URL/body selection.
- Python runtime `python -m pytest`
  - Result: passed.
  - Summary: 4 tests passed.
- Python runtime `python -m ruff check .`
  - Result: passed.
- Python runtime `docker build -t my-first-agent-langgraph:unit-01-06 .`
  - Result: passed after pulling `m.daocloud.io/docker.io/library/python:3.12-slim` and tagging it locally as `python:3.12-slim` because direct Docker Hub auth failed in this environment.

## Golden Fixtures

- `PLAN/fixtures/contracts/unit00-basic-start.json`
- `PLAN/fixtures/contracts/unit00-start-with-jd.json`
- `PLAN/fixtures/contracts/unit00-flow-test-skip.json`

## Phase A Baseline Lock

Date: 2026-06-15

- Added Python contract coverage in
  `../my-first-agent-langgraph/tests/contract/test_unit00_golden_transcripts.py`.
- The test loads all three Unit 00 fixtures from this directory and verifies their
  startup snapshots against `expectedSnapshotSummary`.
- The test also applies the first `userReplies` item for each fixture and verifies
  the current baseline advances to a deterministic follow-up.

This baseline proves the Python provider can parse the golden transcript shapes and
run the current deterministic short-flow behavior. It intentionally does not prove
LLM-generated follow-up parity, Redis-backed async answer evaluation, worker retry
semantics, or final report reduction from LLM evaluation results.

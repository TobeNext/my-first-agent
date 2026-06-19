import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from 'redis';

import {
  downloadInterviewReportMarkdown,
  fetchInterviewReportStatus,
  markInterviewReportRead,
} from '../../frontend/src/services/bff-api';
import type { InterviewReportStatus } from '../../frontend/src/types/agent';

import { withBffRelativeApiBase } from './interview-e2e-client';

const E2E_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(E2E_DIR, '..', '..');
const LANGGRAPH_ROOT = resolve(PROJECT_ROOT, '..', 'my-first-agent-langgraph');
const DEFAULT_E2E_REDIS_URL = 'redis://127.0.0.1:6379';

export interface StartedInterviewReportWorkers {
  readonly stop: () => Promise<void>;
}

export async function startInterviewReportWorkers(): Promise<StartedInterviewReportWorkers> {
  const children = [
    startPythonWorker('answer-evaluation-worker', 'scripts/run_answer_evaluation_worker.py'),
    startPythonWorker('report-generation-worker', 'scripts/run_report_generation_worker.py'),
  ];

  await new Promise((resolveReady) => setTimeout(resolveReady, 1_500));

  return {
    async stop() {
      await Promise.all(children.map((child) => stopWorker(child)));
    },
  };
}

export async function waitForReportStatus(
  threadId: string,
  predicate: (status: InterviewReportStatus) => boolean,
  options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {},
): Promise<InterviewReportStatus> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;
  let lastStatus: InterviewReportStatus | null = null;

  while (Date.now() < deadline) {
    lastStatus = await withBffRelativeApiBase(() => fetchInterviewReportStatus(threadId));
    if (predicate(lastStatus)) {
      return lastStatus;
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, intervalMs));
  }

  throw new Error(
    `Report status for ${threadId} did not satisfy predicate within ${timeoutMs}ms. Last status: ${JSON.stringify(lastStatus)}`,
  );
}

export async function downloadReportMarkdown(threadId: string): Promise<string> {
  const download = await withBffRelativeApiBase(() => downloadInterviewReportMarkdown(threadId));
  return await download.blob.text();
}

export async function markReportRead(threadId: string): Promise<InterviewReportStatus> {
  await withBffRelativeApiBase(() => markInterviewReportRead(threadId));
  return await withBffRelativeApiBase(() => fetchInterviewReportStatus(threadId));
}

export async function readReportManifestFromRedis(threadId: string): Promise<Record<string, unknown> | null> {
  const client = createClient({
    url: process.env.INTERVIEW_E2E_REDIS_URL ?? process.env.REDIS_URL ?? DEFAULT_E2E_REDIS_URL,
  });
  await client.connect();
  try {
    const raw = await client.get(`interview:${threadId}:report:manifest`);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } finally {
    client.destroy();
  }
}

export async function readReportDbSummary(threadId: string): Promise<{
  readonly reportCount: number;
  readonly itemCount: number;
  readonly markdown: string;
}> {
  const databasePath =
    process.env.INTERVIEW_E2E_REPORT_DATABASE_PATH ??
    resolve(LANGGRAPH_ROOT, 'interview_reports.db');

  if (!existsSync(databasePath)) {
    throw new Error(`Report database was not found at ${databasePath}.`);
  }

  const script = [
    'import json, sqlite3, sys',
    'db, thread_id = sys.argv[1], sys.argv[2]',
    'conn = sqlite3.connect(db)',
    'conn.row_factory = sqlite3.Row',
    'row = conn.execute("SELECT id, markdown FROM interview_reports WHERE interview_id = ? AND status = ? LIMIT 1", (thread_id, "succeeded")).fetchone()',
    'if row is None:',
    '    print(json.dumps({"reportCount": 0, "itemCount": 0, "markdown": ""}))',
    'else:',
    '    item_count = conn.execute("SELECT COUNT(*) FROM interview_report_items WHERE report_id = ?", (row["id"],)).fetchone()[0]',
    '    print(json.dumps({"reportCount": 1, "itemCount": item_count, "markdown": row["markdown"]}, ensure_ascii=False))',
  ].join('\n');

  const output = await runPythonInline(script, [databasePath, threadId]);
  return JSON.parse(output) as {
    readonly reportCount: number;
    readonly itemCount: number;
    readonly markdown: string;
  };
}

function startPythonWorker(name: string, scriptPath: string): ChildProcessWithoutNullStreams {
  const child = spawn('python', [scriptPath], {
    cwd: LANGGRAPH_ROOT,
    env: {
      ...process.env,
      PYTHONPATH: 'src',
      MODEL_PROVIDER: process.env.MODEL_PROVIDER ?? 'mock',
      REDIS_URL: process.env.INTERVIEW_E2E_REDIS_URL ?? process.env.REDIS_URL ?? DEFAULT_E2E_REDIS_URL,
    },
    stdio: 'pipe',
    windowsHide: true,
  });
  child.stdout.on('data', (chunk: Buffer) => {
    console.info(`[${name}] ${chunk.toString('utf8').trim()}`);
  });
  child.stderr.on('data', (chunk: Buffer) => {
    console.error(`[${name}] ${chunk.toString('utf8').trim()}`);
  });
  child.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[${name}] exited with code ${code}.`);
    }
    if (signal) {
      console.info(`[${name}] stopped by ${signal}.`);
    }
  });
  return child;
}

async function stopWorker(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.killed) {
    return;
  }

  await new Promise<void>((resolveStopped) => {
    child.once('exit', () => resolveStopped());
    child.kill();
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGKILL');
      }
      resolveStopped();
    }, 2_000);
  });
}

async function runPythonInline(script: string, args: readonly string[]): Promise<string> {
  const child = spawn('python', ['-c', script, ...args], {
    cwd: LANGGRAPH_ROOT,
    env: {
      ...process.env,
      PYTHONPATH: 'src',
      PYTHONIOENCODING: 'utf-8',
    },
    stdio: 'pipe',
    windowsHide: true,
  });
  const chunks: Buffer[] = [];
  const errorChunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => errorChunks.push(chunk));

  const exitCode = await new Promise<number | null>((resolveExit) => {
    child.once('exit', (code) => resolveExit(code));
  });
  const stderr = Buffer.concat(errorChunks).toString('utf8');
  if (exitCode !== 0) {
    throw new Error(`Python inline script failed with code ${exitCode}: ${stderr}`);
  }

  return Buffer.concat(chunks).toString('utf8').trim();
}

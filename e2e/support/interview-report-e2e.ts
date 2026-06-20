import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

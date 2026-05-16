import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const stateFilePath = join(repoRoot, '.git', 'project-architecture-sync-state.json');

const RELEVANT_FILE_PATTERNS = [
  /^src\/.*\.ts$/,
  /^frontend\/.*$/,
  /^bff\/.*$/,
  /^package\.json$/,
  /^README\.md$/,
];

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function isRelevantFile(filePath) {
  return RELEVANT_FILE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function safeRunGit(args) {
  try {
    return runGit(args);
  } catch {
    return '';
  }
}

function parseStatusLine(line) {
  if (!line) {
    return null;
  }

  const statusPrefix = line.slice(0, 3);
  let rawPath = line.slice(3).trim();

  if (statusPrefix.startsWith('R') || statusPrefix.startsWith('C')) {
    const renameParts = rawPath.split(' -> ');
    rawPath = renameParts.at(-1) ?? rawPath;
  }

  if (rawPath.startsWith('"') && rawPath.endsWith('"')) {
    rawPath = rawPath.slice(1, -1);
  }

  return normalizePath(rawPath);
}

function getChangedRelevantFiles() {
  const statusOutput = safeRunGit(['status', '--porcelain=v1', '--untracked-files=all']);
  if (!statusOutput) {
    return [];
  }

  const changedFiles = new Set();

  for (const line of statusOutput.split(/\r?\n/)) {
    const parsedPath = parseStatusLine(line);
    if (parsedPath && isRelevantFile(parsedPath)) {
      changedFiles.add(parsedPath);
    }
  }

  return Array.from(changedFiles).sort();
}

function getFileHash(relativePath) {
  const fullPath = join(repoRoot, relativePath);
  if (!existsSync(fullPath)) {
    return '__missing__';
  }

  const fileBuffer = readFileSync(fullPath);
  return createHash('sha256').update(fileBuffer).digest('hex');
}

function createFileMap(paths) {
  return Object.fromEntries(paths.map((filePath) => [filePath, getFileHash(filePath)]));
}

function loadState() {
  if (!existsSync(stateFilePath)) {
    return {
      baseline: {},
      verifiedFingerprint: null,
      verifiedAt: null,
      verifiedFiles: [],
    };
  }

  try {
    return JSON.parse(readFileSync(stateFilePath, 'utf8'));
  } catch {
    return {
      baseline: {},
      verifiedFingerprint: null,
      verifiedAt: null,
      verifiedFiles: [],
    };
  }
}

function saveState(state) {
  mkdirSync(dirname(stateFilePath), { recursive: true });
  writeFileSync(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function getSessionDeltaMap() {
  const state = loadState();
  const currentFiles = getChangedRelevantFiles();
  const currentMap = createFileMap(currentFiles);
  const deltaEntries = Object.entries(currentMap).filter(([filePath, hash]) => state.baseline[filePath] !== hash);

  return Object.fromEntries(deltaEntries.sort(([left], [right]) => left.localeCompare(right)));
}

function createFingerprint(deltaMap) {
  return createHash('sha256').update(JSON.stringify(deltaMap)).digest('hex');
}

function writeJson(output, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.exit(exitCode);
}

function handleSessionStart() {
  const currentFiles = getChangedRelevantFiles();
  const baseline = createFileMap(currentFiles);

  saveState({
    baseline,
    verifiedFingerprint: null,
    verifiedAt: null,
    verifiedFiles: [],
  });

  writeJson({
    continue: true,
    systemMessage: 'project-architecture-sync baseline captured for this session.',
  });
}

function handleRecord() {
  const deltaMap = getSessionDeltaMap();
  const state = loadState();

  saveState({
    ...state,
    verifiedFingerprint: createFingerprint(deltaMap),
    verifiedAt: new Date().toISOString(),
    verifiedFiles: Object.keys(deltaMap),
  });

  writeJson({
    recorded: true,
    verifiedFiles: Object.keys(deltaMap),
    verifiedAt: new Date().toISOString(),
  });
}

function handleStatus() {
  const deltaMap = getSessionDeltaMap();
  const state = loadState();
  const fingerprint = createFingerprint(deltaMap);

  writeJson({
    needsSync: Object.keys(deltaMap).length > 0 && state.verifiedFingerprint !== fingerprint,
    sessionChangedFiles: Object.keys(deltaMap),
    verifiedFiles: state.verifiedFiles ?? [],
    verifiedAt: state.verifiedAt ?? null,
  });
}

function handleEnforceStop() {
  const deltaMap = getSessionDeltaMap();
  const sessionChangedFiles = Object.keys(deltaMap);

  if (sessionChangedFiles.length === 0) {
    writeJson({ continue: true });
  }

  const state = loadState();
  const currentFingerprint = createFingerprint(deltaMap);

  if (state.verifiedFingerprint === currentFingerprint) {
    writeJson({ continue: true });
  }

  writeJson(
    {
      continue: false,
      stopReason:
        'Architecture sync verification is required before ending the session because code files changed in this session.',
      systemMessage:
        'Run the project-architecture-sync skill, update .github/instructions/project-architecture.instructions.md if needed, then execute `node .github/hooks/scripts/project-architecture-sync-guard.mjs record` to acknowledge the verification. Changed files: ' +
        sessionChangedFiles.join(', '),
    },
    2,
  );
}

const command = process.argv[2] ?? 'status';

switch (command) {
  case 'session-start':
    handleSessionStart();
    break;
  case 'record':
    handleRecord();
    break;
  case 'enforce-stop':
    handleEnforceStop();
    break;
  case 'status':
    handleStatus();
    break;
  default:
    writeJson({
      continue: false,
      stopReason: `Unknown command: ${command}`,
    }, 2);
}
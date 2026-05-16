import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_FILE_NAMES = ['.env.local', '.env'] as const;

let hasAttemptedEnvLoad = false;

function canLoadEnvFiles(): boolean {
  return typeof process.loadEnvFile === 'function';
}

function getSearchDirectories(): string[] {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.cwd(),
    moduleDirectory,
    resolve(moduleDirectory, '..'),
    resolve(moduleDirectory, '../..'),
    resolve(moduleDirectory, '../../..'),
  ];

  return [...new Set(candidates)];
}

export function ensureEnvironmentLoaded(): void {
  if (hasAttemptedEnvLoad) {
    return;
  }

  hasAttemptedEnvLoad = true;
  if (!canLoadEnvFiles()) {
    return;
  }

  for (const directory of getSearchDirectories()) {
    for (const fileName of ENV_FILE_NAMES) {
      const filePath = resolve(directory, fileName);
      if (!existsSync(filePath)) {
        continue;
      }

      process.loadEnvFile(filePath);
    }
  }
}

ensureEnvironmentLoaded();
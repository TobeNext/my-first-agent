import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { getInputOptions, createWatcher } from './node_modules/@mastra/deployer/dist/chunk-AEFF4KNF.js';

const entryFile = resolve('src/mastra/index.ts');
const outputDirectory = resolve('.mastra-watch-repro');
const templateDir = dirname(fileURLToPath(pathToFileURL(resolve('node_modules/mastra/dist/index.js'))));
const templateEntry = join(templateDir, 'templates', 'dev.entry.js');

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(join(outputDirectory, 'output'), { recursive: true });
const inputOptions = await getInputOptions(
  entryFile,
  'node',
  { 'process.env.NODE_ENV': JSON.stringify('development') },
  { sourcemap: true },
);

const watcher = await createWatcher(
  {
    ...inputOptions,
    input: { index: templateEntry },
  },
  {
    dir: join(outputDirectory, 'output'),
    sourcemap: true,
  },
);

await new Promise((resolvePromise, rejectPromise) => {
  const onEvent = async (event) => {
    if (event.code === 'BUNDLE_END') {
      watcher.off('event', onEvent);
      await watcher.close();
      resolvePromise();
    }
    if (event.code === 'ERROR') {
      watcher.off('event', onEvent);
      await watcher.close();
      rejectPromise(event.error);
    }
  };
  watcher.on('event', onEvent);
});

const files = await readdir(join(outputDirectory, 'output'));
console.log(JSON.stringify({ files }, null, 2));

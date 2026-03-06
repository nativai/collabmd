import { cp, mkdir, rm, copyFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(rootDir, 'public');
const clientSourceDir = resolve(rootDir, 'src/client');
const sharedDomainSourceDir = resolve(rootDir, 'src/domain');
const clientOutputDir = resolve(publicDir, 'assets/js');
const sharedDomainOutputDir = resolve(publicDir, 'assets/domain');
const previewWorkerSource = resolve(clientSourceDir, 'application/preview-render-worker.js');
const previewWorkerOutput = resolve(clientOutputDir, 'application/preview-render-worker.js');

async function copyHighlightThemeFiles() {
  const themeDir = resolve(publicDir, 'assets/vendor/highlight');
  await mkdir(themeDir, { recursive: true });

  await copyFile(
    require.resolve('highlight.js/styles/github.min.css'),
    resolve(themeDir, 'github.min.css'),
  );

  await copyFile(
    require.resolve('highlight.js/styles/github-dark.min.css'),
    resolve(themeDir, 'github-dark.min.css'),
  );
}

async function copyMermaidBundle() {
  const mermaidDir = resolve(publicDir, 'assets/vendor/mermaid');
  await mkdir(mermaidDir, { recursive: true });
  await copyFile(
    require.resolve('mermaid/dist/mermaid.min.js'),
    resolve(mermaidDir, 'mermaid.min.js'),
  );
}

async function bundlePreviewWorker() {
  await mkdir(resolve(clientOutputDir, 'application'), { recursive: true });
  await build({
    alias: {
      'highlight.js': resolve(rootDir, 'node_modules/highlight.js/lib/index.js'),
      'markdown-it': resolve(rootDir, 'node_modules/markdown-it/dist/markdown-it.js'),
    },
    bundle: true,
    entryPoints: [previewWorkerSource],
    format: 'esm',
    outfile: previewWorkerOutput,
    platform: 'browser',
    target: ['es2022'],
  });
}

await rm(clientOutputDir, { force: true, recursive: true });
await rm(sharedDomainOutputDir, { force: true, recursive: true });
await mkdir(clientOutputDir, { recursive: true });
await mkdir(sharedDomainOutputDir, { recursive: true });
await cp(clientSourceDir, clientOutputDir, { recursive: true });
await cp(sharedDomainSourceDir, sharedDomainOutputDir, { recursive: true });
await copyHighlightThemeFiles();
await copyMermaidBundle();
await bundlePreviewWorker();

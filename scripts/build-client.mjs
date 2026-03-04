import { mkdir, copyFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { builtinModules, createRequire } from 'module';
import { pathToFileURL } from 'url';

import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(rootDir, 'public');
const clientEntry = resolve(rootDir, 'src/client/main.js');
const outputFile = resolve(publicDir, 'assets/js/app.js');
const isProduction = process.env.NODE_ENV === 'production';
const builtins = new Set([...builtinModules, ...builtinModules.map((moduleName) => `node:${moduleName}`)]);

const nodeModulesResolver = {
  name: 'node-modules-resolver',
  setup(buildContext) {
    buildContext.onResolve({ filter: /^[^./].*/ }, async (args) => {
      if (builtins.has(args.path)) {
        return { path: args.path, external: true };
      }

      try {
        const importerUrl = args.importer
          ? pathToFileURL(args.importer).href
          : pathToFileURL(resolve(rootDir, 'package.json')).href;
        const resolvedUrl = await import.meta.resolve(args.path, importerUrl);

        return {
          path: resolvedUrl.startsWith('file://') ? fileURLToPath(resolvedUrl) : resolvedUrl,
        };
      } catch {
        return null;
      }
    });
  },
};

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

await mkdir(resolve(publicDir, 'assets/js'), { recursive: true });
await copyHighlightThemeFiles();
await copyMermaidBundle();

await build({
  absWorkingDir: rootDir,
  bundle: true,
  conditions: ['browser', 'import', 'default'],
  entryPoints: [clientEntry],
  format: 'esm',
  mainFields: ['browser', 'module', 'main'],
  minify: isProduction,
  outfile: outputFile,
  platform: 'browser',
  plugins: [nodeModulesResolver],
  sourcemap: !isProduction,
  target: ['es2022'],
});

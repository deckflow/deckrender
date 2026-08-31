import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve('tsup'))('esbuild');
const dir = await mkdtemp(path.join(tmpdir(), 'deckrender-browser-consumer-'));
try {
  // No node_modules dependencies or @types/node in this isolated consumer.
  const pkg = path.join(dir, 'node_modules/@deckflow/deckrender');
  await mkdir(path.join(pkg, 'dist/browser'), { recursive: true });
  for (const file of ['package.json', 'dist/browser/index.js', 'dist/browser/index.d.ts']) {
    await copyFile(path.join(root, file), path.join(pkg, file));
  }
  for (const file of ['consumer.ts', 'tsconfig.json']) {
    await copyFile(path.join(root, 'tests/browser-consumer', file), path.join(dir, file));
  }
  execFileSync(
    process.execPath,
    [path.join(root, 'node_modules/typescript-7/bin/tsc'), '-p', path.join(dir, 'tsconfig.json')],
    { stdio: 'inherit' }
  );
  const built = await build({
    stdin: {
      contents: 'export { createRenderer, render } from "@deckflow/deckrender/browser";',
      resolveDir: dir,
      loader: 'ts',
    },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    metafile: true,
  });
  assert.equal(
    built.metafile.outputs['stdin.js'].imports.length,
    0,
    'Browser bundle must have no external runtime imports'
  );
  assert(!Object.keys(built.metafile.inputs).some((file) => /playwright|office2html|pdfjs|node:/.test(file)));
  const declarations = await readFile(path.join(pkg, 'dist/browser/index.d.ts'), 'utf8');
  assert(!/reference types="node"|from ['"](?:node:|@deckops)|\bNodeJS\b/.test(declarations));
  // Native module import in Node must also be side-effect free (SSR import safety).
  const imported = await import(new URL('../dist/browser/index.js', import.meta.url));
  assert.equal(typeof imported.createRenderer, 'function');
  console.log(
    `Browser consumer passed: isolated DOM-only types, browser bundle without polyfills, SSR import. ${gzipSync(built.outputFiles[0].contents).length} bytes gzip.`
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

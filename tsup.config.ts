import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node18',
  dts: { banner: '/// <reference types="node" />' },
  clean: true,
  sourcemap: true,
  splitting: false,
  // Local-engine dependencies stay optional so cloud-only installations can
  // use --omit=optional without bloating the CLI bundle.
  external: ['playwright-core', 'pdfjs-dist', 'pdf-lib'],
  banner: { js: '' },
});

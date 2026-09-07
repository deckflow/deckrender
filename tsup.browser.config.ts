import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/browser.ts' },
  outDir: 'dist/browser',
  tsconfig: 'tsconfig.browser.json',
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  // Bundle the SDK's maintained browser entry; no source rewriting bridge.
  noExternal: [/.*/],
  esbuildOptions(options) {
    options.alias = { ...options.alias, '@deckflow/decktools-sdk': '@deckflow/decktools-sdk/browser' };
  },
  dts: true,
  clean: true,
  splitting: false,
  minify: true,
  sourcemap: false,
});

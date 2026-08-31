import { defineConfig } from 'tsup';
import { deckopsBrowserPlugin } from './scripts/deckops-browser.js';

export default defineConfig({
  entry: { index: 'src/browser.ts' },
  outDir: 'dist/browser',
  tsconfig: 'tsconfig.browser.json',
  format: ['esm'],
  platform: 'browser',
  target: 'es2022',
  // Ship the audited upstream browser implementation, not a broken external import.
  noExternal: [/.*/],
  esbuildPlugins: [deckopsBrowserPlugin()],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
});

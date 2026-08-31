import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const result = spawnSync(
  process.execPath,
  [fileURLToPath(new URL('node_modules/vitest/vitest.mjs', root)), 'run', 'tests/e2e/browser.test.ts'],
  {
    cwd: fileURLToPath(root),
    stdio: 'inherit',
    env: { ...process.env, DECKRENDER_BROWSER_E2E: '1' },
  }
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

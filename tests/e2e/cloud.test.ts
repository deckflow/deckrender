import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const describeCloud = process.env.DECKRENDER_E2E === '1' ? describe : describe.skip;

describeCloud('real DeckOps guest smoke test', () => {
  let workDir: string;

  beforeAll(async () => {
    await fs.access(CLI).catch(() => {
      throw new Error(`${CLI} is missing. Run \`pnpm build\` before the cloud smoke test.`);
    });
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-cloud-e2e-'));
  });

  afterAll(async () => {
    await fs.rm(workDir, { recursive: true, force: true });
  });

  it('renders stdin HTML to PNG without credentials', async () => {
    const configDir = path.join(workDir, 'config');
    const output = path.join(workDir, 'guest.png');
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DECKFLOW_CONFIG_DIR: configDir,
      DECKOPS_CONFIG_DIR: configDir,
      DECKRENDER_CONFIG_DIR: configDir,
      NO_COLOR: '1',
    };

    for (const key of [
      'DECKRENDER_API_KEY',
      'DECKFLOW_API_KEY',
      'DECKHTML_API_KEY',
      'DECKRENDER_TOKEN',
      'DECKFLOW_TOKEN',
      'DECKRENDER_SPACE_ID',
      'DECKFLOW_SPACE_ID',
    ]) {
      delete env[key];
    }

    // Allow testing a compatible deployment without changing the normal
    // credential precedence or accidentally inheriting a developer's base.
    delete env.DECKFLOW_API_BASE;
    env.DECKRENDER_API_BASE = process.env.DECKRENDER_E2E_API_BASE ?? 'https://app.deckflow.com/v1';

    const child = run(
      'node',
      [CLI, '-', '--from', 'html', '--format', 'image', '--output', output, '--json'],
      { cwd: workDir, env, timeout: 360_000, maxBuffer: 10 * 1024 * 1024 }
    );
    child.child.stdin?.end('<!doctype html><h1>DeckRender guest smoke test</h1>');

    const { stdout } = await child;
    const result = JSON.parse(stdout);
    expect(result).toMatchObject({
      ok: true,
      format: 'image',
      engine: 'cloud',
      route: ['convertor.html2png'],
    });

    const bytes = await fs.readFile(output);
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }, 360_000);
});

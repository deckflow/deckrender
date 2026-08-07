import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Drive the built binary.
 *
 * These cover the contract the unit tests cannot: commander wiring, the
 * stdout/stderr split, and the exit codes scripts branch on. Every case here
 * fails before any network call, so the suite stays hermetic.
 */
async function cli(args: string[], options: { input?: string } = {}): Promise<CliResult> {
  try {
    const child = run('node', [CLI, ...args], {
      env: { ...process.env, DECKRENDER_CONFIG_DIR: configDir, DECKFLOW_CONFIG_DIR: configDir },
    });
    if (options.input !== undefined) {
      child.child.stdin?.end(options.input);
    }
    const { stdout, stderr } = await child;
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

let configDir: string;
let workDir: string;

beforeAll(async () => {
  await fs.access(CLI).catch(() => {
    throw new Error(`${CLI} is missing. Run \`pnpm build\` before the e2e suite.`);
  });
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-e2e-'));
  configDir = path.join(workDir, 'config');
});

afterAll(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('exit codes', () => {
  it('succeeds for --version', async () => {
    const result = await cli(['--version']);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exits 2 with no input', async () => {
    expect((await cli([])).code).toBe(2);
  });

  it('exits 2 for a missing file', async () => {
    const result = await cli([path.join(workDir, 'nope.pptx')]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Input not found');
  });

  it('exits 2 for an unsupported format pair', async () => {
    const input = path.join(workDir, 'notes.docx');
    await fs.writeFile(input, 'fixture');
    const result = await cli([input, '--format', 'video']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Cannot render .docx to video');
  });

  it('exits 2 for a combination that is planned but not built', async () => {
    const input = path.join(workDir, 'book.xlsx');
    await fs.writeFile(input, 'fixture');
    const result = await cli([input, '--format', 'pdf']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('coming soon');
  });

  it('exits 2 for conflicting output modes', async () => {
    const result = await cli(['x.pptx', '--quiet', '--verbose']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('--quiet conflicts with --verbose');
  });

  it('exits 2 for video tuning flags the backend cannot honour', async () => {
    const result = await cli(['deck.pptx', '--format', 'video', '--fps', '30']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('convertor.ppt2video accepts no parameters');
  });

  it('exits 2 when stdin has no --from', async () => {
    const result = await cli(['-'], { input: '<html></html>' });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('requires an explicit source format');
  });

  // Commander exits 1 on its own parse failures by default. These assert the
  // exitOverride in cli.ts maps them onto the documented usage code instead.
  it.each([
    [['x.pptx', '--nonsense'], 'unknown flag'],
    [['--format', 'nope', 'x.pptx'], 'invalid enum value'],
    [['config', 'set', 'profile', 'bogus'], 'invalid config value'],
    [['config', 'set', 'width', 'abc'], 'non-numeric config value'],
  ])('exits 2 for %j (%s)', async (args) => {
    expect((await cli(args as string[])).code).toBe(2);
  });

  it('lists the allowed values when a config value is rejected', async () => {
    const result = await cli(['config', 'set', 'quality', 'ultra']);
    expect(result.stderr).toContain('Allowed values: low, medium, high');
  });
});

describe('output streams', () => {
  it('keeps raw stdout byte-for-byte pure', async () => {
    const input = path.join(workDir, 'raw.pdf');
    const contents = '%PDF-deckrender-raw-stream\n';
    await fs.writeFile(input, contents);

    const result = await cli([input, '--format', 'pdf', '--output', '-']);

    expect(result.code).toBe(0);
    expect(result.stdout).toBe(contents);
  });

  it('rejects combining raw stdout with --json before rendering', async () => {
    const input = path.join(workDir, 'raw.html');
    await fs.writeFile(input, '<html></html>');

    const result = await cli([input, '-o', '-', '--json']);

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(lastJsonDocument(result.stderr)).toMatchObject({
      ok: false,
      error: { code: 'usage_error' },
    });
  });

  it('keeps stdout pure JSON on failure', async () => {
    const input = path.join(workDir, 'notes2.docx');
    await fs.writeFile(input, 'fixture');
    const result = await cli([input, '--format', 'video', '--json']);

    expect(result.stdout).toBe('');
    // stderr may carry warning documents ahead of the envelope, so read the
    // last one rather than assuming a single document.
    expect(lastJsonDocument(result.stderr)).toMatchObject({
      ok: false,
      error: { code: 'unsupported_format' },
    });
  });

  it('prints the matrix as JSON when asked', async () => {
    const result = await cli(['formats', '--json']);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.matrix.pptx.video).toMatchObject({ supported: true, kind: 'direct' });
    expect(payload.matrix.pdf.pdf).toMatchObject({ kind: 'passthrough' });
    expect(payload.matrix.pages.image).toMatchObject({ supported: true, kind: 'local' });
    expect(payload.matrix.html.video).toMatchObject({
      supported: true,
      kind: 'derived',
      tasks: ['convertor.html2pptx', 'convertor.ppt2video'],
    });

    // "planned" is what separates a coming-soon combination from a dead end.
    expect(payload.matrix.pdf.video).toMatchObject({ supported: false, planned: true });
    expect(payload.matrix.xlsx.video).toEqual({ supported: false, planned: false });
  });
});

describe('config', () => {
  it('stores render defaults separately from shared credentials', async () => {
    expect((await cli(['config', 'set', 'profile', 'web'])).code).toBe(0);

    const list = await cli(['config', 'list', '--json']);
    const payload = JSON.parse(list.stdout);
    expect(payload.defaults).toMatchObject({ profile: 'web' });
    expect(payload.files.config).toContain('config.json');
    expect(payload.files.credentials).toContain('credentials');
  });

  it('rejects an unknown key', async () => {
    const result = await cli(['config', 'set', 'nonsense', 'x']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown config key');
  });

  it('writes the api key into the shared credential file and masks it', async () => {
    expect((await cli(['config', 'set', 'api-key', 'sk-abcdefghijklmnop'])).code).toBe(0);

    const stored = JSON.parse(await fs.readFile(path.join(configDir, 'credentials'), 'utf-8'));
    expect(stored.apiKey).toBe('sk-abcdefghijklmnop');

    const list = JSON.parse((await cli(['config', 'list', '--json'])).stdout);
    expect(list.credentials.apiKey).not.toContain('defghijkl');
    expect(list.credentials.sources.apiKey).toBe('file:~/.deckflow/credentials');
  });

  it('reports guest mode before login', async () => {
    await cli(['config', 'unset', 'api-key']);
    const result = await cli(['auth', 'status', '--json']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ authenticated: false });
  });
});

describe('removed flags', () => {
  it('no longer accepts --mode', async () => {
    const input = path.join(workDir, 'deck.pptx');
    await fs.writeFile(input, 'fixture');

    const result = await cli([input, '--mode', 'cloud']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("unknown option '--mode'");
  });

  it('does not offer mode as a config key', async () => {
    const result = await cli(['config', 'set', 'mode', 'cloud']);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Unknown config key');
  });
});

/**
 * stderr is newline-delimited JSON: warnings first, then the error envelope.
 * Only stdout is guaranteed to be a single document.
 */
function lastJsonDocument(stderr: string): unknown {
  const starts = [...stderr.matchAll(/^\{/gm)].map((match) => match.index ?? 0);
  const last = starts.at(-1);
  expect(last).toBeDefined();
  return JSON.parse(stderr.slice(last));
}

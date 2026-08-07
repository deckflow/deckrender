import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hasCredentials,
  maskSecret,
  readSharedCredentials,
  resolveCredentials,
  writeSharedCredentials,
} from '../../src/config/credentials.js';

/**
 * The five-level resolution chain spans three files and three env var groups.
 * It is the part most likely to break silently during refactors, and breaking
 * it breaks the PRD's hard requirement that DeckHTML and DeckRender share auth.
 */
const ENV_KEYS = [
  'DECKFLOW_CONFIG_DIR',
  'DECKRENDER_CONFIG_DIR',
  'DECKOPS_CONFIG_DIR',
  'DECKRENDER_API_KEY',
  'DECKFLOW_API_KEY',
  'DECKHTML_API_KEY',
  'DECKRENDER_TOKEN',
  'DECKFLOW_TOKEN',
  'DECKRENDER_SPACE_ID',
  'DECKFLOW_SPACE_ID',
  'DECKRENDER_API_BASE',
  'DECKFLOW_API_BASE',
];

let root: string;
let saved: Record<string, string | undefined>;

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }

  root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-cred-'));
  process.env.DECKFLOW_CONFIG_DIR = path.join(root, 'deckflow');
  process.env.DECKRENDER_CONFIG_DIR = path.join(root, 'deckrender');
  process.env.DECKOPS_CONFIG_DIR = path.join(root, 'deckops');
});

afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await fs.rm(root, { recursive: true, force: true });
});

async function writeDeckflow(data: unknown): Promise<void> {
  const dir = process.env.DECKFLOW_CONFIG_DIR!;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'credentials'), JSON.stringify(data));
}

async function writeDeckops(data: unknown): Promise<void> {
  const dir = process.env.DECKOPS_CONFIG_DIR!;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(data));
}

describe('resolveCredentials precedence', () => {
  it('falls back to the default api base when nothing is configured', async () => {
    const resolved = await resolveCredentials();
    expect(resolved.apiKey).toBeUndefined();
    expect(resolved.token).toBeUndefined();
    expect(resolved.apiBase).toBe('https://app.deckflow.com/v1');
    expect(resolved.sources.apiBase).toBe('default');
    expect(hasCredentials(resolved)).toBe(false);
  });

  it('reads the shared DeckFlow credential file', async () => {
    await writeDeckflow({ apiKey: 'from-file' });
    const resolved = await resolveCredentials();
    expect(resolved.apiKey).toBe('from-file');
    expect(resolved.sources.apiKey).toBe('file:~/.deckflow/credentials');
  });

  it('reads a DeckOps CLI login as a fallback', async () => {
    await writeDeckops({ token: 'deckops-token', spaceId: 'space-1' });
    const resolved = await resolveCredentials();
    expect(resolved.token).toBe('deckops-token');
    expect(resolved.spaceId).toBe('space-1');
    expect(resolved.sources.token).toBe('file:~/.deckops/config.json');
  });

  it('prefers the shared file over the DeckOps fallback', async () => {
    await writeDeckflow({ token: 'shared' });
    await writeDeckops({ token: 'deckops' });
    expect((await resolveCredentials()).token).toBe('shared');
  });

  it('picks up a machine already configured for DeckHTML', async () => {
    process.env.DECKHTML_API_KEY = 'deckhtml-key';
    const resolved = await resolveCredentials();
    expect(resolved.apiKey).toBe('deckhtml-key');
    expect(resolved.sources.apiKey).toBe('env:DECKHTML_API_KEY');
  });

  it('orders the api key env vars deckrender > deckflow > deckhtml', async () => {
    process.env.DECKHTML_API_KEY = 'c';
    expect((await resolveCredentials()).apiKey).toBe('c');

    process.env.DECKFLOW_API_KEY = 'b';
    expect((await resolveCredentials()).apiKey).toBe('b');

    process.env.DECKRENDER_API_KEY = 'a';
    expect((await resolveCredentials()).apiKey).toBe('a');
  });

  it('lets the environment win over the shared file', async () => {
    await writeDeckflow({ apiKey: 'from-file' });
    process.env.DECKFLOW_API_KEY = 'from-env';
    expect((await resolveCredentials()).apiKey).toBe('from-env');
  });

  it('lets an explicit override win over everything', async () => {
    await writeDeckflow({ apiKey: 'from-file' });
    process.env.DECKFLOW_API_KEY = 'from-env';
    const resolved = await resolveCredentials({ apiKey: 'from-flag' });
    expect(resolved.apiKey).toBe('from-flag');
    expect(resolved.sources.apiKey).toBe('flag');
  });

  it('resolves each field independently', async () => {
    process.env.DECKFLOW_API_KEY = 'env-key';
    await writeDeckops({ spaceId: 'deckops-space' });
    const resolved = await resolveCredentials();
    expect(resolved.apiKey).toBe('env-key');
    expect(resolved.spaceId).toBe('deckops-space');
    expect(resolved.sources.apiKey).toBe('env:DECKFLOW_API_KEY');
    expect(resolved.sources.spaceId).toBe('file:~/.deckops/config.json');
  });

  it('ignores blank environment values', async () => {
    await writeDeckflow({ apiKey: 'from-file' });
    process.env.DECKFLOW_API_KEY = '   ';
    expect((await resolveCredentials()).apiKey).toBe('from-file');
  });

  it('survives a corrupt credential file', async () => {
    const dir = process.env.DECKFLOW_CONFIG_DIR!;
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'credentials'), 'not json at all');

    const resolved = await resolveCredentials();
    expect(resolved.apiKey).toBeUndefined();
    expect(resolved.token).toBeUndefined();
    expect(resolved.apiBase).toBe('https://app.deckflow.com/v1');
  });
});

describe('writeSharedCredentials', () => {
  it('creates the file with owner-only permissions', async () => {
    const file = await writeSharedCredentials({ token: 'abc' });
    const stat = await fs.stat(file);
    expect(stat.mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700);
  });

  it('preserves keys written by other DeckFlow tools', async () => {
    await writeDeckflow({ apiKey: 'existing', deckhtmlOnlyField: 'keep me' });
    await writeSharedCredentials({ token: 'new-token' });

    const raw = JSON.parse(
      await fs.readFile(path.join(process.env.DECKFLOW_CONFIG_DIR!, 'credentials'), 'utf-8')
    );
    expect(raw).toEqual({ apiKey: 'existing', deckhtmlOnlyField: 'keep me', token: 'new-token' });
  });

  it('deletes a field when passed null', async () => {
    await writeSharedCredentials({ token: 'abc', apiKey: 'def' });
    await writeSharedCredentials({ token: null });
    expect(await readSharedCredentials()).toEqual({ apiKey: 'def' });
  });

  it('round-trips through resolveCredentials', async () => {
    await writeSharedCredentials({ apiKey: 'stored-key', spaceId: 'stored-space' });
    const resolved = await resolveCredentials();
    expect(resolved.apiKey).toBe('stored-key');
    expect(resolved.spaceId).toBe('stored-space');
  });
});

describe('maskSecret', () => {
  it('keeps a short secret unreadable', () => {
    expect(maskSecret('abcd')).toBe('****');
  });

  it('shows only the ends of a long secret', () => {
    const masked = maskSecret('sk-1234567890abcdef');
    expect(masked.startsWith('sk-1')).toBe(true);
    expect(masked.endsWith('cdef')).toBe(true);
    expect(masked).not.toContain('567890');
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIError, type CreateDeckOptions, type DeckClient } from '@deckops/sdk';
import { createFakeClient, frames } from './fake-client.js';

/**
 * A credential the backend rejects is not a credential.
 *
 * The render carries on as a guest instead of failing: an expired login, or a
 * token another DeckFlow tool left in `~/.deckops/config.json`, must not break
 * the promise that rendering works with no setup at all. Agents see this where
 * an interactive terminal does not, and cannot diagnose invisible machine state.
 *
 * Guest tasks are parked until started explicitly, so the retried engine has to
 * start them — the whole point of dropping the credential is lost if the task
 * then sits pending forever.
 */
const deckCalls: CreateDeckOptions[] = [];
let clients: DeckClient[] = [];

vi.mock('@deckops/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deckops/sdk')>();
  return {
    ...actual,
    createDeck: (options: CreateDeckOptions = {}) => {
      deckCalls.push(options);
      const client = clients.shift();
      if (!client) {
        throw new Error(`createDeck called ${deckCalls.length} times, but no client was queued`);
      }
      return client;
    },
  };
});

const { createRenderer } = await import('../../src/core/renderer.js');

const ENV_KEYS = [
  'DECKFLOW_CONFIG_DIR',
  'DECKRENDER_CONFIG_DIR',
  'DECKOPS_CONFIG_DIR',
  'DECKRENDER_API_KEY',
  'DECKFLOW_API_KEY',
  'DECKHTML_API_KEY',
  'DECKRENDER_TOKEN',
  'DECKFLOW_TOKEN',
];

let workDir: string;
let saved: Record<string, string | undefined>;
const originalFetch = globalThis.fetch;

/** A client that rejects everything with the backend's 401. */
function unauthorizedClient(): DeckClient {
  const reject = async (): Promise<never> => {
    throw new APIError('Authentication failed', 401, undefined, 'req-401');
  };
  return {
    tasks: { create: reject, start: reject, wait: reject, down: reject },
    files: { upload: reject },
  } as unknown as DeckClient;
}

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }

  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-guest-'));
  process.env.DECKFLOW_CONFIG_DIR = path.join(workDir, 'deckflow');
  process.env.DECKRENDER_CONFIG_DIR = path.join(workDir, 'deckrender');
  process.env.DECKOPS_CONFIG_DIR = path.join(workDir, 'deckops');

  deckCalls.length = 0;
  clients = [];

  globalThis.fetch = vi.fn(
    async () => new Response(new TextEncoder().encode('bytes'), { status: 200 })
  ) as typeof fetch;
});

afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  await fs.rm(workDir, { recursive: true, force: true });
});

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data));
}

async function deck(): Promise<string> {
  const file = path.join(workDir, 'deck.pptx');
  await fs.writeFile(file, 'fixture');
  return file;
}

describe('credential rejected by the backend', () => {
  it('retries in guest mode instead of failing', async () => {
    await writeJson(path.join(workDir, 'deckops', 'config.json'), {
      token: 'stale-token',
      spaceId: 'space-from-deckops',
    });
    const working = createFakeClient({ results: { 'convertor.ppt2image': frames(2) } });
    clients = [unauthorizedClient(), working.client];

    const warnings: string[] = [];
    const result = await createRenderer({ onWarning: (message) => warnings.push(message) }).render({
      input: await deck(),
      format: 'image',
      out: path.join(workDir, 'out'),
    });

    expect(result.ok).toBe(true);
    expect(result.pages).toBe(2);
    expect(warnings.join('\n')).toMatch(/guest mode/);
  });

  it('sends nothing from the rejected credential on the retry', async () => {
    await writeJson(path.join(workDir, 'deckops', 'config.json'), {
      token: 'stale-token',
      spaceId: 'space-from-deckops',
    });
    const working = createFakeClient({ results: { 'convertor.ppt2image': frames(1) } });
    clients = [unauthorizedClient(), working.client];

    await createRenderer({}).render({
      input: await deck(),
      format: 'image',
      out: path.join(workDir, 'out'),
    });

    expect(deckCalls).toHaveLength(2);
    expect(deckCalls[0]).toMatchObject({ token: 'stale-token', spaceId: 'space-from-deckops' });
    // The spaceId belongs to the rejected credential's workspace, so it cannot
    // travel with the guest retry either.
    expect(deckCalls[1]?.token).toBeUndefined();
    expect(deckCalls[1]?.spaceId).toBeUndefined();
    expect(deckCalls[1]?.apiKey).toBeUndefined();
  });

  it('names where the rejected credential came from', async () => {
    await writeJson(path.join(workDir, 'deckops', 'config.json'), { token: 'stale-token' });
    const working = createFakeClient({ results: { 'convertor.ppt2image': frames(1) } });
    clients = [unauthorizedClient(), working.client];

    const warnings: string[] = [];
    await createRenderer({ onWarning: (message) => warnings.push(message) }).render({
      input: await deck(),
      format: 'image',
      out: path.join(workDir, 'out'),
    });

    expect(warnings.join('\n')).toMatch(/~\/\.deckops\/config\.json/);
  });

  it('starts the retried tasks explicitly, as guest tasks require', async () => {
    await writeJson(path.join(workDir, 'deckops', 'config.json'), { token: 'stale-token' });
    const working = createFakeClient({ results: { 'convertor.ppt2image': frames(1) } });
    clients = [unauthorizedClient(), working.client];

    await createRenderer({}).render({
      input: await deck(),
      format: 'image',
      out: path.join(workDir, 'out'),
    });

    expect(working.started).toHaveLength(1);
  });
});

describe('every credential source', () => {
  it.each([
    [
      'an expired `deckrender auth login`',
      async () => writeJson(path.join(workDir, 'deckflow', 'credentials'), { token: 'expired-login' }),
    ],
    [
      'an exported API key',
      async () => {
        process.env.DECKFLOW_API_KEY = 'expired-key';
      },
    ],
    [
      "another tool's leftover token",
      async () => writeJson(path.join(workDir, 'deckops', 'config.json'), { token: 'stale' }),
    ],
  ])('falls back to guest for %s', async (_label, arrange) => {
    await arrange();
    const working = createFakeClient({ results: { 'convertor.ppt2image': frames(1) } });
    clients = [unauthorizedClient(), working.client];

    const result = await createRenderer({}).render({
      input: await deck(),
      format: 'image',
      out: path.join(workDir, 'out'),
    });

    expect(result.ok).toBe(true);
    expect(deckCalls).toHaveLength(2);
  });

  it('drops a spaceId that outlived its login', async () => {
    // A 403 naming the caller's own data is the same answer as a 401: the
    // workspace is real, it is just not this caller's any more.
    await writeJson(path.join(workDir, 'deckflow', 'credentials'), {
      token: 'expired-login',
      spaceId: 'space-from-old-login',
    });
    const forbidden = async (): Promise<never> => {
      throw new APIError('You can only operate your own data', 403, undefined, 'req-403');
    };
    const working = createFakeClient({ results: { 'convertor.ppt2image': frames(1) } });
    clients = [{ tasks: {}, files: { upload: forbidden } } as unknown as DeckClient, working.client];

    const result = await createRenderer({}).render({
      input: await deck(),
      format: 'image',
      out: path.join(workDir, 'out'),
    });

    expect(result.ok).toBe(true);
    expect(deckCalls[1]?.spaceId).toBeUndefined();
  });

  it('gives up rather than looping when guest is rejected too', async () => {
    await writeJson(path.join(workDir, 'deckops', 'config.json'), { token: 'stale' });
    clients = [unauthorizedClient(), unauthorizedClient()];

    await expect(
      createRenderer({}).render({
        input: await deck(),
        format: 'image',
        out: path.join(workDir, 'out'),
      })
    ).rejects.toMatchObject({ code: 'auth_error' });

    expect(deckCalls).toHaveLength(2);
  });
});

describe('failures that are not a bad credential', () => {
  it('does not retry a payment failure as guest', async () => {
    await writeJson(path.join(workDir, 'deckops', 'config.json'), { token: 'stale-token' });
    const paymentRequired = async (): Promise<never> => {
      throw new APIError('Payment required', 402, undefined, 'req-402');
    };
    clients = [
      { tasks: {}, files: { upload: paymentRequired } } as unknown as DeckClient,
      createFakeClient({ results: {} }).client,
    ];

    await expect(
      createRenderer({}).render({
        input: await deck(),
        format: 'image',
        out: path.join(workDir, 'out'),
      })
    ).rejects.toMatchObject({ code: 'auth_error' });

    // A workspace out of balance is a real answer, not a bad credential.
    expect(deckCalls).toHaveLength(1);
  });
});

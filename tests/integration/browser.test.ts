import { File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { APIError } from '@deckops/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRenderer,
  render,
  type BrowserInput,
  type BrowserOneShotRenderOptions,
  type BrowserRenderOptions,
  type BrowserRendererOptions,
} from '../../src/browser.js';
import { createFakeClient, frames, singleFile, type FakeClient } from './fake-client.js';

const createDeck = vi.hoisted(() => vi.fn());
vi.mock('@deckops/sdk', async (original) => ({
  ...(await original<typeof import('@deckops/sdk')>()),
  createDeck,
}));

let fake: FakeClient;
const input = { data: new Uint8Array([1, 2, 3]), name: 'deck.pptx' };

beforeEach(() => {
  fake = createFakeClient({ results: { 'convertor.ppt2image': frames(3) } });
  createDeck.mockReset().mockReturnValue(fake.client);
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('artifact-bytes', { headers: { 'content-type': 'image/png' } }))
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('browser cloud-only renderer', () => {
  it('uploads a real File and returns ordered URLs without downloading final artifacts', async () => {
    const file = new NodeFile(['pptx-bytes'], 'deck.pptx') as unknown as File;
    const phases: string[] = [];
    const result = await createRenderer({ token: 'user-token' }).render({
      input: file,
      pages: '2-3',
      onProgress: (event) => phases.push(event.phase),
    });
    expect(result).toMatchObject({
      ok: true,
      engine: 'cloud',
      input: 'deck.pptx',
      pages: 3,
      format: 'image',
    });
    expect(result.route).toEqual(['convertor.ppt2image']);
    expect(result.outputs.map((output) => output.page)).toEqual([2, 3]);
    expect(result.outputs[0]).toMatchObject({
      url: 'https://fake.test/frame-2.png',
      mimeType: 'image/png',
      width: 1920,
    });
    expect(result.outputs[0]).not.toHaveProperty('file');
    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]?.name).toBe('deck.pptx');
    expect(new TextDecoder().decode(fake.uploads[0]?.input as Uint8Array)).toBe('pptx-bytes');
    expect(fetch).not.toHaveBeenCalled();
    expect(phases).toEqual(expect.arrayContaining(['resolve', 'plan', 'upload', 'task', 'wait']));
    expect(phases).not.toContain('write');
    expect(fake.started).toEqual([]);
    await expect(result.outputs[0]!.blob().then((blob) => blob.text())).resolves.toBe('artifact-bytes');
    expect(fetch).toHaveBeenCalledWith('https://fake.test/frame-2.png', { credentials: 'omit' });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    result.dispose();
    result.dispose();
    expect(revoke).not.toHaveBeenCalled();
  });

  it.each([
    { data: new Blob(['bytes']), name: 'deck.pptx' },
    { data: new Uint8Array([1, 2]).buffer, name: 'deck.PPTX' },
    input,
  ])('accepts named binary input: $name', async (input) => {
    await render({ token: 'user-token', input });
    expect(fake.uploads[0]?.input).toBeInstanceOf(Uint8Array);
  });

  it.each(['report?draft.pptx', 'report.pdf?draft.pptx', 'deck:review#v2.pptx'])(
    'infers the actual filename extension without parsing it as a URL: %s',
    async (name) => {
      const file = new NodeFile(['pptx-bytes'], name) as unknown as File;
      const result = await render({ token: 'user-token', input: file });
      expect(result.route).toEqual(['convertor.ppt2image']);
      expect(fake.uploads[0]?.name).toBe(name);
    }
  );

  it.each([
    [
      { html: '<html><head></head><img src="slide.png"></html>', baseUrl: 'https://example.test/deck/' },
      'input.html',
      'convertor.html2png',
    ],
    [{ markdown: '# Title' }, 'input.md', 'convertor.markdown2png'],
    [{ data: new Blob(['# Title']), name: 'notes.markdown' }, 'input.md', 'convertor.markdown2png'],
  ] as const)('uploads inline text as a file', async (input, name, task) => {
    fake = createFakeClient({ results: { [task]: singleFile('output.png') } });
    createDeck.mockReturnValue(fake.client);
    await render({ token: 'user-token', input });
    expect(fake.uploads[0]?.name).toBe(name);
    expect(fake.tasks[0]?.type).toBe(task);
    if ('html' in input) {
      expect(new TextDecoder().decode(fake.uploads[0]?.input as Uint8Array)).toContain(
        '<base href="https://example.test/deck/">'
      );
    }
  });

  it('uses existing chained routes and filters before per-page WebP conversion', async () => {
    fake = createFakeClient({
      results: {
        'convertor.doc2pdf': singleFile('intermediate.pdf'),
        'convertor.pdf2image': frames(3),
        'image.convertWebp': (call: number) => singleFile(`out-${call}.webp`),
      },
    });
    createDeck.mockReturnValue(fake.client);
    const result = await render({
      token: 'user-token',
      input: { ...input, name: 'report.docx' },
      imageFormat: 'webp',
      pages: '2',
    });
    expect(result.route).toEqual(['convertor.doc2pdf', 'convertor.pdf2image', 'image.convertWebp']);
    expect(result.pages).toBe(3);
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]).toMatchObject({ page: 2, ext: '.webp' });
    expect(fake.uploads).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(2); // intermediates only
  });

  it('returns explicit capability and option failures before any upload', async () => {
    await expect(render({ guest: true, input: { ...input, name: 'sheet.xlsx' } })).rejects.toMatchObject({
      code: 'not_implemented',
    });
    await expect(render({ guest: true, input, format: 'pdf', width: 100 })).rejects.toMatchObject({
      code: 'unsupported_option',
    });
    expect(createDeck).not.toHaveBeenCalled();
  });

  it('preserves route caveats and warning callbacks', async () => {
    fake = createFakeClient({
      results: {
        'convertor.html2pptx': { target: singleFile('deck.pptx') },
        'convertor.ppt2pdf': singleFile('deck.pdf'),
      },
    });
    createDeck.mockReturnValue(fake.client);
    const warn = vi.fn();
    const result = await render({
      token: 'user-token',
      input: { html: '<h1>Title</h1>' },
      format: 'pdf',
      onWarning: warn,
    });
    expect(result.caveat).toContain('rebuilt as PPTX');
    expect(warn).toHaveBeenCalledWith(result.caveat);
  });
});

describe('browser authentication boundaries', () => {
  it('keeps the in-memory guest identity stable across one-shot calls', async () => {
    await render({ guest: true, input });
    await render({ guest: true, input });
    expect(createDeck.mock.calls[0]?.[0].authUuid).toBe(createDeck.mock.calls[1]?.[0].authUuid);
  });
  it('reports an actionable error outside a secure browser context', async () => {
    vi.stubGlobal('crypto', undefined);
    await expect(render({ guest: true, input })).rejects.toMatchObject({
      code: 'usage_error',
      message: expect.stringContaining('HTTPS or localhost'),
    });
    expect(createDeck).not.toHaveBeenCalled();
  });
  it('requires a token unless guest mode is explicitly enabled', async () => {
    await expect(createRenderer().render({ input })).rejects.toMatchObject({ code: 'auth_error' });
    await expect(createRenderer({ getToken: () => undefined }).render({ input })).rejects.toMatchObject({
      code: 'auth_error',
    });
    expect(createDeck).not.toHaveBeenCalled();
  });

  it('starts explicitly opted-in guest tasks, with no credentials', async () => {
    await render({ guest: true, input });
    expect(fake.started).toEqual(['task-1']);
    expect(createDeck.mock.calls[0]?.[0]).toMatchObject({
      token: undefined,
      spaceId: undefined,
      authUuid: expect.any(String),
    });
  });

  it.each([401, 403, 402])('does not re-upload or switch identity after HTTP %i', async (status) => {
    const upload = vi.spyOn(fake.client.files, 'upload').mockRejectedValue(new APIError('denied', status));
    await expect(render({ token: 'stale-token', input })).rejects.toMatchObject({
      code: status === 403 ? 'conversion_error' : 'auth_error',
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(createDeck).toHaveBeenCalledTimes(1);
    expect(fake.started).toEqual([]);
  });

  it('provides application-oriented auth errors, not CLI instructions', async () => {
    vi.spyOn(fake.client.files, 'upload').mockRejectedValue(new APIError('expired', 401));
    await expect(render({ token: 'stale-token', input })).rejects.toMatchObject({
      hint: expect.stringContaining('Refresh the user token'),
    });
  });

  it('isolates tokens between overlapping renders and gets a fresh token each time', async () => {
    let release!: (value: string) => void;
    const firstToken = new Promise<string>((resolve) => {
      release = resolve;
    });
    const getToken = vi.fn().mockReturnValueOnce(firstToken).mockResolvedValueOnce('token-b');
    const renderer = createRenderer({ getToken });
    const first = renderer.render({ input });
    const second = renderer.render({ input });
    await second;
    release('token-a');
    await first;
    expect(getToken).toHaveBeenCalledTimes(2);
    const configs = createDeck.mock.calls.map(([config]) => config);
    expect(configs.map((config) => config.token)).toEqual(['token-b', 'token-a']);
    expect(configs[0].authUuid).toBe(configs[1].authUuid);
    expect(configs.every((config) => !('apiKey' in config))).toBe(true);
  });
});

describe('browser validation and artifact lifecycle', () => {
  it.each([undefined, null, { input, token: 'token', guest: true }, { input, apiKey: 'secret' }])(
    'rejects invalid one-shot options through its Promise, not a synchronous throw',
    async (options) => {
      const promise = render(options as BrowserOneShotRenderOptions);
      await expect(promise).rejects.toMatchObject({ code: 'usage_error' });
      expect(createDeck).not.toHaveBeenCalled();
    }
  );

  it('passes a PDF through without credentials, uploads or filesystem access', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const result = await render({
      input: { data: new Blob(['%PDF-test']), name: 'report.pdf' },
      format: 'pdf',
    });
    expect(result).toMatchObject({ engine: 'passthrough', pages: 1, route: ['passthrough'] });
    expect(result.outputs[0]?.url).toMatch(/^blob:/);
    await expect(result.outputs[0]!.blob().then((blob) => blob.text())).resolves.toBe('%PDF-test');
    expect(createDeck).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    result.dispose();
    result.dispose();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(result.outputs[0]?.url);
  });

  it.each([
    'deck.pptx',
    'https://example.test/deck.pptx',
    new Blob(['bytes']),
    { data: new Uint8Array(), name: 'deck.pptx' },
    { data: new Uint8Array([1]), name: '../deck.pptx' },
    { data: 'not bytes', name: 'deck.pptx' },
    { html: '' },
    { html: '<h1>Hi</h1>', markdown: '# Hi' },
    { html: '<h1>Hi</h1>', baseUrl: 'file:///secret/' },
  ])('rejects invalid browser input before uploading', async (input) => {
    await expect(render({ guest: true, input: input as BrowserInput })).rejects.toMatchObject({
      code: 'usage_error',
    });
    expect(createDeck).not.toHaveBeenCalled();
  });

  it.each(['engine', 'out', 'executablePath', 'office2htmlPath', 'signal', 'profile'])(
    'rejects unsupported %s rather than ignoring it',
    async (key) => {
      await expect(
        createRenderer({ guest: true }).render({ input, [key]: 'local' } as BrowserRenderOptions)
      ).rejects.toMatchObject({ code: 'usage_error' });
      expect(createDeck).not.toHaveBeenCalled();
    }
  );

  it.each([
    { guest: true, token: 'token' },
    { guest: true, spaceId: 'space' },
    { token: 'a', getToken: () => 'b' },
    { apiKey: 'secret' },
    { apiBase: 'javascript:alert(1)' },
    { apiBase: 'https://user:password@example.test' },
  ])('rejects ambiguous or unsafe renderer configuration', (options) => {
    expect(() => createRenderer(options as BrowserRendererOptions)).toThrow();
  });

  it.each(['/tmp/out.png', 'javascript:alert(1)', 'https://user:password@example.test/out.png'])(
    'rejects a non-public artifact source',
    async (source) => {
      fake = createFakeClient({ results: { 'convertor.ppt2image': [[source, 10, 'hash']] } });
      createDeck.mockReturnValue(fake.client);
      await expect(render({ token: 'token', input })).rejects.toMatchObject({ code: 'render_error' });
    }
  );

  it('does not create an object URL when passthrough options are invalid', async () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    await expect(
      render({ input: { ...input, name: 'report.pdf' }, format: 'pdf', pages: '1' })
    ).rejects.toMatchObject({ code: 'unsupported_option' });
    expect(create).not.toHaveBeenCalled();
  });

  it('reports final artifact expiry/download failures without leaking credentials', async () => {
    const result = await render({ token: 'token', input });
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 403 }));
    await expect(result.outputs[0]!.blob()).rejects.toMatchObject({
      code: 'conversion_error',
      hint: expect.stringContaining('expiry'),
    });
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderer } from '../../src/core/renderer.js';
import { CloudEngine } from '../../src/engines/cloud.js';
import type { DeckRenderError } from '../../src/errors/index.js';
import { createFakeClient, frames, singleFile } from './fake-client.js';

let workDir: string;
const originalFetch = globalThis.fetch;

/** Serve artifact bytes without touching the network. */
function stubFetch(): void {
  globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    return new Response(new TextEncoder().encode(`bytes-for:${url}`), { status: 200 });
  }) as typeof fetch;
}

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-int-'));
  stubFetch();
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  await fs.rm(workDir, { recursive: true, force: true });
});

async function fixture(name: string, contents = 'fixture'): Promise<string> {
  const file = path.join(workDir, name);
  await fs.writeFile(file, contents);
  return file;
}

describe('pptx to images', () => {
  it('renders every page into a directory named after the input', async () => {
    const fake = createFakeClient({ results: { 'convertor.ppt2image': frames(3) } });
    const input = await fixture('deck.pptx');

    const result = await createRenderer({ client: fake.client }).render({ input, format: 'image' });

    expect(result.route).toEqual(['convertor.ppt2image']);
    expect(result.pages).toBe(3);
    expect(result.outputs.map((o) => path.basename(o.file))).toEqual(['001.png', '002.png', '003.png']);
    expect(result.outputs[0]).toMatchObject({ page: 1, width: 1920, height: 1080 });

    const written = await fs.readdir(path.join(workDir, 'deck'));
    expect(written.sort()).toEqual(['001.png', '002.png', '003.png']);
  });

  it('uploads the source file exactly once', async () => {
    const fake = createFakeClient({ results: { 'convertor.ppt2image': frames(2) } });
    await createRenderer({ client: fake.client }).render({
      input: await fixture('deck.pptx'),
      format: 'image',
    });

    expect(fake.uploads).toHaveLength(1);
    expect(fake.tasks[0]?.fileIds).toEqual(['file-1']);
  });

  it('writes a single file when -o names one', async () => {
    const fake = createFakeClient({ results: { 'convertor.ppt2pdf': singleFile('deck.pdf') } });
    const out = path.join(workDir, 'out.pdf');

    const result = await createRenderer({ client: fake.client }).render({
      input: await fixture('deck.pptx'),
      format: 'pdf',
      out,
    });

    expect(result.outputs).toEqual([expect.objectContaining({ page: 1, file: out })]);
    await expect(fs.stat(out)).resolves.toBeTruthy();
  });

  it('templates the name when -o is a single file but many frames come back', async () => {
    const fake = createFakeClient({ results: { 'convertor.ppt2image': frames(2) } });
    const result = await createRenderer({ client: fake.client }).render({
      input: await fixture('deck.pptx'),
      format: 'image',
      out: path.join(workDir, 'shot.png'),
    });

    expect(result.outputs.map((o) => path.basename(o.file))).toEqual(['shot-001.png', 'shot-002.png']);
  });

  it('packs frames into a zip when -o ends in .zip', async () => {
    const fake = createFakeClient({ results: { 'convertor.ppt2image': frames(3) } });
    const out = path.join(workDir, 'frames.zip');

    await createRenderer({ client: fake.client }).render({
      input: await fixture('deck.pptx'),
      format: 'image',
      out,
    });

    const bytes = await fs.readFile(out);
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(bytes.includes(Buffer.from('001.png'))).toBe(true);
    expect(bytes.includes(Buffer.from('003.png'))).toBe(true);
  });
});

describe('page selection', () => {
  it('reports total pages but writes only the selected ones', async () => {
    const fake = createFakeClient({ results: { 'convertor.ppt2image': frames(10) } });

    const result = await createRenderer({ client: fake.client }).render({
      input: await fixture('deck.pptx'),
      format: 'image',
      pages: '2,4-5',
      out: path.join(workDir, 'out'),
    });

    expect(result.pages).toBe(10);
    expect(result.outputs.map((o) => o.page)).toEqual([2, 4, 5]);
    expect(await fs.readdir(path.join(workDir, 'out'))).toHaveLength(3);
  });

  it('streams one selected page without losing its source page number', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const fake = createFakeClient({ results: { 'convertor.ppt2image': frames(3) } });

    const result = await createRenderer({ client: fake.client }).render({
      input: await fixture('deck.pptx'),
      format: 'image',
      pages: '3',
      out: '-',
    });

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(result.outputs).toEqual([
      expect.objectContaining({ page: 3, file: '-', bytes: expect.any(Number) }),
    ]);
  });

  it('filters before per-frame conversion so unwanted frames are never converted', async () => {
    const fake = createFakeClient({
      results: {
        'convertor.ppt2image': frames(10),
        'image.convertWebp': (call: number) => singleFile(`converted-${call}.webp`),
      },
    });

    await createRenderer({ client: fake.client }).render({
      input: await fixture('deck.pptx'),
      format: 'image',
      imageFormat: 'webp',
      pages: '1-2',
      out: path.join(workDir, 'out'),
    });

    const webpTasks = fake.tasks.filter((t) => t.type === 'image.convertWebp');
    expect(webpTasks).toHaveLength(2);
  });

  it('fails loudly when a requested page does not exist', async () => {
    const fake = createFakeClient({ results: { 'convertor.ppt2image': frames(3) } });

    await expect(
      createRenderer({ client: fake.client }).render({
        input: await fixture('deck.pptx'),
        format: 'image',
        pages: '9',
      })
    ).rejects.toThrowError(/rendered 3 pages/);
  });
});

describe('derived chains', () => {
  it('routes docx to image through pdf and re-uploads the intermediate', async () => {
    const fake = createFakeClient({
      results: {
        'convertor.doc2pdf': singleFile('mid.pdf'),
        'convertor.pdf2image': frames(2),
      },
    });

    const result = await createRenderer({ client: fake.client }).render({
      input: await fixture('report.docx'),
      format: 'image',
      out: path.join(workDir, 'out'),
    });

    expect(result.route).toEqual(['convertor.doc2pdf', 'convertor.pdf2image']);
    // one upload for the source, one for the intermediate PDF
    expect(fake.uploads.map((u) => u.name)).toEqual([undefined, 'intermediate.pdf']);
    expect(fake.tasks[1]?.fileIds).toEqual(['file-2']);
  });

  it('converts each frame to webp with its page number preserved', async () => {
    const fake = createFakeClient({
      results: {
        'convertor.ppt2image': frames(3),
        'image.convertWebp': (call: number) => singleFile(`out-${call}.webp`),
      },
    });

    const result = await createRenderer({ client: fake.client }).render({
      input: await fixture('deck.pptx'),
      format: 'image',
      imageFormat: 'webp',
      out: path.join(workDir, 'out'),
    });

    expect(result.route).toEqual(['convertor.ppt2image', 'image.convertWebp']);
    expect(result.outputs.map((o) => o.page)).toEqual([1, 2, 3]);
    expect(result.outputs.every((o) => o.file.endsWith('.webp'))).toBe(true);
  });
});

describe('html and markdown input', () => {
  it('uploads html as the task source', async () => {
    const fake = createFakeClient({ results: { 'convertor.html2png': singleFile('shot.png') } });
    const input = await fixture('page.html', '<html><body>hi</body></html>');

    await createRenderer({ client: fake.client }).render({
      input,
      format: 'image',
      out: path.join(workDir, 'shot.png'),
    });

    expect(fake.uploads).toHaveLength(1);
    expect(fake.uploads[0]?.name).toBe('input.html');
    expect(fake.tasks[0]).toMatchObject({
      type: 'convertor.html2png',
      fileIds: ['file-1'],
      params: { fullPage: true },
    });
  });

  it('uploads markdown under its own filename', async () => {
    const fake = createFakeClient({ results: { 'convertor.markdown2png': singleFile('doc.png') } });

    await createRenderer({ client: fake.client }).render({
      input: await fixture('notes.md', '# Title'),
      format: 'image',
      out: path.join(workDir, 'doc.png'),
    });

    expect(fake.uploads[0]?.name).toBe('input.md');
    expect(fake.tasks[0]?.fileIds).toEqual(['file-1']);
  });

  it('fetches a url and rewrites its base href', async () => {
    globalThis.fetch = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url === 'https://example.com/deck') {
        return new Response('<html><head></head><body>remote</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      }
      return new Response(new TextEncoder().encode('bytes'), { status: 200 });
    }) as typeof fetch;

    const fake = createFakeClient({ results: { 'convertor.html2png': singleFile('shot.png') } });
    const result = await createRenderer({ client: fake.client }).render({
      input: 'https://example.com/deck',
      format: 'image',
      out: path.join(workDir, 'shot.png'),
    });

    expect(result.input).toBe('https://example.com/deck');
    expect(new TextDecoder().decode(fake.uploads[0]?.input as Uint8Array)).toContain(
      '<base href="https://example.com/deck">'
    );
  });
});

describe('guest task startup', () => {
  it('starts a task explicitly while the client remains unauthenticated', async () => {
    const fake = createFakeClient({ results: { 'convertor.html2png': singleFile('shot.png') } });
    const engine = new CloudEngine({
      client: fake.client,
      authenticated: false,
      isAuthenticated: () => false,
    });

    await createRenderer({ engine }).render({
      input: await fixture('guest.html', '<html></html>'),
      format: 'image',
      out: path.join(workDir, 'guest.png'),
    });

    expect(fake.started).toEqual(['task-1']);
  });

  it('does not double-start when lazy login succeeds during task creation', async () => {
    let authenticated = false;
    const fake = createFakeClient({
      results: { 'convertor.html2png': singleFile('shot.png') },
      onCreate: () => {
        authenticated = true;
      },
    });
    const engine = new CloudEngine({
      client: fake.client,
      authenticated,
      isAuthenticated: () => authenticated,
    });

    await createRenderer({ engine }).render({
      input: await fixture('login.html', '<html></html>'),
      format: 'image',
      out: path.join(workDir, 'login.png'),
    });

    expect(fake.started).toEqual([]);
  });
});

describe('passthrough', () => {
  it('copies pdf to pdf without any backend task', async () => {
    const fake = createFakeClient({ results: {} });
    const input = await fixture('doc.pdf', 'pdf-bytes');
    const out = path.join(workDir, 'copy.pdf');

    const result = await createRenderer({ client: fake.client }).render({ input, format: 'pdf', out });

    expect(result.route).toEqual(['passthrough']);
    expect(result.engine).toBe('passthrough');
    expect(fake.tasks).toHaveLength(0);
    expect(await fs.readFile(out, 'utf-8')).toBe('pdf-bytes');
  });
});

describe('failure reporting', () => {
  it('surfaces a failed backend task as render_error', async () => {
    const fake = createFakeClient({
      results: { 'convertor.ppt2image': frames(1) },
      failing: ['convertor.ppt2image'],
    });

    try {
      await createRenderer({ client: fake.client }).render({
        input: await fixture('deck.pptx'),
        format: 'image',
      });
      throw new Error('expected a throw');
    } catch (error) {
      const err = error as DeckRenderError;
      expect(err.code).toBe('render_error');
      expect(err.message).toContain('backend blew up');
      // The SDK's rejection names neither the task nor its id, so the engine
      // has to add them back or the failure is uninvestigatable.
      expect(err.message).toContain('convertor.ppt2image');
      expect(err.hint).toMatch(/deckops task get task-\d+/);
    }
  });

  it('separates a download failure from a render failure', async () => {
    // The render succeeded; only fetching the artifact failed. That distinction
    // is why conversion_error exists alongside render_error.
    globalThis.fetch = vi.fn(
      async () => new Response('nope', { status: 503, statusText: 'Service Unavailable' })
    ) as typeof fetch;

    const fake = createFakeClient({ results: { 'convertor.ppt2image': frames(1) } });

    try {
      await createRenderer({ client: fake.client }).render({
        input: await fixture('deck.pptx'),
        format: 'image',
        out: path.join(workDir, 'out.png'),
      });
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as DeckRenderError).code).toBe('conversion_error');
      expect((error as Error).message).toContain('503');
    }
  });
});

describe('warnings', () => {
  it('announces the chain and the fidelity caveat for html to pdf', async () => {
    const fake = createFakeClient({
      results: {
        'convertor.html2pptx': { target: ['https://fake.test/mid.pptx', 1, 'h'], usedFonts: [] },
        'convertor.ppt2pdf': singleFile('out.pdf'),
      },
    });
    const warnings: string[] = [];

    const result = await createRenderer({
      client: fake.client,
      onWarning: (message) => warnings.push(message),
    }).render({
      input: await fixture('page.html', '<html><body>x</body></html>'),
      format: 'pdf',
      out: path.join(workDir, 'out.pdf'),
    });

    expect(result.caveat).toMatch(/rebuilt as PPTX/);
    expect(warnings.some((w) => w.includes('rebuilt as PPTX'))).toBe(true);
    expect(warnings.some((w) => w.startsWith('via convertor.html2pptx → convertor.ppt2pdf'))).toBe(true);
  });

  it('warns when a resolution is snapped to an allowed tier', async () => {
    const fake = createFakeClient({ results: { 'convertor.ppt2image': frames(1) } });
    const warnings: string[] = [];

    await createRenderer({
      client: fake.client,
      onWarning: (message) => warnings.push(message),
    }).render({
      input: await fixture('deck.pptx'),
      format: 'image',
      width: 2000,
      out: path.join(workDir, 'out.png'),
    });

    expect(warnings.some((w) => w.includes('snapped to 1920'))).toBe(true);
  });
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRenderer } from '../../src/core/renderer.js';

const describeLocal = process.env.DECKRENDER_LOCAL_E2E === '1' ? describe : describe.skip;

describeLocal('real local engine', () => {
  let workDirectory: string;

  beforeAll(async () => {
    workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-local-e2e-'));
  });

  afterAll(async () => {
    await fs.rm(workDirectory, { recursive: true, force: true });
  });

  it('captures generic multi-page HTML without the cloud engine', async () => {
    const input = path.join(workDirectory, 'deck.html');
    await fs.writeFile(
      input,
      `<!doctype html><style>
      #deck{width:640px;aspect-ratio:1.7778;position:relative}.slide{display:none;position:absolute;inset:0}.slide.is-active{display:block}
      </style><div id="deck"><section class="slide" data-slide="0">One</section><section class="slide" data-slide="1">Two</section></div>`
    );

    const result = await createRenderer().render({
      input,
      engine: 'local',
      format: 'image',
      out: path.join(workDirectory, 'html-frames'),
    });

    expect(result.engine).toBe('local');
    expect(result.route).toEqual(['local.capture']);
    expect(result.outputs.map((output) => output.page)).toEqual([1, 2]);
  });

  it('rasterizes a two-page PDF with numeric page selection', async () => {
    const document = await PDFDocument.create();
    const font = await document.embedFont(StandardFonts.Helvetica);
    for (const text of ['First', 'Second']) {
      const page = document.addPage([600, 400]);
      page.drawText(text, { x: 50, y: 300, size: 48, font });
    }
    const input = path.join(workDirectory, 'two-pages.pdf');
    await fs.writeFile(input, await document.save());

    const result = await createRenderer().render({
      input,
      engine: 'local',
      format: 'image',
      pages: '2',
      width: 800,
      out: path.join(workDirectory, 'page.png'),
    });

    expect(result.pages).toBe(2);
    expect(result.outputs).toEqual([expect.objectContaining({ page: 2, width: 800, height: 534 })]);
  });

  const pptx = process.env.DECKRENDER_LOCAL_PPTX;
  (pptx ? it : it.skip)('renders a real PPTX through office2html', async () => {
    const result = await createRenderer().render({
      input: pptx!,
      engine: 'local',
      format: 'image',
      pages: '1',
      out: path.join(workDirectory, 'pptx.png'),
    });
    expect(result.route).toEqual(['local.office2html', 'local.capture']);
    expect(result.outputs[0]?.page).toBe(1);
  });
});

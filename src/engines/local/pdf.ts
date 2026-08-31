import fs from 'node:fs/promises';
import path from 'node:path';
import { DeckRenderError } from '../../errors/index.js';
import type { RenderArtifact } from '../../types.js';
import type { ExecuteContext } from '../engine.js';

export async function mergePdfPages(
  pages: { page: number; path: string }[],
  outputDirectory: string,
  ctx: ExecuteContext
): Promise<RenderArtifact> {
  let PDFDocument: (typeof import('pdf-lib'))['PDFDocument'];
  try {
    ({ PDFDocument } = await import('pdf-lib'));
  } catch (error) {
    throw DeckRenderError.render('pdf-lib is required for local PDF output.', {
      hint: 'Reinstall DeckRender without --omit=optional, or install pdf-lib@1.17.1.',
      cause: error,
    });
  }

  ctx.onProgress?.({
    phase: 'task',
    task: 'local.pdf-merge',
    message: `Merging ${pages.length} PDF pages locally`,
  });

  const merged = await PDFDocument.create();
  for (const item of [...pages].sort((a, b) => a.page - b.page)) {
    const source = await PDFDocument.load(await fs.readFile(item.path));
    if (source.getPageCount() !== 1) {
      throw DeckRenderError.conversion(
        `Chromium produced ${source.getPageCount()} PDF pages for slide ${item.page}; expected exactly one.`
      );
    }
    const [copied] = await merged.copyPages(source, [0]);
    if (!copied) {
      throw DeckRenderError.conversion(`Could not copy local PDF page ${item.page}.`);
    }
    merged.addPage(copied);
  }

  await fs.mkdir(outputDirectory, { recursive: true });
  const output = path.join(outputDirectory, 'deck.pdf');
  const bytes = await merged.save();
  await fs.writeFile(output, bytes);
  return { page: 1, source: output, ext: '.pdf', bytes: bytes.length };
}

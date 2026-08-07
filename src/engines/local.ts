import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeckRenderError } from '../errors/index.js';
import { listZipEntries, readEntryData } from '../input/unzip.js';
import { jpegToPdf, readJpegSize } from '../output/jpeg-pdf.js';
import type { RenderArtifact, RenderPlan } from '../types.js';
import type { EngineOutput, ExecuteContext, RenderEngine } from './engine.js';

/**
 * Renders that run entirely on this machine.
 *
 * Today this is only the iWork preview extractor. Pages and Numbers documents
 * have no DeckOps converter, but every iWork file embeds a `preview.jpg` of its
 * first page — pulling that out needs nothing but a ZIP reader, so it beats
 * telling the user the format is unsupported.
 *
 * The result is a preview, not a render: one page, at whatever size iWork
 * chose. Callers surface the route's caveat so nobody mistakes it for a full
 * rendering of the document.
 */
export class LocalEngine implements RenderEngine {
  readonly name = 'local';

  supports(plan: RenderPlan): boolean {
    return plan.steps.every((step) => step.task === 'local:iwork-preview');
  }

  async execute(plan: RenderPlan, ctx: ExecuteContext): Promise<EngineOutput> {
    ctx.onProgress?.({ phase: 'task', message: 'Extracting the embedded preview' });

    const jpeg = await extractIworkPreview(ctx.input.path, ctx.input.bytes);
    const { width, height } = readJpegSize(jpeg);

    const target = plan.target === 'pdf' ? jpegToPdf(jpeg) : jpeg;
    const ext = plan.target === 'pdf' ? '.pdf' : '.jpg';

    // The writer reads artifacts from a URL or a path, so the bytes have to
    // land somewhere. A temp file keeps the writer's contract unchanged.
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-local-'));
    const file = path.join(dir, `preview${ext}`);
    await fs.writeFile(file, target);

    const artifact: RenderArtifact = {
      page: 1,
      source: file,
      ext,
      bytes: target.length,
      width,
      height,
    };

    return { artifacts: [artifact], totalPages: 1 };
  }
}

/** Preview locations, newest iWork format first. */
const PREVIEW_NAMES = ['preview.jpg', 'QuickLook/Preview.jpg', 'preview-web.jpg', 'preview-micro.jpg'];

/**
 * Pull `preview.jpg` out of an iWork document.
 *
 * iWork writes two shapes: a single ZIP file, or a directory bundle holding the
 * same members as loose files. Both are handled here because Finder and iCloud
 * each produce a different one.
 */
export async function extractIworkPreview(
  filePath: string | undefined,
  inlineBytes: Uint8Array | undefined
): Promise<Buffer> {
  if (filePath) {
    const stat = await fs.stat(filePath).catch(() => undefined);
    if (stat?.isDirectory()) {
      return readPreviewFromDirectory(filePath);
    }
  }

  const buffer = filePath ? await fs.readFile(filePath) : Buffer.from(inlineBytes ?? []);
  if (buffer.length === 0) {
    throw DeckRenderError.conversion('The iWork document is empty.');
  }

  return readPreviewFromZip(buffer);
}

async function readPreviewFromDirectory(dir: string): Promise<Buffer> {
  for (const name of PREVIEW_NAMES) {
    const candidate = path.join(dir, ...name.split('/'));
    const bytes = await fs.readFile(candidate).catch(() => undefined);
    if (bytes && bytes.length > 0) {
      return bytes;
    }
  }
  throw noPreview();
}

async function readPreviewFromZip(buffer: Buffer): Promise<Buffer> {
  const entries = listZipEntries(buffer);
  if (entries.length === 0) {
    throw DeckRenderError.conversion('The iWork document is not a readable ZIP container.');
  }

  for (const name of PREVIEW_NAMES) {
    const entry = entries.find((candidate) => candidate.name === name);
    if (!entry) {
      continue;
    }
    const bytes = await readEntryData(buffer, entry);
    if (bytes && bytes.length > 0) {
      return bytes;
    }
  }

  throw noPreview();
}

function noPreview(): DeckRenderError {
  return DeckRenderError.conversion('This iWork document has no embedded preview to extract.', {
    hint:
      'Open it in Pages or Numbers and re-save with "Include preview in document" enabled, ' +
      'or export to PDF and render that instead.',
  });
}

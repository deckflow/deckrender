import type { RenderArtifact } from '../types.js';

/**
 * Normalize a `tasks.down()` payload into ordered artifacts.
 *
 * DeckOps returns three different shapes depending on the task
 * (see DeckTaskTypeResult in @deckops/sdk):
 *
 *   ConvertFileResult[]  — multi-frame converters (ppt2image, pdf2image, ...)
 *   FileResult           — single-file converters (html2png, convertWebp, ...)
 *   { target: FileResult } — html2pptx
 *
 * A file tuple is `[path, bytes, hash, bounds?]`, where `bounds` carries the
 * page geometry, so width/height never have to be measured locally.
 */
export function normalizeTaskResult(result: unknown): RenderArtifact[] {
  const tuples = collectTuples(result);
  return tuples.map((tuple, index) => toArtifact(tuple, index));
}

type FileTuple = [string, ...unknown[]];

function collectTuples(result: unknown): FileTuple[] {
  if (isFileTuple(result)) {
    return [result];
  }

  if (Array.isArray(result)) {
    return result.filter(isFileTuple);
  }

  if (result && typeof result === 'object') {
    const record = result as Record<string, unknown>;
    // html2pptx wraps its output; other single-file payloads may too.
    for (const key of ['target', 'file', 'output']) {
      const value = record[key];
      if (isFileTuple(value)) {
        return [value];
      }
    }
    if (typeof record.downloadUrl === 'string') {
      return [[record.downloadUrl]];
    }
  }

  return [];
}

function isFileTuple(value: unknown): value is FileTuple {
  return Array.isArray(value) && typeof value[0] === 'string';
}

interface Bounds {
  w?: number;
  h?: number;
  total?: number;
}

function toArtifact(tuple: FileTuple, index: number): RenderArtifact {
  const [source, bytes, , bounds] = tuple;
  const geometry = (bounds ?? undefined) as Bounds | undefined;

  return {
    page: index + 1,
    source,
    ext: extensionOf(source),
    ...(typeof bytes === 'number' ? { bytes } : {}),
    ...(typeof geometry?.w === 'number' ? { width: geometry.w } : {}),
    ...(typeof geometry?.h === 'number' ? { height: geometry.h } : {}),
  };
}

/** Extension from a URL or path, ignoring query strings. Defaults to `.bin`. */
export function extensionOf(source: string): string {
  let pathname = source;
  try {
    pathname = new URL(source).pathname;
  } catch {
    pathname = source.split('?')[0] ?? source;
  }
  const name =
    pathname
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? '';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name !== '..' ? name.slice(dot).toLowerCase() : '';
  return ext || '.bin';
}

export function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

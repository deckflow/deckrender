import { DeckRenderError } from '../errors/DeckRenderError.js';
import { KNOWN_UNRENDERABLE_EXTENSIONS } from '../core/routes.js';
import { SOURCE_FORMATS, type RenderInput, type SourceFormat } from '../types.js';
import { withBaseHref } from '../input/html.js';
import type { BrowserInput } from './types.js';

export async function resolveBrowserInput(value: BrowserInput, from?: SourceFormat): Promise<RenderInput> {
  if (!value || typeof value !== 'object') {
    throw DeckRenderError.usage(
      'Expected a File, named binary data, { html }, or { markdown }; paths and URLs are not browser inputs.'
    );
  }
  if ('html' in value || 'markdown' in value) {
    const html = 'html' in value;
    const format = html ? 'html' : 'md';
    assertKeys(value, html ? ['html', 'baseUrl'] : ['markdown'], 'input');
    let text = html ? value.html : value.markdown;
    if (typeof text !== 'string' || !text.trim()) {
      throw DeckRenderError.usage('Inline HTML/Markdown must be a non-empty string.');
    }
    if (from && from !== format) {
      throw DeckRenderError.usage(`Inline ${format} cannot be interpreted as ${from}.`);
    }
    if (html && value.baseUrl !== undefined) {
      text = withBaseHref(text, httpUrl(value.baseUrl, 'baseUrl'));
    }
    return { kind: 'memory', format, text, name: `input.${format}`, display: `input.${format}` };
  }

  let data: Blob | Uint8Array | ArrayBuffer;
  let name: string;
  if (isBlob(value) && 'name' in value && typeof value.name === 'string') {
    data = value;
    name = value.name;
  } else if ('data' in value && 'name' in value) {
    assertKeys(value, ['data', 'name'], 'input');
    data = value.data;
    name = value.name;
  } else {
    throw DeckRenderError.usage('Binary input needs a filename: { data: blob, name: "deck.pptx" }.');
  }
  if (typeof name !== 'string' || !name.trim() || /[\\/]/.test(name) || name.includes('\u0000')) {
    throw DeckRenderError.usage('Input name must be a non-empty filename, not a path or URL.');
  }
  const format = from ?? formatForName(name);
  const bytes = isBlob(data)
    ? new Uint8Array(await data.arrayBuffer())
    : data instanceof ArrayBuffer
      ? new Uint8Array(data.slice(0))
      : data instanceof Uint8Array
        ? data.slice()
        : undefined;
  if (!bytes?.byteLength) {
    throw DeckRenderError.usage('Input data must be a non-empty Blob, Uint8Array, or ArrayBuffer.');
  }
  return {
    kind: 'memory',
    format,
    bytes,
    name,
    display: name,
    ...(['html', 'md'].includes(format) ? { text: new TextDecoder().decode(bytes) } : {}),
  };
}

function formatForName(name: string): SourceFormat {
  // A File.name is not a URL: ?, # and : may be literal filename characters.
  // Parsing it as a URL can select a different converter (or PDF passthrough).
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : '.bin';
  const alias: Record<string, SourceFormat> = { '.htm': 'html', '.markdown': 'md' };
  const format = alias[ext] ?? ext.slice(1);
  if ((SOURCE_FORMATS as readonly string[]).includes(format)) {
    return format as SourceFormat;
  }
  if ((KNOWN_UNRENDERABLE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw DeckRenderError.unsupportedFormat(`${ext} files are not supported.`);
  }
  throw DeckRenderError.usage(`Unrecognized input extension: ${ext}. Set from explicitly.`);
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

export function assertKeys(value: object, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw DeckRenderError.usage(`Unsupported browser ${label}: ${key}.`);
    }
  }
}

export function httpUrl(value: unknown, label: string): string {
  try {
    if (typeof value !== 'string') throw new Error('not a string');
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
      throw new Error('not an HTTP URL');
    }
    return url.href;
  } catch {
    throw DeckRenderError.usage(`${label} must be an absolute HTTP(S) URL without embedded credentials.`);
  }
}

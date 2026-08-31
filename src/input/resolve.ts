import fs from 'node:fs/promises';
import path from 'node:path';
import { DeckRenderError } from '../errors/index.js';
import { KNOWN_UNRENDERABLE_EXTENSIONS } from '../core/routes.js';
import { SOURCE_FORMATS, type RenderInput, type SourceFormat } from '../types.js';

/** Extensions that map onto a render matrix row. */
const EXTENSION_MAP: Record<string, SourceFormat> = {
  '.pptx': 'pptx',
  '.ppt': 'ppt',
  '.pdf': 'pdf',
  '.key': 'key',
  '.docx': 'docx',
  '.doc': 'doc',
  '.xlsx': 'xlsx',
  '.pages': 'pages',
  '.numbers': 'numbers',
  '.html': 'html',
  '.htm': 'html',
  '.md': 'md',
  '.markdown': 'md',
};

/**
 * What to say when the input turns out to be a directory.
 *
 * iWork can save a document as a bundle that Finder shows as a single file, so
 * this is a real mistake to make rather than a typo. Only Keynote is worth
 * re-saving: Pages and Numbers have no cloud converter either way, and sending
 * the user through a re-save that still fails would waste their time.
 */
const BUNDLE_HINTS: Record<string, string> = {
  '.key':
    'This is an iWork package. Re-save it as a single file from Keynote ' +
    '(Settings → General → Save new documents as), or export it to PDF and render that.',
  '.pages':
    'This is an iWork package, and .pages documents are not renderable yet in any case. ' +
    'Export it to PDF or DOCX and render that.',
  '.numbers':
    'This is an iWork package, and .numbers documents are not renderable yet in any case. ' +
    'Export it to PDF and render that.',
};

/** Formats kept as text so they need no temporary local file before upload. */
const INLINE_FORMATS: SourceFormat[] = ['html', 'md'];

export interface ResolveInputOptions {
  /** Explicit source format. Required for stdin, optional elsewhere. */
  from?: SourceFormat;
  /** Injected for tests. */
  readStdin?: () => Promise<Uint8Array>;
  fetchImpl?: typeof fetch;
}

export async function resolveInput(spec: string, options: ResolveInputOptions = {}): Promise<RenderInput> {
  if (spec === '-') {
    return resolveStdin(options);
  }
  if (/^https?:\/\//i.test(spec)) {
    return resolveUrl(spec, options);
  }
  return resolveFile(spec, options);
}

async function resolveStdin(options: ResolveInputOptions): Promise<RenderInput> {
  if (!options.from) {
    throw DeckRenderError.usage('Reading from stdin requires an explicit source format.', {
      hint: `Add --from <${SOURCE_FORMATS.join('|')}>, for example: cat page.html | deckrender - --from html`,
    });
  }

  const bytes = await (options.readStdin ?? readStdinBytes)();
  if (bytes.length === 0) {
    throw DeckRenderError.usage('Received no data on stdin.');
  }

  const format = options.from;
  if (INLINE_FORMATS.includes(format)) {
    return { kind: 'stdin', format, text: new TextDecoder().decode(bytes), display: '-' };
  }

  return { kind: 'stdin', format, bytes, name: `stdin.${format}`, display: '-' };
}

/**
 * Fetch a hosted page.
 *
 * The HTML is resolved locally rather than sent as a URL. `html.getByURL` —
 * which would capture the runtime DOM — exists in the DeckOps source tree but
 * is not in the published SDK, so v0.1 fetches the document here and rewrites
 * its base URL. Scripts still run: the backend renders the HTML in a browser.
 * See docs/roadmap.md.
 */
async function resolveUrl(url: string, options: ResolveInputOptions): Promise<RenderInput> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const format = options.from ?? 'html';

  let response: Response;
  try {
    response = await fetchImpl(url, { redirect: 'follow' });
  } catch (error) {
    throw DeckRenderError.usage(`Could not fetch ${url}: ${(error as Error).message}`, { cause: error });
  }

  if (!response.ok) {
    throw DeckRenderError.usage(`Could not fetch ${url}: ${response.status} ${response.statusText}`);
  }

  if (format === 'html') {
    const html = withBaseHref(await response.text(), response.url || url);
    return { kind: 'url', format: 'html', text: html, display: url };
  }

  if (format === 'md') {
    return { kind: 'url', format: 'md', text: await response.text(), display: url };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const name = path.basename(new URL(url).pathname) || `download.${format}`;
  return { kind: 'url', format, bytes, name, display: url };
}

async function resolveFile(spec: string, options: ResolveInputOptions): Promise<RenderInput> {
  const absolute = path.resolve(spec);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(absolute);
  } catch {
    throw DeckRenderError.usage(`Input not found: ${spec}`);
  }

  const format = options.from ?? formatFromExtension(absolute);

  // iWork can save a document as a directory bundle that Finder shows as one
  // file. There is nothing to upload in that shape, and repackaging it here
  // would be local logic standing in for a backend that never sees it.
  if (stat.isDirectory()) {
    throw DeckRenderError.usage(`Input is a directory: ${spec}`, {
      hint:
        BUNDLE_HINTS[path.extname(absolute).toLowerCase()] ??
        'DeckRender renders a single document. Point it at a file.',
    });
  }

  if (INLINE_FORMATS.includes(format)) {
    return {
      kind: 'file',
      format,
      path: absolute,
      text: await fs.readFile(absolute, 'utf-8'),
      display: spec,
    };
  }

  return { kind: 'file', format, path: absolute, display: spec };
}

function formatFromExtension(file: string): SourceFormat {
  const ext = path.extname(file).toLowerCase();
  const format = EXTENSION_MAP[ext];
  if (format) {
    return format;
  }

  if ((KNOWN_UNRENDERABLE_EXTENSIONS as readonly string[]).includes(ext)) {
    throw DeckRenderError.unsupportedFormat(`${ext} files are not supported.`, {
      hint: 'Run `deckrender formats` to see the supported input formats.',
    });
  }

  throw DeckRenderError.usage(ext ? `Unrecognized input extension: ${ext}` : 'Input has no file extension.', {
    hint: `Set the format explicitly with --from <${SOURCE_FORMATS.join('|')}>.`,
  });
}

/**
 * Give relative URLs something to resolve against.
 *
 * The document is detached from its origin once it travels inline, so without
 * a `<base>` every relative stylesheet and image would 404 during render.
 */
export function withBaseHref(html: string, url: string): string {
  if (/<base\s/i.test(html)) {
    return html;
  }

  const baseTag = `<base href="${escapeAttribute(url)}">`;
  const headOpen = /<head\b[^>]*>/i.exec(html);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    return `${html.slice(0, at)}${baseTag}${html.slice(at)}`;
  }

  const htmlOpen = /<html\b[^>]*>/i.exec(html);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return `${html.slice(0, at)}<head>${baseTag}</head>${html.slice(at)}`;
  }

  return `${baseTag}${html}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

async function readStdinBytes(): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Base name used when deriving an output path from the input. */
export function inputBaseName(input: RenderInput): string {
  if (input.kind === 'file') {
    return path.basename(input.display, path.extname(input.display));
  }
  if (input.kind === 'url') {
    try {
      const name = path.basename(new URL(input.display).pathname);
      const base = name ? path.basename(name, path.extname(name)) : '';
      return base || new URL(input.display).hostname.replace(/\./g, '-');
    } catch {
      return 'output';
    }
  }
  return 'output';
}

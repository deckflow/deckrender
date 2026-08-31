import { DeckRenderError } from '../errors/DeckRenderError.js';
import { MAX_PAGE_NUMBER } from './validation.js';

/**
 * Parse a page selection: `3`, `1-5`, `1,3,5-7`.
 *
 * 1-based, inclusive ranges. Returns sorted unique page numbers.
 *
 * Note this only *selects* pages for download — the backend still renders the
 * whole document, because no DeckOps conversion task accepts a page range.
 * See docs/formats.md.
 */
export function parsePageSelection(spec: string): number[] {
  const trimmed = spec.trim();
  if (!trimmed) {
    throw DeckRenderError.usage('Empty page selection.', {
      hint: 'Use a page number (3), a range (1-5), or a list (1,3,5-7).',
    });
  }

  const pages = new Set<number>();

  for (const rawPart of trimmed.split(',')) {
    const part = rawPart.trim();
    if (!part) {
      continue;
    }

    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      assertPositive(start, part);
      assertPositive(end, part);
      if (start > end) {
        throw DeckRenderError.usage(`Invalid page range: ${part}. Start is greater than end.`);
      }
      for (let page = start; page <= end; page += 1) {
        pages.add(page);
      }
      continue;
    }

    if (!/^\d+$/.test(part)) {
      throw DeckRenderError.usage(`Invalid page selection: ${part}.`, {
        hint: 'Use a page number (3), a range (1-5), or a list (1,3,5-7).',
      });
    }

    const page = Number(part);
    assertPositive(page, part);
    pages.add(page);
  }

  if (pages.size === 0) {
    throw DeckRenderError.usage(`Invalid page selection: ${spec}.`);
  }

  return [...pages].sort((a, b) => a - b);
}

function assertPositive(value: number, part: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_NUMBER) {
    throw DeckRenderError.usage(
      `Invalid page number in "${part}". Expected an integer from 1 to ${MAX_PAGE_NUMBER}.`
    );
  }
}

/**
 * Keep only the selected pages.
 *
 * Selections beyond the rendered page count are reported rather than silently
 * dropped — a typo in `--pages` should not look like a successful render.
 */
export function applyPageSelection<T extends { page: number }>(items: T[], pages: number[]): T[] {
  if (pages.length === 0) {
    throw DeckRenderError.usage('Page selection cannot be empty.');
  }
  for (const page of pages) {
    assertPositive(page, String(page));
  }
  const available = new Set(items.map((item) => item.page));
  const missing = pages.filter((page) => !available.has(page));

  if (missing.length > 0) {
    const total = items.length;
    throw DeckRenderError.usage(
      `Requested page${missing.length > 1 ? 's' : ''} ${missing.join(', ')} but the document rendered ${total} page${total === 1 ? '' : 's'}.`
    );
  }

  const wanted = new Set(pages);
  return items.filter((item) => wanted.has(item.page));
}

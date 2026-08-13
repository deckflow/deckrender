import { describe, expect, it } from 'vitest';
import { applyPageSelection, parsePageSelection } from '../../src/core/pages.js';
import { DeckRenderError } from '../../src/errors/index.js';

describe('parsePageSelection', () => {
  it('parses a single page', () => {
    expect(parsePageSelection('3')).toEqual([3]);
  });

  it('parses an inclusive range', () => {
    expect(parsePageSelection('1-5')).toEqual([1, 2, 3, 4, 5]);
  });

  it('parses a mixed list, sorted and deduplicated', () => {
    expect(parsePageSelection('5,1,2-4,3')).toEqual([1, 2, 3, 4, 5]);
  });

  it('tolerates whitespace', () => {
    expect(parsePageSelection(' 1 , 3 - 4 ')).toEqual([1, 3, 4]);
  });

  it.each(['', '0', '-1', '3-1', 'a', '1-', '1..3', '100001'])('rejects %j', (spec) => {
    expect(() => parsePageSelection(spec)).toThrowError(DeckRenderError);
    try {
      parsePageSelection(spec);
    } catch (error) {
      expect((error as DeckRenderError).code).toBe('usage_error');
    }
  });
});

describe('applyPageSelection', () => {
  const frames = [1, 2, 3, 4].map((page) => ({ page }));

  it('keeps only the selected pages, in order', () => {
    expect(applyPageSelection(frames, [3, 1])).toEqual([{ page: 1 }, { page: 3 }]);
  });

  it('reports out-of-range pages instead of silently dropping them', () => {
    expect(() => applyPageSelection(frames, [2, 9])).toThrowError(/rendered 4 pages/);
  });

  it('rejects an empty runtime page array', () => {
    expect(() => applyPageSelection(frames, [])).toThrowError(DeckRenderError);
  });
});

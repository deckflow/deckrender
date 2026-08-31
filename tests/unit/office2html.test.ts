import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverDeckSlides, parseOffice2htmlPageCount } from '../../src/engines/local/office2html.js';

describe('office2html page-count summaries', () => {
  it.each([
    ['size: 9.24 MiB, pages: 22, assets: 15, time: 1216ms', 22],
    ['Slides: 12, assets: 4', 12],
    ['Converted presentation\nPAGES: 1, ASSETS: 0\nDone.', 1],
    ['Slides:\n  2, assets: 3', 2],
  ])('reads the page count from %s', (summary, count) => {
    expect(parseOffice2htmlPageCount(summary)).toBe(count);
  });

  it.each([
    '',
    'Conversion succeeded.',
    'pages: 0, assets: 3',
    'Slides: -1, assets: 3',
    'pages: 1.5, assets: 3',
    'pages: 9007199254740992, assets: 3',
    'pages: 22',
    'pages: 22, assets: unknown',
  ])('rejects an invalid summary: %s', (summary) => {
    expect(() => parseOffice2htmlPageCount(summary)).toThrowError(
      expect.objectContaining({ code: 'conversion_error' })
    );
  });
});

describe('office2html standalone slide discovery', () => {
  let fixtureDirectory: string;
  let deckDirectory: string;

  beforeEach(async () => {
    fixtureDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-office2html-test-'));
    deckDirectory = path.join(fixtureDirectory, 'deck');
    await fs.mkdir(deckDirectory);
  });

  afterEach(async () => {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  });

  function manifest(entries: unknown): string {
    return `<script type="application/json" id="slide-meta">${JSON.stringify(entries)}</script>`;
  }

  async function writeSlides(...names: string[]): Promise<void> {
    for (const name of names) {
      const target = path.join(deckDirectory, 'slides', name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, '<!doctype html><section class="slide">Slide</section>');
    }
  }

  it('uses zero-based manifest indexes, not filenames or manifest order, for public page order', async () => {
    await writeSlides('0010.html', '0002.html', '0001.html', 'notes.html');
    const html = manifest([
      { index: 2, src: 'slides/0001.html' },
      { index: 0, src: 'slides/0010.html' },
      { index: 1, src: 'slides/0002.html' },
    ]);

    await expect(discoverDeckSlides(deckDirectory, html, 3)).resolves.toEqual([
      { page: 1, path: path.join(deckDirectory, 'slides/0010.html') },
      { page: 2, path: path.join(deckDirectory, 'slides/0002.html') },
      { page: 3, path: path.join(deckDirectory, 'slides/0001.html') },
    ]);
  });

  it('accepts the actual zero-based 0000.html lazy-slides layout', async () => {
    await writeSlides('0000.html', '0001.html');
    const html = manifest([
      { index: 0, src: 'slides/0000.html', title: 'First' },
      { index: 1, src: 'slides/0001.html', title: 'Second' },
    ]);

    await expect(discoverDeckSlides(deckDirectory, html, 2)).resolves.toEqual([
      { page: 1, path: path.join(deckDirectory, 'slides/0000.html') },
      { page: 2, path: path.join(deckDirectory, 'slides/0001.html') },
    ]);
  });

  it('rejects malformed manifest JSON instead of falling back to numeric files', async () => {
    await writeSlides('0000.html');
    await expect(
      discoverDeckSlides(deckDirectory, '<script id="slide-meta" type="application/json">[</script>', 1)
    ).rejects.toMatchObject({ code: 'conversion_error' });
  });

  it.each([
    { label: 'non-array manifest', entries: { index: 0, src: 'slides/0000.html' }, total: 1 },
    { label: 'missing entry', entries: [{ index: 0, src: 'slides/0000.html' }], total: 2 },
    { label: 'extra entry', entries: [{ index: 0, src: 'slides/0000.html' }], total: 0 },
    { label: 'null entry', entries: [null], total: 1 },
    { label: 'missing index', entries: [{ src: 'slides/0000.html' }], total: 1 },
    { label: 'string index', entries: [{ index: '0', src: 'slides/0000.html' }], total: 1 },
    { label: 'negative index', entries: [{ index: -1, src: 'slides/0000.html' }], total: 1 },
    { label: 'fractional index', entries: [{ index: 0.5, src: 'slides/0000.html' }], total: 1 },
    { label: 'out-of-range index', entries: [{ index: 1, src: 'slides/0000.html' }], total: 1 },
    { label: 'missing src', entries: [{ index: 0 }], total: 1 },
    {
      label: 'duplicate index',
      entries: [
        { index: 0, src: 'slides/0000.html' },
        { index: 0, src: 'slides/0001.html' },
      ],
      total: 2,
    },
    {
      label: 'missing middle index',
      entries: [
        { index: 0, src: 'slides/0000.html' },
        { index: 2, src: 'slides/0001.html' },
      ],
      total: 2,
    },
    {
      label: 'duplicate src',
      entries: [
        { index: 0, src: 'slides/0000.html' },
        { index: 1, src: 'slides/0000.html' },
      ],
      total: 2,
    },
  ])('rejects a $label', async ({ entries, total }) => {
    await writeSlides('0000.html', '0001.html');
    await expect(discoverDeckSlides(deckDirectory, manifest(entries), total)).rejects.toMatchObject({
      code: 'conversion_error',
    });
  });

  it.each([
    '../outside.html',
    '/slides/0000.html',
    'https://example.invalid/slides/0000.html',
    'file:///slides/0000.html',
    'slides/../outside.html',
    'slides/./0000.html',
    'slides//0000.html',
    'slides/0000.html?download=1',
    'slides/0000.html#slide',
    'slides\\0000.html',
    'slides/0000.txt',
  ])('rejects unsafe manifest src %s', async (src) => {
    await writeSlides('0000.html');
    await expect(discoverDeckSlides(deckDirectory, manifest([{ index: 0, src }]), 1)).rejects.toMatchObject({
      code: 'conversion_error',
    });
  });

  it('rejects a manifest whose slide file is missing', async () => {
    await writeSlides('0000.html');
    await expect(
      discoverDeckSlides(deckDirectory, manifest([{ index: 0, src: 'slides/0001.html' }]), 1)
    ).rejects.toMatchObject({ code: 'conversion_error' });
  });

  it('rejects a manifest src that points to a directory', async () => {
    await fs.mkdir(path.join(deckDirectory, 'slides/0000.html'), { recursive: true });
    await expect(
      discoverDeckSlides(deckDirectory, manifest([{ index: 0, src: 'slides/0000.html' }]), 1)
    ).rejects.toMatchObject({ code: 'conversion_error' });
  });

  it('rejects a manifest symlink that escapes the converted deck', async () => {
    const outsideDirectory = path.join(fixtureDirectory, 'outside');
    await fs.mkdir(outsideDirectory);
    await fs.writeFile(path.join(outsideDirectory, '0000.html'), '<!doctype html>Outside deck');
    await fs.mkdir(path.join(deckDirectory, 'slides'));
    await fs.symlink(
      outsideDirectory,
      path.join(deckDirectory, 'slides/escape'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(
      discoverDeckSlides(deckDirectory, manifest([{ index: 0, src: 'slides/escape/0000.html' }]), 1)
    ).rejects.toMatchObject({ code: 'conversion_error' });
  });

  it.each([0, 1])('discovers a %i-based numeric fallback in numeric page order', async (base) => {
    const names = Array.from({ length: 12 }, (_, index) => `${index + base}.html`);
    await writeSlides(...[...names].reverse(), 'notes.html', 'slide-1.html');

    await expect(discoverDeckSlides(deckDirectory, '<main>Lazy deck</main>', 12)).resolves.toEqual(
      names.map((name, index) => ({
        page: index + 1,
        path: path.join(deckDirectory, 'slides', name),
      }))
    );
  });

  it.each([
    { label: 'duplicate numeric identifiers', names: ['0.html', '0000.html'], total: 2 },
    { label: 'sparse pages', names: ['0000.html', '0002.html'], total: 2 },
    { label: 'nonzero/nonone start', names: ['0002.html', '0003.html'], total: 2 },
    { label: 'missing pages', names: ['0000.html'], total: 2 },
    { label: 'extra pages', names: ['0000.html', '0001.html'], total: 1 },
    { label: 'unsafe integer index', names: ['9007199254740992.html'], total: 1 },
    { label: 'no numeric pages', names: ['notes.html'], total: 1 },
  ])('rejects fallback files with $label', async ({ names, total }) => {
    await writeSlides(...names);
    await expect(discoverDeckSlides(deckDirectory, '', total)).rejects.toMatchObject({
      code: 'conversion_error',
    });
  });

  it('rejects an empty slides directory', async () => {
    await fs.mkdir(path.join(deckDirectory, 'slides'));
    await expect(discoverDeckSlides(deckDirectory, '', 1)).rejects.toMatchObject({
      code: 'conversion_error',
    });
  });

  it('rejects numeric fallback entries that are directories, not files', async () => {
    await fs.mkdir(path.join(deckDirectory, 'slides/0000.html'), { recursive: true });
    await expect(discoverDeckSlides(deckDirectory, '', 1)).rejects.toMatchObject({
      code: 'conversion_error',
    });
  });

  it('rejects a fallback slides directory symlink outside the converted deck', async () => {
    const outsideDirectory = path.join(fixtureDirectory, 'outside');
    await fs.mkdir(outsideDirectory);
    await fs.writeFile(path.join(outsideDirectory, '0000.html'), '<!doctype html>Outside deck');
    await fs.symlink(
      outsideDirectory,
      path.join(deckDirectory, 'slides'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    await expect(discoverDeckSlides(deckDirectory, '', 1)).rejects.toMatchObject({
      code: 'conversion_error',
    });
  });

  it('rejects a non-directory slides path', async () => {
    await fs.writeFile(path.join(deckDirectory, 'slides'), 'not a directory');
    await expect(discoverDeckSlides(deckDirectory, '', 1)).rejects.toMatchObject({
      code: 'conversion_error',
    });
  });

  it('returns undefined for legacy embedded HTML without a slides directory', async () => {
    await expect(
      discoverDeckSlides(deckDirectory, '<div id="deck"><section class="slide"></section></div>', 1)
    ).resolves.toBeUndefined();
  });
});

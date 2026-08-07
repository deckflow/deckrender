import { describe, expect, it } from 'vitest';
import { frameName, inferFromOutputPath, templatedName } from '../../src/output/naming.js';
import { layerOptions, PROFILES } from '../../src/cli/profiles.js';
import { extensionOf, normalizeTaskResult } from '../../src/engines/artifacts.js';
import { withBaseHref } from '../../src/input/resolve.js';

describe('frameName', () => {
  it('pads to at least three digits', () => {
    expect(frameName(1, 3, '.png')).toBe('001.png');
    expect(frameName(12, 20, '.webp')).toBe('012.webp');
  });

  it('widens for documents past 999 pages', () => {
    expect(frameName(7, 1200, '.png')).toBe('0007.png');
  });
});

describe('templatedName', () => {
  it('inserts the frame number before the extension', () => {
    expect(templatedName('out.png', 2, 12)).toBe('out-002.png');
    expect(templatedName('shots/deck.jpg', 1, 5)).toBe('shots/deck-001.jpg');
  });
});

describe('inferFromOutputPath', () => {
  it.each([
    ['deck.pdf', { format: 'pdf' }],
    ['deck.mp4', { format: 'video' }],
    ['shot.png', { format: 'image', imageFormat: 'png' }],
    ['shot.jpeg', { format: 'image', imageFormat: 'jpg' }],
    ['shot.webp', { format: 'image', imageFormat: 'webp' }],
  ])('infers %s', (out, expected) => {
    expect(inferFromOutputPath(out)).toEqual(expected);
  });

  it('infers nothing from a directory or an unknown extension', () => {
    expect(inferFromOutputPath('frames')).toEqual({});
    expect(inferFromOutputPath('out.zip')).toEqual({});
  });
});

describe('layerOptions', () => {
  it('applies profile defaults and marks them soft', () => {
    const { options, soft } = layerOptions(PROFILES.web, {}, {});
    expect(options).toMatchObject({ format: 'image', imageFormat: 'webp', width: 1920 });
    expect([...soft].sort()).toEqual(['imageFormat', 'quality', 'width']);
  });

  it('lets explicit flags override the profile and stay hard', () => {
    const { options, soft } = layerOptions(PROFILES.web, {}, { imageFormat: 'png' });
    expect(options.imageFormat).toBe('png');
    expect(soft.has('imageFormat')).toBe(false);
  });

  it('orders profile below config below flags', () => {
    const { options } = layerOptions(PROFILES.thumbnail, { width: 800 }, { width: 1000 });
    expect(options.width).toBe(1000);

    const viaConfig = layerOptions(PROFILES.thumbnail, { width: 800 }, {});
    expect(viaConfig.options.width).toBe(800);
    expect(viaConfig.soft.has('width')).toBe(true);
  });

  it('does not give the print profile a quality that pdf routes would reject', () => {
    expect(PROFILES.print.quality).toBeUndefined();
  });
});

describe('normalizeTaskResult', () => {
  it('reads a multi-frame ConvertFileResult array with bounds', () => {
    const artifacts = normalizeTaskResult([
      ['https://cdn/1.png', 100, 'h1', { w: 1920, h: 1080, total: 2 }],
      ['https://cdn/2.png', 200, 'h2', { w: 1920, h: 1080, total: 2 }],
    ]);

    expect(artifacts).toEqual([
      { page: 1, source: 'https://cdn/1.png', ext: '.png', bytes: 100, width: 1920, height: 1080 },
      { page: 2, source: 'https://cdn/2.png', ext: '.png', bytes: 200, width: 1920, height: 1080 },
    ]);
  });

  it('reads a single FileResult tuple', () => {
    expect(normalizeTaskResult(['https://cdn/a.webp', 42, 'hash'])).toEqual([
      { page: 1, source: 'https://cdn/a.webp', ext: '.webp', bytes: 42 },
    ]);
  });

  it('unwraps the html2pptx envelope', () => {
    expect(normalizeTaskResult({ target: ['https://cdn/a.pptx', 9, 'h'], usedFonts: [] })).toEqual([
      { page: 1, source: 'https://cdn/a.pptx', ext: '.pptx', bytes: 9 },
    ]);
  });

  it('tolerates a null bounds slot', () => {
    expect(normalizeTaskResult([['https://cdn/1.png', 1, 'h', null]])[0]).toEqual({
      page: 1,
      source: 'https://cdn/1.png',
      ext: '.png',
      bytes: 1,
    });
  });

  it('returns nothing for an unrecognized payload', () => {
    expect(normalizeTaskResult({ nope: true })).toEqual([]);
  });
});

describe('extensionOf', () => {
  it('ignores query strings on signed URLs', () => {
    expect(extensionOf('https://cdn/a/b/001.PNG?sig=abc&x=1')).toBe('.png');
  });

  it('falls back to .bin when there is no extension', () => {
    expect(extensionOf('https://cdn/download')).toBe('.bin');
  });
});

describe('withBaseHref', () => {
  it('injects a base tag inside head', () => {
    const html = withBaseHref('<html><head><title>t</title></head><body/></html>', 'https://e.com/a/');
    expect(html).toContain('<head><base href="https://e.com/a/">');
  });

  it('creates a head when the document lacks one', () => {
    expect(withBaseHref('<html><body>x</body></html>', 'https://e.com/')).toContain(
      '<head><base href="https://e.com/"></head>'
    );
  });

  it('prepends for a bare fragment', () => {
    expect(withBaseHref('<div>x</div>', 'https://e.com/')).toBe('<base href="https://e.com/"><div>x</div>');
  });

  it('leaves an existing base tag alone', () => {
    const html = '<html><head><base href="https://other/"></head></html>';
    expect(withBaseHref(html, 'https://e.com/')).toBe(html);
  });

  it('escapes quotes in the url', () => {
    expect(withBaseHref('<div/>', 'https://e.com/?a="b"&c=d')).toContain(
      '<base href="https://e.com/?a=&quot;b&quot;&amp;c=d">'
    );
  });
});

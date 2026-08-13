import { describe, expect, it } from 'vitest';
import { buildPlan, type SoftOption } from '../../src/core/plan.js';
import { snapToTier } from '../../src/core/routes.js';
import type { DeckRenderError } from '../../src/errors/index.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as DeckRenderError).code;
  }
  throw new Error('expected a throw');
}

describe('route selection', () => {
  it('maps pptx to image with one direct task', () => {
    const { plan } = buildPlan({ source: 'pptx', target: 'image' });
    expect(plan.kind).toBe('direct');
    expect(plan.steps.map((s) => s.task)).toEqual(['convertor.ppt2image']);
  });

  it('chains docx to image through PDF', () => {
    const { plan } = buildPlan({ source: 'docx', target: 'image' });
    expect(plan.kind).toBe('derived');
    expect(plan.steps.map((s) => s.task)).toEqual(['convertor.doc2pdf', 'convertor.pdf2image']);
  });

  it('appends a per-frame conversion for webp', () => {
    const { plan } = buildPlan({ source: 'pptx', target: 'image', imageFormat: 'webp' });
    expect(plan.steps.map((s) => s.task)).toEqual(['convertor.ppt2image', 'image.convertWebp']);
    expect(plan.steps.at(-1)?.fanout).toBe('per-frame');
    expect(plan.kind).toBe('derived');
  });

  it('still asks the backend for png when the target is webp', () => {
    const { plan } = buildPlan({ source: 'pptx', target: 'image', imageFormat: 'webp' });
    expect(plan.steps[0]?.params).toMatchObject({ format: 'png' });
  });

  it('copies pdf to pdf without any backend task', () => {
    const { plan } = buildPlan({ source: 'pdf', target: 'pdf' });
    expect(plan.kind).toBe('passthrough');
    expect(plan.steps.map((s) => s.task)).toEqual(['passthrough']);
  });

  it('carries the html-to-pdf fidelity caveat', () => {
    const { plan } = buildPlan({ source: 'html', target: 'pdf' });
    expect(plan.caveat).toMatch(/rebuilt as PPTX/);
  });

  it('rejects format pairs with no route', () => {
    expect(codeOf(() => buildPlan({ source: 'md', target: 'pdf' }))).toBe('unsupported_format');
    expect(codeOf(() => buildPlan({ source: 'docx', target: 'video' }))).toBe('unsupported_format');
  });

  it('chains html to video through PPTX', () => {
    const { plan } = buildPlan({ source: 'html', target: 'video' });
    expect(plan.kind).toBe('derived');
    expect(plan.steps.map((s) => s.task)).toEqual(['convertor.html2pptx', 'convertor.ppt2video']);
    expect(plan.caveat).toMatch(/rebuilt as PPTX/);
  });

  it('runs iWork word processing and spreadsheet formats locally', () => {
    for (const source of ['pages', 'numbers'] as const) {
      for (const target of ['image', 'pdf'] as const) {
        const { plan } = buildPlan({ source, target });
        expect(plan.kind).toBe('local');
        expect(plan.steps.map((s) => s.task)).toEqual(['local:iwork-preview']);
        expect(plan.caveat).toMatch(/first page only/);
      }
    }
  });

  it('does not append a webp step to a local route', () => {
    // The local engine has no image converter, so webp cannot be honoured here.
    const { plan } = buildPlan({ source: 'pages', target: 'image', imageFormat: 'webp' });
    expect(plan.steps.map((s) => s.task)).toEqual(['local:iwork-preview']);
  });
});

describe('coming soon', () => {
  it.each([
    ['ppt', 'pdf'],
    ['xlsx', 'image'],
    ['xlsx', 'pdf'],
    ['pdf', 'video'],
    ['key', 'video'],
  ] as const)('reports %s to %s as not_implemented', (source, target) => {
    expect(codeOf(() => buildPlan({ source, target }))).toBe('not_implemented');
  });

  it('says what is blocking it rather than just refusing', () => {
    try {
      buildPlan({ source: 'xlsx', target: 'pdf' });
    } catch (error) {
      const err = error as DeckRenderError;
      expect(err.message).toMatch(/coming soon/);
      expect(err.hint).toMatch(/layout engine/);
    }
  });

  it('keeps combinations that will never work as unsupported_format', () => {
    // "Not yet" and "never" are different answers and lead to different actions.
    expect(codeOf(() => buildPlan({ source: 'xlsx', target: 'video' }))).toBe('unsupported_format');
    expect(codeOf(() => buildPlan({ source: 'pages', target: 'video' }))).toBe('unsupported_format');
    expect(codeOf(() => buildPlan({ source: 'doc', target: 'image' }))).toBe('unsupported_format');
    expect(codeOf(() => buildPlan({ source: 'doc', target: 'pdf' }))).toBe('unsupported_format');
  });
});

describe('resolution mapping', () => {
  it('snaps ppt2image resolution to an allowed tier and warns', () => {
    const { plan, warnings } = buildPlan({ source: 'pptx', target: 'image', width: 2000 });
    expect(plan.steps[0]?.params).toMatchObject({ resolution: 1920 });
    expect(warnings[0]?.message).toMatch(/snapped to 1920/);
  });

  it('passes an exact tier through without a warning', () => {
    const { plan, warnings } = buildPlan({ source: 'pptx', target: 'image', width: 2560 });
    expect(plan.steps[0]?.params).toMatchObject({ resolution: 2560 });
    expect(warnings).toEqual([]);
  });

  it('lets pdf2image take an arbitrary long edge', () => {
    const { plan } = buildPlan({ source: 'pdf', target: 'image', width: 1234 });
    expect(plan.steps[0]?.params).toMatchObject({ resolution: 1234 });
  });

  it('multiplies the task base for --scale', () => {
    const { plan } = buildPlan({ source: 'pptx', target: 'image', scale: 2 });
    // base 1920 * 2 = 3840, snapped down to the highest tier
    expect(plan.steps[0]?.params).toMatchObject({ resolution: 2560 });
  });

  it('gives a chained docx route the resolution knob of its final task', () => {
    const { plan } = buildPlan({ source: 'docx', target: 'image', width: 1234 });
    expect(plan.steps[1]?.params).toMatchObject({ resolution: 1234 });
  });

  it('routes --width to the html viewport width', () => {
    const { plan } = buildPlan({ source: 'html', target: 'image', width: 800, scale: 2 });
    expect(plan.steps[0]?.params).toMatchObject({ width: 800, scale: 2, fullPage: true });
  });
});

describe('unsupported options', () => {
  it('rejects --width on keynote, whose task takes no parameters', () => {
    expect(codeOf(() => buildPlan({ source: 'key', target: 'image', width: 1920 }))).toBe(
      'unsupported_option'
    );
  });

  it('rejects jpg on tasks that only emit png', () => {
    expect(codeOf(() => buildPlan({ source: 'html', target: 'image', imageFormat: 'jpg' }))).toBe(
      'unsupported_option'
    );
  });

  it('allows webp on those tasks, since it is a separate conversion step', () => {
    const { plan } = buildPlan({ source: 'html', target: 'image', imageFormat: 'webp' });
    expect(plan.steps.map((s) => s.task)).toEqual(['convertor.html2png', 'image.convertWebp']);
  });

  it('rejects --pages on single-file output', () => {
    expect(codeOf(() => buildPlan({ source: 'pptx', target: 'pdf', pages: [1] }))).toBe('unsupported_option');
  });

  it('rejects --pages on single-frame image output', () => {
    expect(codeOf(() => buildPlan({ source: 'html', target: 'image', pages: [1] }))).toBe(
      'unsupported_option'
    );
  });

  it('rejects --quality on pdf output', () => {
    expect(codeOf(() => buildPlan({ source: 'pptx', target: 'pdf', quality: 'high' }))).toBe(
      'unsupported_option'
    );
  });

  it('rejects --embed-fonts off the html2pptx route', () => {
    expect(codeOf(() => buildPlan({ source: 'pptx', target: 'pdf', embedFonts: true }))).toBe(
      'unsupported_option'
    );
  });

  it('accepts --embed-fonts on the html to pdf route', () => {
    const { plan } = buildPlan({ source: 'html', target: 'pdf', embedFonts: true });
    expect(plan.steps[0]?.params).toMatchObject({ needEmbedFonts: true });
  });
});

describe('soft options from profiles', () => {
  const soft = (...keys: SoftOption[]): ReadonlySet<SoftOption> => new Set(keys);

  it('drops an unsupported profile default with a warning instead of failing', () => {
    const { plan, warnings } = buildPlan({
      source: 'html',
      target: 'image',
      pages: [1],
      imageFormat: 'jpg',
      soft: soft('pages', 'imageFormat'),
    });

    expect(plan.steps.map((s) => s.task)).toEqual(['convertor.html2png']);
    expect(warnings.map((w) => w.message)).toEqual([
      expect.stringContaining('--image-format from profile/config'),
      expect.stringContaining('--pages from profile/config'),
    ]);
  });

  it('still fails when the same option was typed explicitly', () => {
    expect(codeOf(() => buildPlan({ source: 'html', target: 'image', pages: [1] }))).toBe(
      'unsupported_option'
    );
  });
});

describe('quality presets', () => {
  it('picks a tier and encoding for slides', () => {
    const { plan } = buildPlan({ source: 'pptx', target: 'image', quality: 'low' });
    expect(plan.steps[0]?.params).toMatchObject({ resolution: 1080, format: 'jpg' });
  });

  it('uses the pdf tier for pdf input', () => {
    const { plan } = buildPlan({ source: 'pdf', target: 'image', quality: 'medium' });
    expect(plan.steps[0]?.params).toMatchObject({ resolution: 1600, format: 'png' });
  });

  it('yields to an explicit --width', () => {
    const { plan } = buildPlan({ source: 'pdf', target: 'image', quality: 'high', width: 900 });
    expect(plan.steps[0]?.params).toMatchObject({ resolution: 900 });
  });
});

describe('snapToTier', () => {
  it.each([
    [1000, 1080],
    [1500, 1920],
    [2000, 1920],
    [2300, 2560],
    [9999, 2560],
  ])('snaps %i to %i', (input, expected) => {
    expect(snapToTier(input, [1080, 1920, 2560])).toBe(expected);
  });

  it('rounds a tie up to the larger tier', () => {
    expect(snapToTier(1500, [1080, 1920])).toBe(1920);
  });
});

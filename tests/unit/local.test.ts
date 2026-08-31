import { describe, expect, it } from 'vitest';
import { concreteEngineFor, resolveEnginePreference } from '../../src/core/engine-selection.js';
import { buildPlan, type SoftOption } from '../../src/core/plan.js';
import { parseDeckViewport, imageDimensions } from '../../src/engines/local/capture.js';
import type { DeckRenderError } from '../../src/errors/index.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as DeckRenderError).code;
  }
  throw new Error('expected a throw');
}

describe('local render planning', () => {
  it('plans the PPTX image pipeline independently from cloud tasks', () => {
    const { plan } = buildPlan({ engine: 'local', source: 'pptx', target: 'image' });
    expect(plan.kind).toBe('direct');
    expect(plan.steps.map((step) => step.task)).toEqual(['local.office2html', 'local.capture']);
  });

  it('plans vector PDF printing and numeric merge as an explicit chain', () => {
    const { plan } = buildPlan({ engine: 'local', source: 'pptx', target: 'pdf' });
    expect(plan.steps.map((step) => step.task)).toEqual([
      'local.office2html',
      'local.capture-pdf',
      'local.pdf-merge',
    ]);
    expect(plan.caveat).toMatch(/Chromium/);
  });

  it('lets local multi-page inputs select pages before capture', () => {
    const slides = buildPlan({
      engine: 'local',
      source: 'pptx',
      target: 'image',
      pages: [2, 10, 12],
    }).plan;
    const pdf = buildPlan({
      engine: 'local',
      source: 'pdf',
      target: 'image',
      pages: [1, 3],
    }).plan;
    expect(slides.pages).toEqual([2, 10, 12]);
    expect(pdf.pages).toEqual([1, 3]);
  });

  it('rejects local WebP and single-page HTML page selection', () => {
    expect(
      codeOf(() => buildPlan({ engine: 'local', source: 'pptx', target: 'image', imageFormat: 'webp' }))
    ).toBe('unsupported_option');
    expect(codeOf(() => buildPlan({ engine: 'local', source: 'html', target: 'image', pages: [1] }))).toBe(
      'unsupported_option'
    );
  });

  it('drops a soft WebP profile default and keeps local PNG output', () => {
    const soft: ReadonlySet<SoftOption> = new Set(['imageFormat']);
    const { plan, warnings } = buildPlan({
      engine: 'local',
      source: 'pptx',
      target: 'image',
      imageFormat: 'webp',
      soft,
    });
    expect(plan.imageFormat).toBe('png');
    expect(warnings[0]?.message).toContain('Ignoring --image-format');
  });

  it('maps quality to slide and PDF long-edge presets without snapping', () => {
    const slides = buildPlan({
      engine: 'local',
      source: 'pptx',
      target: 'image',
      quality: 'medium',
    }).plan;
    const pdf = buildPlan({
      engine: 'local',
      source: 'pdf',
      target: 'image',
      quality: 'medium',
    }).plan;
    expect(slides.steps.at(-1)?.params).toMatchObject({ width: 1920, imageFormat: 'png' });
    expect(pdf.steps[0]?.params).toMatchObject({ width: 1600, imageFormat: 'png' });
  });

  it('distinguishes planned local formats from routes local will never run', () => {
    expect(codeOf(() => buildPlan({ engine: 'local', source: 'docx', target: 'image' }))).toBe(
      'not_implemented'
    );
    expect(codeOf(() => buildPlan({ engine: 'local', source: 'pptx', target: 'video' }))).toBe(
      'unsupported_format'
    );
  });
});

describe('engine selection', () => {
  it('uses flag over env over config over the cloud default', () => {
    expect(resolveEnginePreference('local', 'cloud', { DECKRENDER_ENGINE: 'auto' })).toBe('local');
    expect(resolveEnginePreference(undefined, 'cloud', { DECKRENDER_ENGINE: 'auto' })).toBe('auto');
    expect(resolveEnginePreference(undefined, 'local', {})).toBe('local');
    expect(resolveEnginePreference(undefined, undefined, {})).toBe('cloud');
  });

  it('makes auto local-first and reports cloud fallback explicitly', () => {
    expect(concreteEngineFor('auto', 'pptx', 'image')).toEqual({
      engine: 'local',
      fellBackToCloud: false,
    });
    expect(concreteEngineFor('auto', 'docx', 'image')).toEqual({
      engine: 'cloud',
      fellBackToCloud: true,
    });
  });

  it('never changes an explicit local choice into cloud', () => {
    expect(concreteEngineFor('local', 'docx', 'image')).toEqual({
      engine: 'local',
      fellBackToCloud: false,
    });
  });
});

describe('local capture contracts', () => {
  it('reads office2html viewport and decimal aspect ratio', () => {
    const html = `<meta name="viewport" content="width=1920"><style>#deck { width:1920px; aspect-ratio:1.3333 }</style>`;
    expect(parseDeckViewport(html)).toEqual({ width: 1920, height: 1440 });
  });

  it('reads reordered viewport attributes and fractional aspect ratios', () => {
    expect(
      parseDeckViewport(
        '<meta content="width=1600" name="viewport"><style>#deck { aspect-ratio: 16 / 9 }</style>'
      )
    ).toEqual({ width: 1600, height: 900 });
  });

  it('uses standalone canvas dimensions, including portrait pages', () => {
    expect(parseDeckViewport('<style>.slide-canvas { width:640px; height:360px }</style>')).toEqual({
      width: 640,
      height: 360,
    });
    expect(parseDeckViewport('<style>.slide-canvas { width:600px; height:800px }</style>')).toEqual({
      width: 600,
      height: 800,
    });
  });

  it('ignores invalid meta widths and falls back from invalid aspect ratios', () => {
    expect(
      parseDeckViewport(
        '<meta name="viewport" content="width=0"><style>#deck { width:640px; aspect-ratio:0 / 0 }</style>'
      )
    ).toEqual({ width: 640, height: 360 });
  });

  it('reads exact PNG dimensions from Chromium output', () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(png);
    png.writeUInt32BE(1000, 16);
    png.writeUInt32BE(751, 20);
    expect(imageDimensions(png)).toEqual({ width: 1000, height: 751 });
  });
});

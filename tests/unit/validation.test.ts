import { describe, expect, it } from 'vitest';
import { buildPlan, type PlanInput } from '../../src/core/plan.js';
import {
  MAX_PAGE_NUMBER,
  MAX_RENDER_SCALE,
  MAX_RENDER_WIDTH,
  MAX_TIMEOUT_SECONDS,
  validateRenderOptions,
} from '../../src/core/validation.js';
import type { DeckRenderError } from '../../src/errors/index.js';
import type { RenderOptions } from '../../src/types.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as DeckRenderError).code;
  }
  throw new Error('expected a throw');
}

function plan(overrides: Record<string, unknown>): PlanInput {
  return { source: 'pdf', target: 'image', ...overrides } as PlanInput;
}

function renderOptions(overrides: Record<string, unknown>): RenderOptions {
  return { input: 'document.pdf', ...overrides } as RenderOptions;
}

describe('public SDK runtime validation', () => {
  it.each([-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_RENDER_WIDTH + 1])(
    'rejects invalid width %s',
    (width) => {
      expect(codeOf(() => buildPlan(plan({ width })))).toBe('usage_error');
    }
  );

  it.each([-1, 0, Number.NaN, Number.POSITIVE_INFINITY, MAX_RENDER_SCALE + 1])(
    'rejects invalid scale %s',
    (scale) => {
      expect(codeOf(() => buildPlan(plan({ scale })))).toBe('usage_error');
    }
  );

  it('accepts the documented numeric boundaries', () => {
    expect(buildPlan(plan({ width: MAX_RENDER_WIDTH })).plan.steps[0]?.params).toMatchObject({
      resolution: MAX_RENDER_WIDTH,
    });
    expect(buildPlan(plan({ scale: MAX_RENDER_SCALE })).plan.steps[0]?.params).toMatchObject({
      resolution: 1080 * MAX_RENDER_SCALE,
    });
  });

  it.each([
    { pages: [0] },
    { pages: [-1] },
    { pages: [1.5] },
    { pages: [Number.NaN] },
    { pages: [MAX_PAGE_NUMBER + 1] },
    { pages: [] },
  ])('rejects invalid page arrays $pages', ({ pages }) => {
    expect(codeOf(() => buildPlan(plan({ pages })))).toBe('usage_error');
  });

  it('rejects invalid runtime enum values as DeckRenderErrors', () => {
    expect(codeOf(() => buildPlan(plan({ quality: 'ultra' })))).toBe('usage_error');
    expect(codeOf(() => buildPlan(plan({ imageFormat: 'gif' })))).toBe('usage_error');
  });

  it.each([-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_TIMEOUT_SECONDS + 1])(
    'rejects invalid timeout %s before rendering',
    (timeout) => {
      expect(codeOf(() => validateRenderOptions(renderOptions({ timeout })))).toBe('usage_error');
    }
  );

  it('rejects malformed JavaScript render options', () => {
    expect(codeOf(() => validateRenderOptions(renderOptions({ format: 'gif' })))).toBe('usage_error');
    expect(codeOf(() => validateRenderOptions(renderOptions({ onProgress: true })))).toBe('usage_error');
  });
});

import { DeckRenderError } from '../errors/DeckRenderError.js';
import {
  ENGINE_PREFERENCES,
  IMAGE_FORMATS,
  PROFILE_NAMES,
  QUALITIES,
  SOURCE_FORMATS,
  TARGET_FORMATS,
  type RenderOptions,
} from '../types.js';
import type { PlanInput } from './plan.js';

/** Public guardrails shared by the SDK, CLI and persisted configuration. */
export const MAX_RENDER_WIDTH = 32_768;
export const MAX_RENDER_SCALE = 16;
export const MAX_TIMEOUT_SECONDS = 86_400;
export const MAX_PAGE_NUMBER = 100_000;

export function validateRenderOptions(options: RenderOptions): void {
  if (!options || typeof options !== 'object') {
    throw DeckRenderError.usage('Render options must be an object.');
  }
  if (typeof options.input !== 'string' || options.input.trim().length === 0) {
    throw DeckRenderError.usage('Invalid input: expected a non-empty path, URL, or -.');
  }

  if (options.from !== undefined) {
    assertEnum('source format', options.from, SOURCE_FORMATS);
  }
  if (options.engine !== undefined) {
    assertEnum('engine', options.engine, ENGINE_PREFERENCES);
  }
  if (options.format !== undefined) {
    assertEnum('target format', options.format, TARGET_FORMATS);
  }
  if (options.imageFormat !== undefined) {
    assertEnum('image format', options.imageFormat, IMAGE_FORMATS);
  }
  if (options.quality !== undefined) {
    assertEnum('quality', options.quality, QUALITIES);
  }
  if (options.profile !== undefined) {
    assertEnum('profile', options.profile, PROFILE_NAMES);
  }
  if (options.out !== undefined && typeof options.out !== 'string') {
    throw DeckRenderError.usage('Invalid out: expected a path string.');
  }
  if (options.width !== undefined) {
    assertPositiveNumber('width', options.width, { integer: true, max: MAX_RENDER_WIDTH });
  }
  if (options.scale !== undefined) {
    assertPositiveNumber('scale', options.scale, { max: MAX_RENDER_SCALE });
  }
  if (options.timeout !== undefined) {
    assertPositiveNumber('timeout', options.timeout, {
      integer: true,
      max: MAX_TIMEOUT_SECONDS,
    });
  }
  if (options.executablePath !== undefined && typeof options.executablePath !== 'string') {
    throw DeckRenderError.usage('Invalid executablePath: expected a path string.');
  }
  if (options.office2htmlPath !== undefined && typeof options.office2htmlPath !== 'string') {
    throw DeckRenderError.usage('Invalid office2htmlPath: expected a path string.');
  }
  if (options.pages !== undefined && typeof options.pages !== 'string') {
    throw DeckRenderError.usage('Invalid pages: expected a page selection string.');
  }
  if (options.embedFonts !== undefined && typeof options.embedFonts !== 'boolean') {
    throw DeckRenderError.usage('Invalid embedFonts: expected a boolean.');
  }
  if (options.onProgress !== undefined && typeof options.onProgress !== 'function') {
    throw DeckRenderError.usage('Invalid onProgress: expected a function.');
  }
  if (options.soft !== undefined && typeof options.soft.has !== 'function') {
    throw DeckRenderError.usage('Invalid soft options: expected a ReadonlySet.');
  }
}

export function validatePlanInput(input: PlanInput): void {
  if (!input || typeof input !== 'object') {
    throw DeckRenderError.usage('Plan input must be an object.');
  }

  assertEnum('source format', input.source, SOURCE_FORMATS);
  assertEnum('target format', input.target, TARGET_FORMATS);

  if (input.engine !== undefined) {
    assertEnum('plan engine', input.engine, ['local', 'cloud']);
  }

  if (input.imageFormat !== undefined) {
    assertEnum('image format', input.imageFormat, IMAGE_FORMATS);
  }
  if (input.quality !== undefined) {
    assertEnum('quality', input.quality, QUALITIES);
  }
  if (input.width !== undefined) {
    assertPositiveNumber('width', input.width, { integer: true, max: MAX_RENDER_WIDTH });
  }
  if (input.scale !== undefined) {
    assertPositiveNumber('scale', input.scale, { max: MAX_RENDER_SCALE });
  }
  if (input.pages !== undefined) {
    if (!Array.isArray(input.pages) || input.pages.length === 0) {
      throw DeckRenderError.usage('Invalid pages: expected a non-empty array of page numbers.');
    }
    for (const page of input.pages) {
      if (!Number.isSafeInteger(page) || page <= 0 || page > MAX_PAGE_NUMBER) {
        throw DeckRenderError.usage(
          `Invalid page number: ${displayNumber(page)}. Expected an integer from 1 to ${MAX_PAGE_NUMBER}.`
        );
      }
    }
  }
  if (input.embedFonts !== undefined && typeof input.embedFonts !== 'boolean') {
    throw DeckRenderError.usage('Invalid embedFonts: expected a boolean.');
  }
  if (input.soft !== undefined && typeof input.soft.has !== 'function') {
    throw DeckRenderError.usage('Invalid soft options: expected a ReadonlySet.');
  }
}

interface NumberRules {
  integer?: boolean;
  max: number;
}

export function assertPositiveNumber(name: string, value: number, rules: NumberRules): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw DeckRenderError.usage(`Invalid ${name}: ${displayNumber(value)}. Expected a positive number.`);
  }
  if (rules.integer && !Number.isSafeInteger(value)) {
    throw DeckRenderError.usage(`Invalid ${name}: ${displayNumber(value)}. Expected a positive integer.`);
  }
  if (value > rules.max) {
    throw DeckRenderError.usage(
      `Invalid ${name}: ${displayNumber(value)}. Maximum supported value is ${rules.max}.`
    );
  }
}

function assertEnum(name: string, value: unknown, allowed: readonly string[]): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw DeckRenderError.usage(`Invalid ${name}: ${String(value)}. Allowed values: ${allowed.join(', ')}.`);
  }
}

function displayNumber(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) {
    return 'NaN';
  }
  return String(value);
}

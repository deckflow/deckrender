import { DeckRenderError } from '../errors/index.js';
import { ENGINE_PREFERENCES, type EnginePreference, type SourceFormat, type TargetFormat } from '../types.js';
import { findLocalRoute } from '../engines/local/routes.js';

export const DECKRENDER_ENGINE_ENV = 'DECKRENDER_ENGINE';

/** Resolve CLI/config selection without letting an invalid env value slip through. */
export function resolveEnginePreference(
  explicit?: EnginePreference,
  configured?: EnginePreference,
  env: NodeJS.ProcessEnv = process.env
): EnginePreference {
  const value = explicit ?? env[DECKRENDER_ENGINE_ENV] ?? configured ?? 'cloud';
  if (!(ENGINE_PREFERENCES as readonly string[]).includes(value)) {
    throw DeckRenderError.usage(`Invalid engine: ${value}.`, {
      hint: `Allowed values: ${ENGINE_PREFERENCES.join(', ')}. Check $${DECKRENDER_ENGINE_ENV}.`,
    });
  }
  return value as EnginePreference;
}

export interface ConcreteEngineSelection {
  engine: Exclude<EnginePreference, 'auto'>;
  fellBackToCloud: boolean;
}

/** `auto` is local-first; explicit `local` is never allowed to become cloud. */
export function concreteEngineFor(
  preference: EnginePreference,
  source: SourceFormat,
  target: TargetFormat
): ConcreteEngineSelection {
  if (preference !== 'auto') {
    return { engine: preference, fellBackToCloud: false };
  }
  if (findLocalRoute(source, target)) {
    return { engine: 'local', fellBackToCloud: false };
  }
  return { engine: 'cloud', fellBackToCloud: true };
}

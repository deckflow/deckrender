import path from 'node:path';
import { validateArtifacts } from '../core/artifact-validation.js';
import { isHttpUrl } from './artifacts.js';
import type { EngineOutput } from './engine.js';

/** Node accepts local paths as well as remote artifacts. */
export function validateEngineOutput(engineName: string, value: unknown): EngineOutput {
  return validateArtifacts(engineName, value, (source) => isHttpUrl(source) || path.isAbsolute(source));
}

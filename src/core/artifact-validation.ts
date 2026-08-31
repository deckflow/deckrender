import { DeckRenderError } from '../errors/DeckRenderError.js';
import type { RenderArtifact } from '../types.js';
import type { EngineOutput } from '../engines/engine.js';

/** Validate the runtime contract at the boundary where third-party engines enter the SDK. */
export function validateArtifacts(
  engineName: string,
  value: unknown,
  validSource: (source: string) => boolean,
  sourceDescription = 'an http(s) URL or an absolute path'
): EngineOutput {
  if (!value || typeof value !== 'object') {
    throw invalidOutput(engineName, 'expected an object.');
  }

  const output = value as Record<string, unknown>;
  if (!Array.isArray(output.artifacts) || output.artifacts.length === 0) {
    throw invalidOutput(engineName, 'artifacts must be a non-empty array.');
  }
  if (!isPositiveSafeInteger(output.totalPages)) {
    throw invalidOutput(engineName, 'totalPages must be a positive integer.');
  }

  const artifacts = output.artifacts
    .map((artifact, index) => validateArtifact(engineName, artifact, index, validSource, sourceDescription))
    .sort((a, b) => a.page - b.page);
  if (new Set(artifacts.map((artifact) => artifact.page)).size !== artifacts.length) {
    throw invalidOutput(engineName, 'artifact page numbers must be unique.');
  }
  const highestPage = Math.max(...artifacts.map((artifact) => artifact.page));
  if (output.totalPages < highestPage) {
    throw invalidOutput(
      engineName,
      `totalPages (${output.totalPages}) cannot be less than artifact page ${highestPage}.`
    );
  }

  if (output.cleanup !== undefined && typeof output.cleanup !== 'function') {
    throw invalidOutput(engineName, 'cleanup must be a function when present.');
  }

  return {
    artifacts,
    totalPages: output.totalPages,
    ...(typeof output.cleanup === 'function'
      ? { cleanup: output.cleanup as () => Promise<void> | void }
      : {}),
  };
}

function validateArtifact(
  engineName: string,
  value: unknown,
  index: number,
  validSource: (source: string) => boolean,
  sourceDescription: string
): RenderArtifact {
  const label = `artifact ${index + 1}`;
  if (!value || typeof value !== 'object') {
    throw invalidOutput(engineName, `${label} must be an object.`);
  }

  const artifact = value as Record<string, unknown>;
  if (!isPositiveSafeInteger(artifact.page)) {
    throw invalidOutput(engineName, `${label}.page must be a positive integer.`);
  }
  if (typeof artifact.source !== 'string' || artifact.source.trim().length === 0) {
    throw invalidOutput(engineName, `${label}.source must be a non-empty string.`);
  }
  if (!validSource(artifact.source)) {
    throw invalidOutput(engineName, `${label}.source must be ${sourceDescription}.`);
  }
  if (typeof artifact.ext !== 'string' || !/^\.[a-z0-9]+$/i.test(artifact.ext)) {
    throw invalidOutput(engineName, `${label}.ext must be an extension such as .png.`);
  }

  validateOptionalNumber(engineName, label, artifact, 'bytes', false);
  validateOptionalNumber(engineName, label, artifact, 'width', true);
  validateOptionalNumber(engineName, label, artifact, 'height', true);

  return value as RenderArtifact;
}

function validateOptionalNumber(
  engineName: string,
  label: string,
  artifact: Record<string, unknown>,
  key: 'bytes' | 'width' | 'height',
  positive: boolean
): void {
  const value = artifact[key];
  if (value === undefined) {
    return;
  }
  const valid =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    (positive ? value > 0 : value >= 0);
  if (!valid) {
    throw invalidOutput(
      engineName,
      `${label}.${key} must be a ${positive ? 'positive' : 'non-negative'} integer when present.`
    );
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function invalidOutput(engineName: string, detail: string): DeckRenderError {
  return DeckRenderError.render(`Engine "${engineName}" returned invalid output: ${detail}`);
}

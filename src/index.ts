/**
 * @deckflow/deckrender
 *
 * Render PPTX, PDF, DOCX, Keynote, HTML and Markdown into images, PDF or video.
 *
 *   import { render } from '@deckflow/deckrender';
 *   await render({ input: 'deck.pptx', format: 'image', pages: '1-10', out: 'frames/' });
 */

export { createRenderer, render, type Renderer, type RendererOptions } from './core/renderer.js';

export { buildPlan, type PlanInput, type PlanResult, type SoftOption } from './core/plan.js';
export {
  MAX_PAGE_NUMBER,
  MAX_RENDER_SCALE,
  MAX_RENDER_WIDTH,
  MAX_TIMEOUT_SECONDS,
} from './core/validation.js';
export { applyPageSelection, parsePageSelection } from './core/pages.js';
export {
  ROUTES,
  KNOWN_UNRENDERABLE_EXTENSIONS,
  NOT_IMPLEMENTED,
  plannedReason,
  capabilityFor,
  findRoute,
  imageProducingTask,
  snapToTier,
  supportedTargets,
  type BaseRoute,
  type TaskCapability,
} from './core/routes.js';

export { CloudEngine, type CloudEngineOptions } from './engines/cloud.js';
export { normalizeTaskResult, extensionOf } from './engines/artifacts.js';
export type { EngineOutput, ExecuteContext, RenderEngine } from './engines/engine.js';

export { resolveInput, inputBaseName, withBaseHref, type ResolveInputOptions } from './input/resolve.js';
export { writeArtifacts, type WriteOptions, type WriteResult } from './output/writer.js';
export { DEFAULT_EXTENSION, frameName, inferFromOutputPath, templatedName } from './output/naming.js';

export {
  DEFAULT_API_BASE,
  describeCredentialOrigin,
  hasCredentials,
  readSharedCredentials,
  resolveCredentials,
  writeSharedCredentials,
  type CredentialOverrides,
  type CredentialSource,
  type ResolvedCredentials,
  type SharedCredentials,
} from './config/index.js';

export { PROFILES, layerOptions, type ProfileDefaults } from './cli/profiles.js';

export {
  DeckRenderError,
  ERROR_CODES,
  ExitCode,
  credentialsRejected,
  isDeckRenderError,
  mapSdkError,
  type ErrorCode,
  type SdkErrorContext,
} from './errors/index.js';

export * from './types.js';
export { VERSION } from './version.js';

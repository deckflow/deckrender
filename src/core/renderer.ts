import path from 'node:path';
import { createDeck, type DeckClient } from '@deckops/sdk';
import { DeckRenderError } from '../errors/index.js';
import { CloudEngine } from '../engines/cloud.js';
import { LocalEngine } from '../engines/local.js';
import type { EngineOutput, RenderEngine } from '../engines/engine.js';
import { inputBaseName, resolveInput } from '../input/resolve.js';
import { DEFAULT_EXTENSION } from '../output/naming.js';
import { writeArtifacts } from '../output/writer.js';
import { hasCredentials, resolveCredentials, type CredentialOverrides } from '../config/credentials.js';
import type { RenderArtifact, RenderOptions, RenderResult } from '../types.js';
import { parsePageSelection } from './pages.js';
import { buildPlan } from './plan.js';

export interface RendererOptions extends CredentialOverrides {
  /** Pre-built DeckOps client. Supplying one skips credential resolution. */
  client?: DeckClient;
  /** Custom engine. Overrides the built-in cloud engine. */
  engine?: RenderEngine;
  /** Called with non-fatal notices, e.g. a snapped resolution. */
  onWarning?: (message: string) => void;
  /** Interactive login hook, invoked by the SDK on a 401. */
  onUnauthorized?: () => Promise<{ token: string; spaceId?: string } | string>;
  /** Checkout hook, invoked by the SDK on a 402. */
  onPaymentRequired?: () => Promise<void>;
}

export interface Renderer {
  render(options: RenderOptions): Promise<RenderResult>;
}

export function createRenderer(rendererOptions: RendererOptions = {}): Renderer {
  return {
    render: (options) => runRender(options, rendererOptions),
  };
}

/** One-shot render. Equivalent to `createRenderer(opts).render(opts)`. */
export function render(options: RenderOptions & RendererOptions): Promise<RenderResult> {
  return runRender(options, options);
}

async function runRender(options: RenderOptions, rendererOptions: RendererOptions): Promise<RenderResult> {
  const startedAt = Date.now();
  const warn = rendererOptions.onWarning ?? (() => undefined);

  options.onProgress?.({ phase: 'resolve', message: `Resolving ${options.input}` });
  const input = await resolveInput(options.input, options.from ? { from: options.from } : {});

  const pages = options.pages ? parsePageSelection(options.pages) : undefined;

  options.onProgress?.({ phase: 'plan', message: 'Building render plan' });
  const { plan, warnings } = buildPlan({
    source: input.format,
    target: options.format ?? 'image',
    ...(options.imageFormat ? { imageFormat: options.imageFormat } : {}),
    ...(options.width !== undefined ? { width: options.width } : {}),
    ...(options.scale !== undefined ? { scale: options.scale } : {}),
    ...(options.quality ? { quality: options.quality } : {}),
    ...(pages ? { pages } : {}),
    ...(options.embedFonts !== undefined ? { embedFonts: options.embedFonts } : {}),
    ...(options.soft ? { soft: options.soft } : {}),
  });

  for (const warning of warnings) {
    warn(warning.message);
  }
  if (plan.caveat) {
    warn(plan.caveat);
  }
  if (plan.kind === 'derived') {
    const route = plan.steps.map((step) => step.task).join(' → ');
    warn(`via ${route} (${plan.steps.length} steps)`);
  }

  const executed = await executePlan(plan, input, options, rendererOptions);

  options.onProgress?.({ phase: 'write', message: 'Writing artifacts' });
  const written = await writeArtifacts(executed.artifacts, {
    ...(options.out ? { out: options.out } : {}),
    baseName: inputBaseName(input),
    baseDir: input.kind === 'file' && input.path ? path.dirname(input.path) : process.cwd(),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });

  return {
    ok: true,
    input: input.display,
    format: plan.target,
    engine: executed.engine,
    route: plan.steps.map((step) => step.task),
    pages: executed.totalPages,
    outputs: written.entries,
    durationMs: Date.now() - startedAt,
    ...(plan.caveat ? { caveat: plan.caveat } : {}),
  };
}

async function executePlan(
  plan: ReturnType<typeof buildPlan>['plan'],
  input: Awaited<ReturnType<typeof resolveInput>>,
  options: RenderOptions,
  rendererOptions: RendererOptions
): Promise<EngineOutput & { engine: string }> {
  // Passthrough: the input is already in the target format, so no backend work
  // and no upload — just hand the local file to the writer.
  if (plan.kind === 'passthrough') {
    if (!input.path) {
      throw DeckRenderError.usage('Passthrough requires a local file input.');
    }
    const artifact: RenderArtifact = {
      page: 1,
      source: input.path,
      ext: DEFAULT_EXTENSION[plan.target],
    };
    return { artifacts: [artifact], totalPages: 1, engine: 'passthrough' };
  }

  // Local routes never touch the network, so they must not be replaced by an
  // injected cloud client — that would send an unsupported format upstream.
  const engine =
    plan.kind === 'local'
      ? new LocalEngine()
      : (rendererOptions.engine ?? (await createCloudEngine(options, rendererOptions)));

  if (!engine.supports(plan)) {
    throw DeckRenderError.render(`The ${engine.name} engine cannot execute this route.`);
  }

  const output = await engine.execute(plan, {
    input,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });

  return { ...output, engine: engine.name };
}

async function createCloudEngine(
  options: RenderOptions,
  rendererOptions: RendererOptions
): Promise<RenderEngine> {
  if (rendererOptions.client) {
    return new CloudEngine({
      client: rendererOptions.client,
      authenticated: true,
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    });
  }

  const credentials = await resolveCredentials(rendererOptions);
  // No credentials is not an error: the backend accepts guest tasks, which the
  // engine starts explicitly. A 401 later is what surfaces as auth_error.
  let authenticated = hasCredentials(credentials);

  const onUnauthorized = rendererOptions.onUnauthorized
    ? async () => {
        const authorization = await rendererOptions.onUnauthorized!();
        authenticated = true;
        return authorization;
      }
    : undefined;

  const client = createDeck({
    root: credentials.apiBase,
    ...(credentials.token ? { token: credentials.token } : {}),
    ...(credentials.apiKey ? { apiKey: credentials.apiKey } : {}),
    ...(credentials.spaceId ? { spaceId: credentials.spaceId } : {}),
    ...(onUnauthorized ? { onUnauthorized } : {}),
    ...(rendererOptions.onPaymentRequired ? { onPaymentRequired: rendererOptions.onPaymentRequired } : {}),
  });

  return new CloudEngine({
    client,
    authenticated,
    isAuthenticated: () => authenticated,
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
  });
}

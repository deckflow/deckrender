import path from 'node:path';
import { createDeck, type DeckClient } from '@deckops/sdk';
import { credentialsRejected, DeckRenderError } from '../errors/index.js';
import { CloudEngine } from '../engines/cloud.js';
import { LocalEngine } from '../engines/local/index.js';
import { validateEngineOutput } from '../engines/validate.js';
import type { EngineOutput, RenderEngine } from '../engines/engine.js';
import { inputBaseName, resolveInput } from '../input/resolve.js';
import { DEFAULT_EXTENSION } from '../output/naming.js';
import { writeArtifacts } from '../output/writer.js';
import {
  describeCredentialOrigin,
  hasCredentials,
  resolveCredentials,
  type CredentialOverrides,
} from '../config/credentials.js';
import type { EnginePreference, RenderArtifact, RenderOptions, RenderResult } from '../types.js';
import { parsePageSelection } from './pages.js';
import { buildPlan } from './plan.js';
import { validateRenderOptions } from './validation.js';
import { concreteEngineFor, resolveEnginePreference } from './engine-selection.js';
import { renderArtifacts, safeCleanup } from './execute.js';

export interface RendererOptions extends CredentialOverrides {
  /** Pre-built DeckOps client. Supplying one skips credential resolution. */
  client?: DeckClient;
  /** Custom engine. Overrides built-in engine construction. */
  engine?: RenderEngine;
  /** Preferred spelling for a custom engine; `engine` remains for compatibility. */
  customEngine?: RenderEngine;
  /** Local Chromium override. */
  executablePath?: string;
  /** Local office2html override. */
  office2htmlPath?: string;
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
export type OneShotRenderOptions = Omit<RenderOptions, 'engine'> &
  Omit<RendererOptions, 'engine'> & {
    /** Built-in engine name, or the legacy custom RenderEngine value. */
    engine?: EnginePreference | RenderEngine;
  };

export function render(options: OneShotRenderOptions): Promise<RenderResult> {
  const { engine, ...shared } = options;
  if (typeof engine === 'object' && engine !== null) {
    return runRender(shared, { ...shared, engine });
  }
  return runRender({ ...shared, ...(engine ? { engine } : {}) } as RenderOptions, shared as RendererOptions);
}

async function runRender(options: RenderOptions, rendererOptions: RendererOptions): Promise<RenderResult> {
  validateRenderOptions(options);
  const configuredCustomEngine = rendererOptions.customEngine ?? rendererOptions.engine;
  if (configuredCustomEngine && options.engine) {
    throw DeckRenderError.usage(
      'A built-in engine name cannot be combined with a caller-supplied custom engine.',
      { hint: 'Remove RenderOptions.engine, or create a renderer without a custom engine.' }
    );
  }
  const startedAt = Date.now();
  const warn = rendererOptions.onWarning ?? (() => undefined);

  options.onProgress?.({ phase: 'resolve', message: `Resolving ${options.input}` });
  const input = await resolveInput(options.input, options.from ? { from: options.from } : {});

  const pages = options.pages ? parsePageSelection(options.pages) : undefined;
  const target = options.format ?? 'image';
  const customEngine = configuredCustomEngine;
  const preference =
    customEngine || rendererOptions.client
      ? (options.engine ?? 'cloud')
      : resolveEnginePreference(options.engine);
  const concrete = concreteEngineFor(preference, input.format, target);
  if (concrete.fellBackToCloud) {
    warn(`falling back to cloud for .${input.format} → ${target}`);
  }

  options.onProgress?.({ phase: 'plan', message: 'Building render plan' });
  const { plan, warnings } = buildPlan({
    engine: concrete.engine,
    source: input.format,
    target,
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

  const executed = await executePlan(plan, input, options, rendererOptions, concrete.engine, warn);

  try {
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
  } finally {
    await safeCleanup(executed.cleanup);
  }
}

async function executePlan(
  plan: ReturnType<typeof buildPlan>['plan'],
  input: Awaited<ReturnType<typeof resolveInput>>,
  options: RenderOptions,
  rendererOptions: RendererOptions,
  plannedEngine: Exclude<EnginePreference, 'auto'>,
  warn: (message: string) => void
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

  const customEngine = rendererOptions.customEngine ?? rendererOptions.engine;
  const selection: EngineSelection = customEngine
    ? { engine: customEngine }
    : plannedEngine === 'local'
      ? {
          engine: new LocalEngine({
            ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
            ...((options.executablePath ?? rendererOptions.executablePath)
              ? { executablePath: options.executablePath ?? rendererOptions.executablePath }
              : {}),
            ...((options.office2htmlPath ?? rendererOptions.office2htmlPath)
              ? { office2htmlPath: options.office2htmlPath ?? rendererOptions.office2htmlPath }
              : {}),
          }),
        }
      : await createCloudEngine(options, rendererOptions);

  const { engine } = selection;
  const context = {
    input,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  };

  try {
    return await renderArtifacts(engine, plan, context, validateEngineOutput);
  } catch (error) {
    const guest = credentialsRejected(error) ? selection.guestFallback?.() : undefined;
    if (!guest) {
      throw error;
    }
    warn(
      `The backend rejected the ${guest.origin}, so it is being ignored and the render retried ` +
        'in guest mode, which is rate-limited. Run `deckrender auth login` for full access, or ' +
        '`deckrender config list` to see where that credential came from.'
    );
    return renderArtifacts(guest.engine, plan, context, validateEngineOutput);
  }
}

interface EngineSelection {
  engine: RenderEngine;
  /**
   * Rebuild the engine with no credentials at all.
   *
   * Present only when credentials were sent in the first place, and fires at
   * most once. Returns the origin of the credential being dropped so the
   * warning can name the file or variable to clean up.
   */
  guestFallback?: () => { engine: RenderEngine; origin: string } | undefined;
}

/**
 * Build the cloud engine, and the guest engine to fall back to.
 *
 * A credential the backend rejects is not a credential: the render continues as
 * a guest rather than failing, because leftover state on a machine — an expired
 * `deckrender auth login`, a token another DeckFlow tool wrote — must not break
 * the promise that rendering works with no setup at all. The warning names what
 * was dropped, so this is never silent.
 *
 * The interactive login therefore hangs off the *guest* client, not the
 * credentialed one: a bad credential is answered with guest mode, and only a
 * backend that refuses guests too is worth interrupting the user for.
 */
async function createCloudEngine(
  options: RenderOptions,
  rendererOptions: RendererOptions
): Promise<EngineSelection> {
  const timeout = options.timeout !== undefined ? { timeout: options.timeout } : {};

  if (rendererOptions.client) {
    // A caller-supplied client owns its own credentials, so there is nothing
    // here to second-guess and nothing to fall back to.
    return {
      engine: new CloudEngine({ client: rendererOptions.client, authenticated: true, ...timeout }),
    };
  }

  const credentials = await resolveCredentials(rendererOptions);

  /**
   * An engine carrying nothing but the API base.
   *
   * The backend treats a credential-free request as a rate-limited guest and
   * parks its tasks until they are started explicitly, which is what
   * `authenticated: false` tells the engine to do. A login part-way through
   * flips that, so the flag is read live rather than captured — starting a task
   * the backend already started fails.
   */
  const guestEngine = (): RenderEngine => {
    let authenticated = false;
    const onUnauthorized = rendererOptions.onUnauthorized
      ? async () => {
          const authorization = await rendererOptions.onUnauthorized!();
          authenticated = true;
          return authorization;
        }
      : undefined;

    return new CloudEngine({
      client: createDeck({
        root: credentials.apiBase,
        ...(onUnauthorized ? { onUnauthorized } : {}),
        ...(rendererOptions.onPaymentRequired
          ? { onPaymentRequired: rendererOptions.onPaymentRequired }
          : {}),
      }),
      authenticated: false,
      isAuthenticated: () => authenticated,
      ...timeout,
    });
  };

  // Nothing to send: this is guest mode from the start, with nothing to drop.
  if (!hasCredentials(credentials)) {
    return { engine: guestEngine() };
  }

  const client = createDeck({
    root: credentials.apiBase,
    ...(credentials.token ? { token: credentials.token } : {}),
    ...(credentials.apiKey ? { apiKey: credentials.apiKey } : {}),
    ...(credentials.spaceId ? { spaceId: credentials.spaceId } : {}),
    ...(rendererOptions.onPaymentRequired ? { onPaymentRequired: rendererOptions.onPaymentRequired } : {}),
  });

  let dropped = false;

  return {
    engine: new CloudEngine({
      client,
      authenticated: true,
      credentialOrigin: () => describeCredentialOrigin(credentials),
      ...timeout,
    }),
    guestFallback: () => {
      if (dropped) {
        return undefined;
      }
      dropped = true;
      // The spaceId belongs to the rejected credential's workspace, so it is
      // left behind with it — sending it as a guest earns a 403.
      return {
        engine: guestEngine(),
        origin: describeCredentialOrigin(credentials) ?? 'stored credential',
      };
    },
  };
}

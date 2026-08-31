import { createDeck } from '@deckops/sdk';
import { buildPlan } from '../core/plan.js';
import { parsePageSelection } from '../core/pages.js';
import { validateRenderOptions } from '../core/validation.js';
import { validateArtifacts } from '../core/artifact-validation.js';
import { renderArtifacts, safeCleanup } from '../core/execute.js';
import { CloudEngine } from '../engines/cloud.js';
import { DeckRenderError } from '../errors/DeckRenderError.js';
import type { RenderArtifact } from '../types.js';
import { assertKeys, httpUrl, resolveBrowserInput } from './input.js';
import type {
  BrowserOneShotRenderOptions,
  BrowserRenderer,
  BrowserRendererOptions,
  BrowserRenderOutput,
  BrowserRenderResult,
} from './types.js';

const RENDERER_KEYS = ['apiBase', 'token', 'getToken', 'spaceId', 'guest', 'onWarning'] as const;
const RENDER_KEYS = [
  'input',
  'from',
  'format',
  'imageFormat',
  'pages',
  'width',
  'scale',
  'quality',
  'embedFonts',
  'timeout',
  'onProgress',
] as const;

// Reusing the page's anonymous identifier must not depend on whether callers
// choose the reusable or one-shot API. This is not a credential or a quota grant.
let browserAuthUuid: string | undefined;

export function createRenderer(options: BrowserRendererOptions = {}): BrowserRenderer {
  validateRendererOptions(options);
  // Capture configuration, not credentials shared by concurrent invocations.
  const config = {
    ...options,
    ...(options.apiBase !== undefined ? { apiBase: httpUrl(options.apiBase, 'apiBase') } : {}),
  };
  return {
    async render(options): Promise<BrowserRenderResult> {
      if (!options || typeof options !== 'object') {
        throw DeckRenderError.usage('Render options must be an object.');
      }
      assertKeys(options, RENDER_KEYS, 'render option');
      validateRenderOptions({ ...options, input: 'browser-input' });
      const startedAt = Date.now();
      const warn = config.onWarning ?? (() => undefined);
      options.onProgress?.({ phase: 'resolve', message: 'Resolving browser input' });
      const input = await resolveBrowserInput(options.input, options.from);
      options.onProgress?.({ phase: 'plan', message: 'Building render plan' });
      const { plan, warnings } = buildPlan({
        engine: 'cloud',
        source: input.format,
        target: options.format ?? 'image',
        imageFormat: options.imageFormat,
        width: options.width,
        scale: options.scale,
        quality: options.quality,
        embedFonts: options.embedFonts,
        pages: options.pages !== undefined ? parsePageSelection(options.pages) : undefined,
      });
      for (const warning of warnings) warn(warning.message);
      if (plan.caveat) warn(plan.caveat);
      if (plan.kind === 'derived')
        warn(`via ${plan.steps.map((step) => step.task).join(' → ')} (${plan.steps.length} steps)`);
      const base = {
        ok: true as const,
        input: input.display,
        format: plan.target,
        route: plan.steps.map((step) => step.task),
        ...(plan.caveat ? { caveat: plan.caveat } : {}),
      };

      if (plan.kind === 'passthrough') {
        // No credentials, upload, or filesystem required for an unchanged PDF.
        const blob = new Blob([new Uint8Array(input.bytes!).buffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        let disposed = false;
        return {
          ...base,
          engine: 'passthrough',
          pages: 1,
          durationMs: Date.now() - startedAt,
          outputs: [
            { page: 1, url, ext: '.pdf', mimeType: blob.type, bytes: blob.size, blob: async () => blob },
          ],
          dispose() {
            if (!disposed) URL.revokeObjectURL(url);
            disposed = true;
          },
        };
      }

      const token = config.getToken ? await config.getToken() : config.token;
      if (!config.guest && (typeof token !== 'string' || !token.trim())) {
        throw DeckRenderError.auth('A user token is required for browser cloud rendering.', {
          hint: 'Supply token/getToken, or explicitly choose guest: true. Never embed an application API key.',
        });
      }
      // A fresh client per render prevents identity/space races during parallel renders.
      // The UUID is memory-only; no SDK credential or storage discovery is used.
      if (!globalThis.crypto?.randomUUID) {
        throw DeckRenderError.usage(
          'Browser cloud rendering requires a secure context (HTTPS or localhost).'
        );
      }
      browserAuthUuid ??= globalThis.crypto.randomUUID();
      const client = createDeck({
        root: config.apiBase,
        token: token?.trim(),
        spaceId: config.spaceId,
        authUuid: browserAuthUuid,
      });
      const executed = await renderArtifacts(
        new CloudEngine({
          client,
          authenticated: !config.guest,
          timeout: options.timeout,
          runtime: 'browser',
        }),
        plan,
        { input, onProgress: options.onProgress },
        (name, value) =>
          validateArtifacts(
            name,
            value,
            isRemoteSource,
            'an HTTP(S) artifact URL without embedded credentials'
          )
      );
      try {
        return {
          ...base,
          engine: 'cloud',
          pages: executed.totalPages,
          outputs: executed.artifacts.map(remoteOutput),
          durationMs: Date.now() - startedAt,
          dispose() {
            /* Remote URLs are not owned by this browser. */
          },
        };
      } finally {
        await safeCleanup(executed.cleanup);
      }
    },
  };
}

export async function render(options: BrowserOneShotRenderOptions): Promise<BrowserRenderResult> {
  if (!options || typeof options !== 'object')
    throw DeckRenderError.usage('Render options must be an object.');
  const { apiBase, token, getToken, spaceId, guest, onWarning, ...request } = options;
  return createRenderer({ apiBase, token, getToken, spaceId, guest, onWarning }).render(request);
}

function validateRendererOptions(options: BrowserRendererOptions): void {
  if (!options || typeof options !== 'object')
    throw DeckRenderError.usage('Renderer options must be an object.');
  assertKeys(options, RENDERER_KEYS, 'renderer option');
  if (options.apiBase !== undefined) {
    const url = new URL(httpUrl(options.apiBase, 'apiBase'));
    if (url.search || url.hash) throw DeckRenderError.usage('apiBase must not contain a query or fragment.');
  }
  for (const key of ['token', 'spaceId'] as const) {
    if (options[key] !== undefined && (typeof options[key] !== 'string' || !options[key]?.trim())) {
      throw DeckRenderError.usage(`${key} must be a non-empty string.`);
    }
  }
  for (const key of ['getToken', 'onWarning'] as const) {
    if (options[key] !== undefined && typeof options[key] !== 'function') {
      throw DeckRenderError.usage(`${key} must be a function.`);
    }
  }
  if (options.guest !== undefined && typeof options.guest !== 'boolean')
    throw DeckRenderError.usage('guest must be a boolean.');
  if (options.token !== undefined && options.getToken !== undefined)
    throw DeckRenderError.usage('Choose token or getToken, not both.');
  if (
    options.guest &&
    (options.token !== undefined || options.getToken !== undefined || options.spaceId !== undefined)
  ) {
    throw DeckRenderError.usage('guest cannot be combined with token, getToken, or spaceId.');
  }
}

function isRemoteSource(source: string): boolean {
  try {
    const url = new URL(source);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function remoteOutput(artifact: RenderArtifact): BrowserRenderOutput {
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
  };
  return {
    page: artifact.page,
    url: artifact.source,
    ext: artifact.ext,
    mimeType: types[artifact.ext] ?? 'application/octet-stream',
    ...(artifact.width !== undefined ? { width: artifact.width } : {}),
    ...(artifact.height !== undefined ? { height: artifact.height } : {}),
    ...(artifact.bytes !== undefined ? { bytes: artifact.bytes } : {}),
    async blob() {
      try {
        const response = await fetch(artifact.source, { credentials: 'omit' });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return await response.blob();
      } catch (error) {
        throw DeckRenderError.conversion(`Failed to download page ${artifact.page}.`, {
          hint: 'Check artifact URL expiry and storage CORS settings.',
          cause: error,
        });
      }
    },
  };
}

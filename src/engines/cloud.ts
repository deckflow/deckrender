import path from 'node:path';
import pLimit from 'p-limit';
import { isRetriableError, type DeckClient, type DeckTask, type DeckTaskType } from '@deckops/sdk';
import { DeckRenderError, mapSdkError } from '../errors/index.js';
import { applyPageSelection } from '../core/pages.js';
import type { ProgressEvent, RenderArtifact, RenderPlan, RenderStep } from '../types.js';
import { extensionOf, isHttpUrl, normalizeTaskResult } from './artifacts.js';
import type { EngineOutput, ExecuteContext, RenderEngine } from './engine.js';

export interface CloudEngineOptions {
  client: DeckClient;
  /**
   * Whether a token or API key was resolved.
   *
   * Guest tasks are created in a pending state and need an explicit
   * `tasks.start()`; authenticated tasks start on their own.
   */
  authenticated: boolean;
  /**
   * Read the current authentication state.
   *
   * The SDK may obtain credentials lazily after a 401, so callers that use
   * interactive login should provide this instead of relying on the initial
   * `authenticated` snapshot.
   */
  isAuthenticated?: () => boolean;
  /** Task wait timeout in seconds. */
  timeout?: number;
  /** Parallel task count for per-frame steps. */
  concurrency?: number;
}

/** What flows between steps. */
type Carrier =
  | { kind: 'file'; path: string }
  | { kind: 'bytes'; bytes: Uint8Array; name: string }
  | { kind: 'text'; text: string; field: 'html' | 'markdown' }
  | { kind: 'artifacts'; items: RenderArtifact[] };

const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_CONCURRENCY = 4;
const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_RETRY_MS = 3000;

export class CloudEngine implements RenderEngine {
  readonly name = 'cloud';

  private readonly client: DeckClient;
  private readonly isAuthenticated: () => boolean;
  private readonly timeout: number;
  private readonly limit: ReturnType<typeof pLimit>;

  constructor(options: CloudEngineOptions) {
    this.client = options.client;
    this.isAuthenticated = options.isAuthenticated ?? (() => options.authenticated);
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_SECONDS;
    this.limit = pLimit(options.concurrency ?? DEFAULT_CONCURRENCY);
  }

  supports(plan: RenderPlan): boolean {
    // Passthrough never reaches an engine; everything else in the matrix maps
    // to DeckOps task types by construction.
    return plan.kind !== 'passthrough';
  }

  async execute(plan: RenderPlan, ctx: ExecuteContext): Promise<EngineOutput> {
    let carrier = initialCarrier(ctx);
    let totalPages = 0;
    let filtered = false;

    for (const step of plan.steps) {
      const produced =
        step.fanout === 'per-frame'
          ? await this.runPerFrame(step, carrier, ctx)
          : [await this.runSingle(step, carrier, ctx)].flat();

      if (!filtered) {
        totalPages = produced.length;
      }

      let next = produced;
      if (plan.pages && !filtered && produced.length > 1) {
        // Filter before any per-frame step downstream, so we never pay to
        // convert frames the user did not ask for.
        next = applyPageSelection(produced, plan.pages);
        filtered = true;
      }

      carrier = { kind: 'artifacts', items: next };
    }

    if (carrier.kind !== 'artifacts') {
      throw DeckRenderError.render('Render produced no artifacts.');
    }

    let artifacts = carrier.items;
    if (plan.pages && !filtered) {
      artifacts = applyPageSelection(artifacts, plan.pages);
    }

    return { artifacts, totalPages: totalPages || artifacts.length };
  }

  private async runSingle(
    step: RenderStep,
    carrier: Carrier,
    ctx: ExecuteContext
  ): Promise<RenderArtifact[]> {
    const task = step.task as DeckTaskType;
    const params = { ...step.params };
    const fileIds: string[] = [];

    // The SDK types expose inline HTML/Markdown parameters, but the production
    // task endpoint currently requires a file id and fails when both forms are
    // sent. Uploading one source file is the compatible cloud-only path.
    const source = await this.materialize(carrier, ctx);
    report(ctx, { phase: 'upload', message: `Uploading ${path.basename(source.name)}`, task });
    const uploaded = await this.upload(source, ctx);
    fileIds.push(uploaded);

    return this.runTask(task, fileIds, params, ctx);
  }

  private async runPerFrame(
    step: RenderStep,
    carrier: Carrier,
    ctx: ExecuteContext
  ): Promise<RenderArtifact[]> {
    if (carrier.kind !== 'artifacts') {
      throw DeckRenderError.render(
        `Step ${step.task} expected rendered frames but the pipeline produced none.`
      );
    }

    const task = step.task as DeckTaskType;
    const frames = carrier.items;

    const converted = await Promise.all(
      frames.map((frame) =>
        this.limit(async () => {
          const bytes = await this.download(frame.source);
          const name = `${String(frame.page).padStart(3, '0')}${frame.ext}`;
          const fileId = await this.upload({ bytes, name }, ctx);
          const result = await this.runTask(task, [fileId], { ...step.params }, ctx);
          const first = result[0];
          if (!first) {
            throw DeckRenderError.render(`Step ${task} returned no output for page ${frame.page}.`);
          }
          return { ...first, page: frame.page };
        })
      )
    );

    return converted.sort((a, b) => a.page - b.page);
  }

  private async runTask(
    type: DeckTaskType,
    fileIds: string[],
    params: Record<string, unknown>,
    ctx: ExecuteContext
  ): Promise<RenderArtifact[]> {
    report(ctx, { phase: 'task', message: `Creating ${type}`, task: type });

    let task: DeckTask;
    try {
      task = await this.client.tasks.create({
        fileIds,
        type,
        params: params as never,
      });

      // Guest mode: the backend parks the task until it is explicitly started.
      if (!this.isAuthenticated()) {
        await this.client.tasks.start(task.id);
      }
    } catch (error) {
      throw mapSdkError(error);
    }

    report(ctx, { phase: 'wait', message: `Running ${type}`, task: type });

    const taskId = task.id;

    try {
      task = await this.client.tasks.wait(taskId, {
        timeout: this.timeout,
        useEventStream: true,
      });
    } catch (error) {
      // `tasks.wait` rejects on a failed task rather than returning it, so the
      // task type and id have to be reattached here. Without this the user gets
      // a bare "Task failed: Unknown error" and nothing to investigate with.
      throw enrichTaskFailure(error, type, taskId);
    }

    // Defensive: the SDK throws today, but a future version returning the
    // failed task should not read as success.
    if (task.status !== 'completed') {
      throw DeckRenderError.render(`Task ${type} ${task.status}: ${task.error ?? 'no error detail'}`, {
        hint: `Inspect the task with: deckops task get ${taskId}`,
      });
    }

    let payload: unknown;
    try {
      payload = await this.client.tasks.down(task.id);
    } catch (error) {
      throw mapSdkError(error, 'conversion_error');
    }

    const artifacts = normalizeTaskResult(payload);
    if (artifacts.length === 0) {
      throw DeckRenderError.conversion(`Task ${type} completed but returned no files.`);
    }

    return artifacts;
  }

  /** Reduce a carrier to bytes the backend can accept as a file. */
  private async materialize(
    carrier: Carrier,
    ctx: ExecuteContext
  ): Promise<{ path: string; name: string } | { bytes: Uint8Array; name: string }> {
    if (carrier.kind === 'file') {
      return { path: carrier.path, name: path.basename(carrier.path) };
    }

    if (carrier.kind === 'bytes') {
      return { bytes: carrier.bytes, name: carrier.name };
    }

    if (carrier.kind === 'text') {
      const name = carrier.field === 'markdown' ? 'input.md' : 'input.html';
      return { bytes: new TextEncoder().encode(carrier.text), name };
    }

    const first = carrier.items[0];
    if (!first) {
      throw DeckRenderError.render('Pipeline step produced no artifact to feed the next step.');
    }

    // Chained steps have to round-trip through storage: DeckOps has no way to
    // use one task's output as another task's input by id.
    report(ctx, { phase: 'download', message: 'Fetching intermediate artifact' });
    const bytes = await this.download(first.source);
    return { bytes, name: `intermediate${first.ext}` };
  }

  private async upload(
    source: { path: string; name: string } | { bytes: Uint8Array; name: string },
    ctx: ExecuteContext
  ): Promise<string> {
    report(ctx, { phase: 'upload', message: `Uploading ${source.name}` });
    try {
      const result =
        'path' in source
          ? await this.client.files.upload(source.path)
          : await this.client.files.upload(source.bytes, { name: source.name });
      return result.id;
    } catch (error) {
      throw mapSdkError(error, 'conversion_error');
    }
  }

  private async download(source: string): Promise<Uint8Array> {
    if (!isHttpUrl(source)) {
      throw DeckRenderError.conversion(`Cannot download artifact from a non-HTTP source: ${source}`);
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(source);
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        lastError = error;
        // Only transient failures are worth retrying; a 403 will stay a 403.
        if (attempt < DOWNLOAD_ATTEMPTS && isRetriableError(error)) {
          await delay(DOWNLOAD_RETRY_MS);
          continue;
        }
        break;
      }
    }

    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw DeckRenderError.conversion(`Failed to download artifact: ${detail}`, { cause: lastError });
  }
}

function initialCarrier(ctx: ExecuteContext): Carrier {
  const { input } = ctx;
  if (input.text !== undefined) {
    return { kind: 'text', text: input.text, field: input.format === 'md' ? 'markdown' : 'html' };
  }
  if (input.bytes) {
    return { kind: 'bytes', bytes: input.bytes, name: input.name ?? `input.${input.format}` };
  }
  if (input.path) {
    return { kind: 'file', path: input.path };
  }
  throw DeckRenderError.usage('Input has neither a file path nor inline content.');
}

/**
 * Attach the task type and id to a wait failure.
 *
 * Auth and payment failures keep their own classification; only the generic
 * "the conversion did not succeed" case gets rewritten, because that is the one
 * the backend reports without any detail.
 */
function enrichTaskFailure(error: unknown, type: DeckTaskType, taskId: string): DeckRenderError {
  const mapped = mapSdkError(error);
  if (mapped.code !== 'render_error') {
    return mapped;
  }

  const detail = mapped.message.replace(/^Task failed:\s*/i, '');
  return DeckRenderError.render(`Task ${type} failed: ${detail}`, {
    hint: `Inspect the task with: deckops task get ${taskId}`,
    ...(mapped.requestId ? { requestId: mapped.requestId } : {}),
    cause: error,
  });
}

function report(ctx: ExecuteContext, event: ProgressEvent): void {
  ctx.onProgress?.(event);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { extensionOf };

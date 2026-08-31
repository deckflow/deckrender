import type { EngineOutput, ExecuteContext, RenderEngine } from '../engines/engine.js';
import type { RenderPlan } from '../types.js';
import { DeckRenderError } from '../errors/DeckRenderError.js';

/** Execute without persisting artifacts. The caller owns successful output cleanup. */
export async function renderArtifacts(
  engine: RenderEngine,
  plan: RenderPlan,
  context: ExecuteContext,
  validate: (engineName: string, output: unknown) => EngineOutput
): Promise<EngineOutput & { engine: string }> {
  if (!engine.supports(plan)) {
    throw DeckRenderError.render(`The ${engine.name} engine cannot execute this route.`);
  }
  const rawOutput: unknown = await engine.execute(plan, context);
  try {
    return { ...validate(engine.name, rawOutput), engine: engine.name };
  } catch (error) {
    const cleanup =
      rawOutput && typeof rawOutput === 'object' ? (rawOutput as { cleanup?: unknown }).cleanup : undefined;
    if (typeof cleanup === 'function') {
      await safeCleanup(cleanup as () => Promise<void> | void);
    }
    throw error;
  }
}

export async function safeCleanup(cleanup?: () => Promise<void> | void): Promise<void> {
  try {
    await cleanup?.();
  } catch {
    // Never hide a successful render or its original failure with a cleanup error.
  }
}

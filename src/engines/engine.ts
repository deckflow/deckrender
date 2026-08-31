import type { ProgressEvent, RenderArtifact, RenderInput, RenderPlan } from '../types.js';

export interface ExecuteContext {
  input: RenderInput;
  onProgress?: (event: ProgressEvent) => void;
}

export interface EngineOutput {
  /** Artifacts after page selection, in page order. */
  artifacts: RenderArtifact[];
  /** Pages the document rendered to, before `--pages` filtering. */
  totalPages: number;
  /** Release temporary engine resources after the artifact writer has consumed them. */
  cleanup?: () => Promise<void> | void;
}

/**
 * A render backend.
 *
 * DeckRender ships cloud and local implementations. The plan, parameter
 * mapping, artifact naming and output envelope stay engine-agnostic, and a
 * caller may still substitute a custom backend.
 */
export interface RenderEngine {
  readonly name: string;
  /** Whether this engine can execute the plan as written. */
  supports(plan: RenderPlan): boolean;
  execute(plan: RenderPlan, ctx: ExecuteContext): Promise<EngineOutput>;
}

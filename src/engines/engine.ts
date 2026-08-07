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
}

/**
 * A render backend.
 *
 * The plan, parameter mapping, artifact naming and output envelope are all
 * engine-agnostic, so adding the local engine in v0.2 means implementing this
 * interface and nothing else.
 */
export interface RenderEngine {
  readonly name: string;
  /** Whether this engine can execute the plan as written. */
  supports(plan: RenderPlan): boolean;
  execute(plan: RenderPlan, ctx: ExecuteContext): Promise<EngineOutput>;
}

import type { DeckTaskType } from '@deckops/sdk';

/** Output artifact families DeckRender can produce. */
export const TARGET_FORMATS = ['image', 'pdf', 'video'] as const;
export type TargetFormat = (typeof TARGET_FORMATS)[number];

/** Image encodings. `webp` is always produced by a trailing conversion step. */
export const IMAGE_FORMATS = ['png', 'jpg', 'webp'] as const;
export type ImageFormat = (typeof IMAGE_FORMATS)[number];

/**
 * Input families DeckRender knows how to route.
 *
 * A URL is not a family of its own: it is fetched locally and classified as
 * `html` (or whatever `--from` says), so one row of the render matrix serves
 * both local files and hosted pages.
 */
export const SOURCE_FORMATS = [
  'pptx',
  'ppt',
  'pdf',
  'key',
  'docx',
  'doc',
  'xlsx',
  'pages',
  'numbers',
  'html',
  'md',
] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];

export const QUALITIES = ['low', 'medium', 'high'] as const;
export type Quality = (typeof QUALITIES)[number];

export const PROFILE_NAMES = ['web', 'presentation', 'print', 'thumbnail'] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];

/**
 * A step in a RenderPlan.
 *
 * Every step but `passthrough` is a DeckOps task: rendering happens in the
 * cloud. `passthrough` copies the input unchanged, which is not a render.
 */
export type RenderStepTask = DeckTaskType | 'passthrough';

export interface RenderStep {
  task: RenderStepTask;
  /**
   * `single` runs one backend task for the whole carrier.
   * `per-frame` runs one backend task per artifact produced so far.
   */
  fanout: 'single' | 'per-frame';
  /** Task parameters, already mapped from normalized options. */
  params: Record<string, unknown>;
}

export type RouteKind = 'direct' | 'derived' | 'passthrough';

/**
 * The render pipeline IR.
 *
 * This is deliberately a plan for *rendering*, not a model of the document:
 * DeckRender never parses content.
 */
export interface RenderPlan {
  source: SourceFormat;
  target: TargetFormat;
  imageFormat: ImageFormat;
  kind: RouteKind;
  steps: RenderStep[];
  /** Selected 1-based page numbers, or undefined for "all pages". */
  pages?: number[];
  /** Known fidelity trade-off for this route, surfaced to the user. */
  caveat?: string;
}

export interface RenderArtifact {
  /** 1-based page number as rendered by the backend. */
  page: number;
  /** http(s) URL, or an absolute local path for passthrough routes. */
  source: string;
  /** Lowercased extension including the dot, e.g. `.png`. */
  ext: string;
  bytes?: number;
  width?: number;
  height?: number;
}

export interface RenderInput {
  kind: 'file' | 'url' | 'stdin';
  format: SourceFormat;
  /** Absolute local path, when the source is a file the engine can upload. */
  path?: string;
  /** In-memory bytes for stdin and downloaded URLs — no temp file needed. */
  bytes?: Uint8Array;
  /** Upload filename for `bytes`. */
  name?: string;
  /**
   * Text payload. HTML and Markdown stay in memory until the cloud engine
   * uploads them as source files; no temporary local file is needed.
   */
  text?: string;
  /** Value shown in the result envelope: path, URL, or `-` for stdin. */
  display: string;
}

export interface RenderOptions {
  /** File path, URL, or `-` for stdin. */
  input: string;
  /** Explicit source format. Required for stdin. */
  from?: SourceFormat;
  format?: TargetFormat;
  imageFormat?: ImageFormat;
  out?: string;
  /** Page selection, e.g. `1-5`, `3`, `1,3,5-7`. */
  pages?: string;
  /** Target long edge in pixels. */
  width?: number;
  /** Multiplier applied to the format's base long edge. */
  scale?: number;
  quality?: Quality;
  profile?: ProfileName;
  /** Embed fonts when the route passes through html2pptx. */
  embedFonts?: boolean;
  /** Task wait timeout in seconds. */
  timeout?: number;
  /**
   * Options that came from a profile or config file rather than being chosen
   * explicitly. A route that cannot honour these drops them with a warning
   * instead of failing. See `SoftOption` in core/plan.ts.
   */
  soft?: ReadonlySet<'imageFormat' | 'width' | 'scale' | 'quality' | 'pages' | 'embedFonts'>;
  onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  phase: 'resolve' | 'plan' | 'upload' | 'task' | 'wait' | 'download' | 'write';
  message: string;
  /** Present for `task`/`wait` phases. */
  task?: RenderStepTask;
  /** 0..1 when the phase reports granular progress. */
  ratio?: number;
}

export interface RenderOutputEntry {
  page: number;
  file: string;
  width?: number;
  height?: number;
  bytes?: number;
}

export interface RenderResult {
  ok: true;
  input: string;
  format: TargetFormat;
  engine: string;
  /** Observable projection of the RenderPlan: every backend task, in order. */
  route: RenderStepTask[];
  /** Total pages the document rendered to, before `--pages` filtering. */
  pages: number;
  outputs: RenderOutputEntry[];
  durationMs: number;
  /** Present when the route has a known fidelity trade-off. */
  caveat?: string;
}

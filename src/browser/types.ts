import type { ImageFormat, Quality, SourceFormat, TargetFormat } from '../types.js';

/** Strings deliberately cannot mean a local path or an implicitly fetched URL. */
export type BrowserInput =
  | File
  | { data: Blob | Uint8Array | ArrayBuffer; name: string }
  | { html: string; baseUrl?: string }
  | { markdown: string };

export interface BrowserProgressEvent {
  phase: 'resolve' | 'plan' | 'upload' | 'task' | 'wait' | 'download' | 'write';
  message: string;
  task?: string;
  /** Phase-local progress, when known; not an estimated overall percentage. */
  ratio?: number;
}

export interface BrowserRendererOptions {
  /** DeckOps API root. Defaults to https://app.deckflow.com/v1. */
  apiBase?: string;
  /** User token, never an application API key. Kept in memory only. */
  token?: string;
  /** Called before each render; lets the application own token refresh. */
  getToken?: () => string | undefined | Promise<string | undefined>;
  spaceId?: string;
  /** Explicitly opt into guest uploads. Cannot be combined with token/getToken/spaceId. */
  guest?: boolean;
  onWarning?: (message: string) => void;
}

export interface BrowserRenderOptions {
  input: BrowserInput;
  from?: SourceFormat;
  format?: TargetFormat;
  imageFormat?: ImageFormat;
  pages?: string;
  width?: number;
  scale?: number;
  quality?: Quality;
  embedFonts?: boolean;
  /** Wait timeout per cloud task, in seconds. Defaults to 300. */
  timeout?: number;
  onProgress?: (event: BrowserProgressEvent) => void;
}

export interface BrowserRenderOutput {
  page: number;
  /** Remote artifact URL, or an owned blob URL for PDF passthrough. May be temporary. */
  url: string;
  ext: string;
  mimeType: string;
  width?: number;
  height?: number;
  bytes?: number;
  /** Fetch only this output. API credentials are never forwarded to artifact hosts. */
  blob(): Promise<Blob>;
}

export interface BrowserRenderResult {
  ok: true;
  input: string;
  format: TargetFormat;
  engine: 'cloud' | 'passthrough';
  route: string[];
  /** Total rendered pages before selection. Passthrough is one unchanged document. */
  pages: number;
  outputs: BrowserRenderOutput[];
  durationMs: number;
  caveat?: string;
  /** Idempotently revoke owned blob URLs. Does not delete remote artifacts or cancel tasks. */
  dispose(): void;
}

export interface BrowserRenderer {
  render(options: BrowserRenderOptions): Promise<BrowserRenderResult>;
}

export type BrowserOneShotRenderOptions = BrowserRendererOptions & BrowserRenderOptions;

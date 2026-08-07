import type { DeckTaskType } from '@deckops/sdk';
import type { RouteKind, SourceFormat, TargetFormat } from '../types.js';

/**
 * The render matrix.
 *
 * Every entry here is backed by a task type that actually exists in
 * @deckops/sdk — see contracts/render-matrix.md for the line-by-line citations.
 * Absence from this table is the single source of truth for
 * `unsupported_format`.
 */
export interface BaseRoute {
  kind: RouteKind;
  /** Ordered backend tasks. Empty for passthrough and local routes. */
  tasks: DeckTaskType[];
  /** Known fidelity trade-off, surfaced to the user on stderr and in --json. */
  caveat?: string;
}

const HTML_TO_PDF_CAVEAT =
  'HTML is rebuilt as PPTX before PDF export, so layout is constrained by the slide model. ' +
  'A native HTML renderer lands with the local engine (roadmap v0.2).';

const HTML_TO_VIDEO_CAVEAT =
  'HTML is rebuilt as PPTX before the video is produced, so the result is a slideshow of the ' +
  'reconstructed page rather than a capture of the live document.';

const IWORK_PREVIEW_CAVEAT =
  'DeckOps has no renderer for this format, so DeckRender extracted the preview embedded in the ' +
  'document. That is the first page only, at whatever resolution iWork saved it.';

/**
 * Combinations that are planned but not built.
 *
 * Kept in the table rather than left to fall through to `unsupported_format`
 * so the message can say "not yet" instead of "never", and name what is
 * blocking it. See docs/roadmap.md.
 */
export const NOT_IMPLEMENTED: Readonly<Partial<Record<SourceFormat, Partial<Record<TargetFormat, string>>>>> =
  {
    xlsx: {
      image:
        'Spreadsheet rendering needs a layout engine DeckRender does not ship yet, and DeckOps has no converter for it.',
      pdf: 'Spreadsheet rendering needs a layout engine DeckRender does not ship yet, and DeckOps has no converter for it.',
    },
    pdf: { video: 'PDF to video needs local frame assembly (ffmpeg), which is not bundled yet.' },
    key: { video: 'Keynote to video needs local frame assembly (ffmpeg), which is not bundled yet.' },
  };

export function plannedReason(source: SourceFormat, target: TargetFormat): string | undefined {
  return NOT_IMPLEMENTED[source]?.[target];
}

export const ROUTES: Readonly<Record<SourceFormat, Partial<Record<TargetFormat, BaseRoute>>>> = {
  pptx: {
    image: { kind: 'direct', tasks: ['convertor.ppt2image'] },
    pdf: { kind: 'direct', tasks: ['convertor.ppt2pdf'] },
    video: { kind: 'direct', tasks: ['convertor.ppt2video'] },
  },
  ppt: {
    image: { kind: 'direct', tasks: ['convertor.ppt2image'] },
    pdf: { kind: 'direct', tasks: ['convertor.ppt2pdf'] },
    video: { kind: 'direct', tasks: ['convertor.ppt2video'] },
  },
  pdf: {
    image: { kind: 'direct', tasks: ['convertor.pdf2image'] },
    pdf: { kind: 'passthrough', tasks: [] },
  },
  key: {
    image: { kind: 'direct', tasks: ['convertor.keynote2image'] },
    pdf: { kind: 'direct', tasks: ['convertor.keynote2pdf'] },
  },
  docx: {
    image: { kind: 'derived', tasks: ['convertor.doc2pdf', 'convertor.pdf2image'] },
    pdf: { kind: 'direct', tasks: ['convertor.doc2pdf'] },
  },
  doc: {
    image: { kind: 'derived', tasks: ['convertor.doc2pdf', 'convertor.pdf2image'] },
    pdf: { kind: 'direct', tasks: ['convertor.doc2pdf'] },
  },
  html: {
    image: { kind: 'direct', tasks: ['convertor.html2png'] },
    pdf: {
      kind: 'derived',
      tasks: ['convertor.html2pptx', 'convertor.ppt2pdf'],
      caveat: HTML_TO_PDF_CAVEAT,
    },
    video: {
      kind: 'derived',
      tasks: ['convertor.html2pptx', 'convertor.ppt2video'],
      caveat: HTML_TO_VIDEO_CAVEAT,
    },
  },
  md: {
    image: { kind: 'direct', tasks: ['convertor.markdown2png'] },
  },
  // iWork word processing and spreadsheet documents have no DeckOps converter.
  // The embedded preview is the only thing available without shipping a
  // renderer for the format, so these run entirely on this machine.
  pages: {
    image: { kind: 'local', tasks: [], caveat: IWORK_PREVIEW_CAVEAT },
    pdf: { kind: 'local', tasks: [], caveat: IWORK_PREVIEW_CAVEAT },
  },
  numbers: {
    image: { kind: 'local', tasks: [], caveat: IWORK_PREVIEW_CAVEAT },
    pdf: { kind: 'local', tasks: [], caveat: IWORK_PREVIEW_CAVEAT },
  },
  xlsx: {},
};

/**
 * Extensions we recognize as documents but cannot render.
 *
 * Listed separately from ROUTES so the error can say "DeckOps has no converter
 * for this format" instead of the vaguer "unknown extension".
 */
export const KNOWN_UNRENDERABLE_EXTENSIONS = ['.xls', '.txt', '.rtf', '.odt', '.ods', '.odp'] as const;

export function findRoute(source: SourceFormat, target: TargetFormat): BaseRoute | undefined {
  return ROUTES[source]?.[target];
}

export function supportedTargets(source: SourceFormat): TargetFormat[] {
  return Object.keys(ROUTES[source] ?? {}) as TargetFormat[];
}

/** How `--width` / `--scale` can land on a given task. */
export type ResolutionSupport =
  | { kind: 'none' }
  /** Fixed set of allowed values; anything else is snapped to the nearest. */
  | { kind: 'tiered'; tiers: number[]; base: number }
  /** Arbitrary pixel value for the long edge. */
  | { kind: 'free'; base: number }
  /** Multiplier plus an optional explicit viewport/page width. */
  | { kind: 'scale'; widthParam: 'width' | 'pageWidth' };

export interface TaskCapability {
  resolution: ResolutionSupport;
  /** Whether the task lets the caller choose png vs jpg. */
  imageFormat: boolean;
  /** Whether the task emits one artifact per document page. */
  multiFrame: boolean;
}

const NO_CAPABILITY: TaskCapability = {
  resolution: { kind: 'none' },
  imageFormat: false,
  multiFrame: false,
};

/**
 * Per-task capabilities, read off the @deckops/sdk parameter types.
 *
 * `{ kind: 'none' }` means the backend accepts no such parameter at all — the
 * corresponding CLI flag must raise `unsupported_option` rather than be
 * silently dropped.
 */
export const TASK_CAPABILITIES: Readonly<Partial<Record<DeckTaskType, TaskCapability>>> = {
  // ConvertPptToImageParams.resolution?: 1080 | 1920 | 2560
  'convertor.ppt2image': {
    resolution: { kind: 'tiered', tiers: [1080, 1920, 2560], base: 1920 },
    imageFormat: true,
    multiFrame: true,
  },
  // ConvertPdfToImageParams.resolution?: number
  'convertor.pdf2image': {
    resolution: { kind: 'free', base: 1080 },
    imageFormat: true,
    multiFrame: true,
  },
  // ConvertKeynoteToImageParams = Record<never, never>
  'convertor.keynote2image': { ...NO_CAPABILITY, multiFrame: true },
  // ConvertHtmlToPngParams: scale, fullPage, width, height
  'convertor.html2png': {
    resolution: { kind: 'scale', widthParam: 'width' },
    imageFormat: false,
    multiFrame: false,
  },
  // ConvertMarkdownToPngParams: scale, theme, pageWidth
  'convertor.markdown2png': {
    resolution: { kind: 'scale', widthParam: 'pageWidth' },
    imageFormat: false,
    multiFrame: false,
  },
  'convertor.ppt2pdf': NO_CAPABILITY,
  'convertor.doc2pdf': NO_CAPABILITY,
  'convertor.keynote2pdf': NO_CAPABILITY,
  'convertor.ppt2video': NO_CAPABILITY,
  'convertor.html2pptx': NO_CAPABILITY,
  'image.convertWebp': NO_CAPABILITY,
};

export function capabilityFor(task: DeckTaskType): TaskCapability {
  return TASK_CAPABILITIES[task] ?? NO_CAPABILITY;
}

const IMAGE_PRODUCING_TASKS: DeckTaskType[] = [
  'convertor.ppt2image',
  'convertor.pdf2image',
  'convertor.keynote2image',
  'convertor.html2png',
  'convertor.markdown2png',
];

/**
 * The task whose parameters govern image output for this route.
 *
 * For chained routes this is the *last* image producer, which is why
 * `docx → image` gains `--width` support that `docx → pdf` cannot have:
 * the resolution knob belongs to `convertor.pdf2image` at the end of the chain.
 */
export function imageProducingTask(tasks: DeckTaskType[]): DeckTaskType | undefined {
  for (let i = tasks.length - 1; i >= 0; i -= 1) {
    const task = tasks[i];
    if (task && IMAGE_PRODUCING_TASKS.includes(task)) {
      return task;
    }
  }
  return undefined;
}

/** Snap to the nearest allowed tier. Ties round up to the higher tier. */
export function snapToTier(value: number, tiers: number[]): number {
  let best = tiers[0] ?? value;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const tier of tiers) {
    const distance = Math.abs(tier - value);
    if (distance < bestDistance || (distance === bestDistance && tier > best)) {
      best = tier;
      bestDistance = distance;
    }
  }

  return best;
}

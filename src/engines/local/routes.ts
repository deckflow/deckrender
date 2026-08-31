import type { LocalTaskType, RouteKind, SourceFormat, TargetFormat } from '../../types.js';

export interface LocalRoute {
  kind: RouteKind;
  tasks: LocalTaskType[];
  caveat?: string;
}

const LOCAL_PPTX_IMAGE_CAVEAT =
  'Local PPTX rendering uses office2html plus Chromium with external CDN assets blocked; missing system fonts or icons can differ from the DeckFlow cloud.';

const LOCAL_PPTX_PDF_CAVEAT =
  'Local PDF output is printed by Chromium from office2html output with external CDN assets blocked; font metrics, icons, and complex effects may differ from the DeckFlow cloud Office pipeline.';

const LOCAL_PDF_IMAGE_CAVEAT =
  'Local PDF images are rasterized by PDF.js; complex transparency and blend modes can differ slightly from Acrobat or the DeckFlow cloud.';

/**
 * Community engine capability table.
 *
 * It deliberately stays separate from the DeckOps table: selecting `local`
 * is a privacy boundary, so absence here must never become an implicit cloud
 * fallback.
 */
export const LOCAL_ROUTES: Readonly<Record<SourceFormat, Partial<Record<TargetFormat, LocalRoute>>>> = {
  pptx: {
    image: {
      kind: 'direct',
      tasks: ['local.office2html', 'local.capture'],
      caveat: LOCAL_PPTX_IMAGE_CAVEAT,
    },
    pdf: {
      kind: 'derived',
      tasks: ['local.office2html', 'local.capture-pdf', 'local.pdf-merge'],
      caveat: LOCAL_PPTX_PDF_CAVEAT,
    },
  },
  pdf: {
    image: {
      kind: 'direct',
      tasks: ['local.pdfjs'],
      caveat: LOCAL_PDF_IMAGE_CAVEAT,
    },
    pdf: { kind: 'passthrough', tasks: [] },
  },
  html: {
    image: { kind: 'direct', tasks: ['local.capture'] },
  },
  ppt: {},
  key: {},
  docx: {},
  doc: {},
  xlsx: {},
  pages: {},
  numbers: {},
  md: {},
};

/** Local combinations expected to become available as converters are added. */
export const LOCAL_NOT_IMPLEMENTED: Readonly<
  Partial<Record<SourceFormat, Partial<Record<TargetFormat, string>>>>
> = {
  ppt: localOfficePending('.ppt'),
  key: localOfficePending('.key'),
  docx: localOfficePending('.docx'),
  doc: localOfficePending('.doc'),
  xlsx: localOfficePending('.xlsx'),
  pages: localOfficePending('.pages'),
  numbers: localOfficePending('.numbers'),
  md: localOfficePending('.md'),
  html: {
    pdf: 'The local HTML-to-PDF route has not shipped yet.',
  },
};

function localOfficePending(format: string): Partial<Record<TargetFormat, string>> {
  const reason = `office2html does not support ${format} input yet.`;
  return { image: reason, pdf: reason };
}

export function findLocalRoute(source: SourceFormat, target: TargetFormat): LocalRoute | undefined {
  return LOCAL_ROUTES[source]?.[target];
}

export function localPlannedReason(source: SourceFormat, target: TargetFormat): string | undefined {
  return LOCAL_NOT_IMPLEMENTED[source]?.[target];
}

export function localSupportedTargets(source: SourceFormat): TargetFormat[] {
  return Object.keys(LOCAL_ROUTES[source] ?? {}) as TargetFormat[];
}

export { LOCAL_PDF_IMAGE_CAVEAT, LOCAL_PPTX_IMAGE_CAVEAT, LOCAL_PPTX_PDF_CAVEAT };

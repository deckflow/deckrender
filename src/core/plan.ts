import type { DeckTaskType } from '@deckops/sdk';
import { DeckRenderError } from '../errors/index.js';
import type {
  ImageFormat,
  Quality,
  RenderPlan,
  RenderStep,
  RouteKind,
  SourceFormat,
  TargetFormat,
} from '../types.js';
import {
  capabilityFor,
  findRoute,
  imageProducingTask,
  plannedReason,
  snapToTier,
  supportedTargets,
  type ResolutionSupport,
} from './routes.js';

export interface PlanInput {
  source: SourceFormat;
  target: TargetFormat;
  imageFormat?: ImageFormat;
  width?: number;
  scale?: number;
  quality?: Quality;
  pages?: number[];
  embedFonts?: boolean;
  /**
   * Option names that came from a profile or config file rather than from the
   * command line.
   *
   * An option the user typed must never be silently dropped — that is the
   * whole reason `unsupported_option` exists. But a default inherited from
   * `--profile thumbnail` should not make an otherwise valid render fail, so
   * soft options are dropped with a warning instead of throwing.
   */
  soft?: ReadonlySet<SoftOption>;
}

export type SoftOption = 'imageFormat' | 'width' | 'scale' | 'quality' | 'pages' | 'embedFonts';

export interface PlanWarning {
  message: string;
}

export interface PlanResult {
  plan: RenderPlan;
  warnings: PlanWarning[];
}

/**
 * Quality presets.
 *
 * `--quality` is an alias for a (long edge, encoding) pair on image routes —
 * the DeckOps PDF tasks accept no quality parameters at all, so it raises
 * `unsupported_option` there. See contracts/render-matrix.md.
 */
const QUALITY_PRESETS: Record<Quality, { tiered: number; free: number; imageFormat: ImageFormat }> = {
  low: { tiered: 1080, free: 1080, imageFormat: 'jpg' },
  medium: { tiered: 1920, free: 1600, imageFormat: 'png' },
  high: { tiered: 2560, free: 2560, imageFormat: 'png' },
};

export function buildPlan(input: PlanInput): PlanResult {
  const warnings: PlanWarning[] = [];
  const route = findRoute(input.source, input.target);

  if (!route) {
    throw unsupportedFormat(input.source, input.target);
  }

  const effective = validateOptions(input, route.tasks, warnings);

  const tasks = [...route.tasks];
  // A local route produces a JPEG, so webp would need a converter we do not
  // have offline. Everything else can pick up the trailing conversion step.
  const wantsWebp =
    effective.target === 'image' && effective.imageFormat === 'webp' && route.kind !== 'local';
  if (wantsWebp) {
    tasks.push('image.convertWebp');
  }

  const imageTask = imageProducingTask(tasks);

  const steps: RenderStep[] = fixedSteps(route.kind) ?? [
    ...tasks.map((task): RenderStep => ({
      task,
      fanout: task === 'image.convertWebp' ? 'per-frame' : 'single',
      params: mapParams(task, effective, warnings),
    })),
  ];

  const kind =
    route.kind === 'passthrough' || route.kind === 'local' ? route.kind : wantsWebp ? 'derived' : route.kind;

  return {
    plan: {
      source: effective.source,
      target: effective.target,
      imageFormat: resolveImageFormat(effective, imageTask),
      kind,
      steps,
      ...(effective.pages ? { pages: effective.pages } : {}),
      ...(route.caveat ? { caveat: route.caveat } : {}),
    },
    warnings,
  };
}

/** Routes whose steps are fixed and take no parameters. */
function fixedSteps(kind: RouteKind): RenderStep[] | undefined {
  if (kind === 'passthrough') {
    return [{ task: 'passthrough', fanout: 'single', params: {} }];
  }
  if (kind === 'local') {
    return [{ task: 'local:iwork-preview', fanout: 'single', params: {} }];
  }
  return undefined;
}

function unsupportedFormat(source: SourceFormat, target: TargetFormat): DeckRenderError {
  // "Planned but not built" reads very differently from "impossible", and the
  // user needs to know which one they hit before deciding on a workaround.
  const planned = plannedReason(source, target);
  if (planned) {
    return DeckRenderError.notImplemented(
      `Rendering .${source} to ${target} is coming soon — not supported yet.`,
      { hint: `${planned} Track it in docs/roadmap.md.` }
    );
  }

  const supported = supportedTargets(source);
  const message =
    supported.length > 0
      ? `Cannot render .${source} to ${target}. Supported outputs for .${source}: ${supported.join(', ')}.`
      : `Cannot render .${source}. Neither DeckOps nor the local engine handles this format.`;

  return DeckRenderError.unsupportedFormat(message, {
    hint: 'Run `deckrender formats` or see contracts/render-matrix.md for the full support matrix.',
  });
}

/**
 * Reject options the route cannot honour, and drop soft defaults that it cannot.
 *
 * Returns the effective input: identical to the caller's, minus any soft option
 * that had to be dropped.
 */
function validateOptions(input: PlanInput, routeTasks: DeckTaskType[], warnings: PlanWarning[]): PlanInput {
  const effective: PlanInput = { ...input };
  const soft = input.soft ?? new Set<SoftOption>();

  const reject = (option: SoftOption, flag: string, message: string, hint?: string): void => {
    if (soft.has(option)) {
      warnings.push({ message: `Ignoring ${flag} from profile/config: ${message}` });
      delete effective[option];
      return;
    }
    throw DeckRenderError.unsupportedOption(message, hint ? { hint } : {});
  };

  if (effective.target !== 'image') {
    const target = effective.target;
    if (effective.width !== undefined) {
      reject('width', '--width', `--width only applies to image output, not ${target}.`);
    }
    if (effective.scale !== undefined) {
      reject('scale', '--scale', `--scale only applies to image output, not ${target}.`);
    }
    if (effective.imageFormat) {
      reject('imageFormat', '--image-format', `--image-format only applies to image output, not ${target}.`);
    }
    if (effective.quality) {
      reject(
        'quality',
        '--quality',
        `--quality is not supported for ${target} output.`,
        'The DeckOps PDF and video tasks accept no quality parameters.'
      );
    }
    if (effective.pages) {
      reject(
        'pages',
        '--pages',
        `--pages is not supported for ${target} output, which is a single file.`,
        'Page selection applies to multi-frame image output.'
      );
    }
  }

  // The knobs belong to whichever task actually produces the image. For chained
  // routes that is the last one, which is why `docx -> image` supports --width
  // (via convertor.pdf2image) while `docx -> pdf` cannot.
  const imageTask = imageProducingTask(routeTasks);

  if (imageTask) {
    const capability = capabilityFor(imageTask);

    if (capability.resolution.kind === 'none') {
      const workaround =
        `The backend task ${imageTask} accepts no resolution parameters. ` +
        'Workaround: render to PDF first, then run deckrender on the PDF.';
      if (effective.width !== undefined) {
        reject('width', '--width', `--width is not supported for .${input.source} input.`, workaround);
      }
      if (effective.scale !== undefined) {
        reject('scale', '--scale', `--scale is not supported for .${input.source} input.`, workaround);
      }
      if (effective.quality) {
        reject(
          'quality',
          '--quality',
          `--quality is not supported for .${input.source} input.`,
          `The backend task ${imageTask} accepts no resolution or encoding parameters.`
        );
      }
    }

    if (effective.imageFormat === 'jpg' && !capability.imageFormat) {
      reject(
        'imageFormat',
        '--image-format',
        `--image-format jpg is not supported for .${input.source} input.`,
        `The backend task ${imageTask} always emits PNG. Use png or webp.`
      );
    }

    if (effective.pages && !capability.multiFrame) {
      reject(
        'pages',
        '--pages',
        `--pages is not supported for .${input.source} input, which renders to a single image.`,
        `The backend task ${imageTask} produces one full-page image.`
      );
    }
  }

  if (effective.embedFonts && !routeTasks.includes('convertor.html2pptx')) {
    reject(
      'embedFonts',
      '--embed-fonts',
      '--embed-fonts only applies to routes that pass through HTML to PPTX conversion.',
      `The route for .${input.source} to ${input.target} does not include convertor.html2pptx.`
    );
  }

  return effective;
}

function resolveImageFormat(input: PlanInput, imageTask: DeckTaskType | undefined): ImageFormat {
  if (input.imageFormat) {
    return input.imageFormat;
  }
  if (input.quality && imageTask && capabilityFor(imageTask).imageFormat) {
    return QUALITY_PRESETS[input.quality].imageFormat;
  }
  return 'png';
}

/**
 * Resolve the requested long edge in pixels.
 *
 * `--width` wins over `--scale`, which multiplies the task's own base long
 * edge. `--quality` only contributes when neither is given.
 */
function resolveLongEdge(input: PlanInput, resolution: ResolutionSupport): number | undefined {
  if (input.width !== undefined) {
    return input.width;
  }

  const base = resolution.kind === 'tiered' || resolution.kind === 'free' ? resolution.base : undefined;

  if (input.scale !== undefined && base !== undefined) {
    return Math.round(base * input.scale);
  }

  if (input.quality) {
    const preset = QUALITY_PRESETS[input.quality];
    if (resolution.kind === 'tiered') {
      return preset.tiered;
    }
    if (resolution.kind === 'free') {
      return preset.free;
    }
  }

  return undefined;
}

function mapParams(task: DeckTaskType, input: PlanInput, warnings: PlanWarning[]): Record<string, unknown> {
  const capability = capabilityFor(task);
  const params: Record<string, unknown> = {};

  switch (task) {
    case 'convertor.ppt2image': {
      const longEdge = resolveLongEdge(input, capability.resolution);
      if (longEdge !== undefined && capability.resolution.kind === 'tiered') {
        const snapped = snapToTier(longEdge, capability.resolution.tiers);
        if (snapped !== longEdge) {
          warnings.push({
            message: `Resolution ${longEdge} snapped to ${snapped}: convertor.ppt2image accepts only ${capability.resolution.tiers.join('/')}.`,
          });
        }
        params.resolution = snapped;
      }
      params.format = imageEncodingFor(input);
      return params;
    }

    case 'convertor.pdf2image': {
      const longEdge = resolveLongEdge(input, capability.resolution);
      if (longEdge !== undefined) {
        params.resolution = longEdge;
      }
      params.format = imageEncodingFor(input);
      return params;
    }

    case 'convertor.html2png': {
      if (input.scale !== undefined) {
        params.scale = input.scale;
      }
      if (input.width !== undefined) {
        params.width = input.width;
      }
      params.fullPage = true;
      return params;
    }

    case 'convertor.markdown2png': {
      if (input.scale !== undefined) {
        params.scale = input.scale;
      }
      if (input.width !== undefined) {
        params.pageWidth = input.width;
      }
      return params;
    }

    case 'convertor.html2pptx': {
      params.needEmbedFonts = input.embedFonts ?? false;
      return params;
    }

    default:
      return params;
  }
}

/**
 * The encoding actually requested from the backend.
 *
 * `webp` is never a backend encoding: it is produced by a trailing
 * `image.convertWebp` step, so the base task still renders PNG.
 */
function imageEncodingFor(input: PlanInput): 'png' | 'jpg' {
  if (input.imageFormat === 'jpg') {
    return 'jpg';
  }
  if (input.imageFormat === 'png' || input.imageFormat === 'webp') {
    return 'png';
  }
  if (input.quality) {
    const preset = QUALITY_PRESETS[input.quality].imageFormat;
    return preset === 'jpg' ? 'jpg' : 'png';
  }
  return 'png';
}

import type { SoftOption } from '../core/plan.js';
import type { ImageFormat, ProfileName, Quality, RenderOptions, TargetFormat } from '../types.js';

export interface ProfileDefaults {
  format?: TargetFormat;
  imageFormat?: ImageFormat;
  width?: number;
  quality?: Quality;
  pages?: string;
}

/**
 * Named bundles of flag defaults — not separate execution paths.
 *
 * A profile never changes the route; it only pre-fills flags, and anything the
 * user types wins. Values that a given route cannot honour are dropped with a
 * warning rather than failing the render (see `SoftOption` in core/plan.ts).
 */
export const PROFILES: Record<ProfileName, ProfileDefaults> = {
  web: { format: 'image', imageFormat: 'webp', width: 1920, quality: 'medium' },
  presentation: { format: 'image', imageFormat: 'png', width: 1920, quality: 'high' },
  // No quality: PDF routes reject it outright, and a profile should not ship a
  // default that is guaranteed to be dropped.
  print: { format: 'pdf' },
  thumbnail: { format: 'image', imageFormat: 'jpg', width: 640, quality: 'low', pages: '1' },
};

/** Option names a profile or config file can contribute. */
export const SOFT_OPTION_KEYS = [
  'imageFormat',
  'width',
  'scale',
  'quality',
  'pages',
  'embedFonts',
] as const satisfies readonly SoftOption[];

export type LayeredOptions = Pick<
  RenderOptions,
  'format' | 'imageFormat' | 'width' | 'scale' | 'quality' | 'pages' | 'embedFonts' | 'timeout'
>;

export interface LayerResult {
  options: LayeredOptions;
  /** Which options came from a profile or config rather than the command line. */
  soft: Set<SoftOption>;
}

/**
 * Merge configuration layers.
 *
 * Precedence, lowest first: profile defaults, config file, explicit flags.
 * Environment variables are handled by the credential layer, which is a
 * separate concern from render defaults.
 */
export function layerOptions(
  profile: ProfileDefaults | undefined,
  config: LayeredOptions,
  explicit: LayeredOptions
): LayerResult {
  const merged: LayeredOptions = { ...profile, ...compact(config), ...compact(explicit) };
  const soft = new Set<SoftOption>();

  for (const key of SOFT_OPTION_KEYS) {
    const fromExplicit = explicit[key] !== undefined;
    const present = merged[key] !== undefined;
    if (present && !fromExplicit) {
      soft.add(key);
    }
  }

  return { options: merged, soft };
}

function compact<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

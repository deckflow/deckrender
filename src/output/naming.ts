import path from 'node:path';
import type { TargetFormat } from '../types.js';

/** Default file extension for a target format when nothing else says otherwise. */
export const DEFAULT_EXTENSION: Record<TargetFormat, string> = {
  image: '.png',
  pdf: '.pdf',
  video: '.mp4',
};

/** `-o` extensions that imply a target format. */
const EXTENSION_TO_FORMAT: Record<string, TargetFormat> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.pdf': 'pdf',
  '.mp4': 'video',
};

export interface InferredOutput {
  format?: TargetFormat;
  imageFormat?: 'png' | 'jpg' | 'webp';
}

/** Infer `--format` / `--image-format` from an output path's extension. */
export function inferFromOutputPath(out: string): InferredOutput {
  const ext = path.extname(out).toLowerCase();
  const format = EXTENSION_TO_FORMAT[ext];
  if (!format) {
    return {};
  }
  if (format !== 'image') {
    return { format };
  }
  return { format, imageFormat: ext === '.jpeg' ? 'jpg' : (ext.slice(1) as 'png' | 'jpg' | 'webp') };
}

/**
 * Zero-padded frame name: `001.png`.
 *
 * Width is at least 3 so small decks still sort correctly next to large ones.
 */
export function frameName(index: number, total: number, ext: string): string {
  const width = Math.max(3, String(total).length);
  return `${String(index).padStart(width, '0')}${ext}`;
}

/** `out.png` + frame 2 of 12 → `out-002.png`. */
export function templatedName(out: string, index: number, total: number): string {
  const ext = path.extname(out);
  const base = out.slice(0, out.length - ext.length);
  const width = Math.max(3, String(total).length);
  return `${base}-${String(index).padStart(width, '0')}${ext}`;
}

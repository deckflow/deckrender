import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DeckRenderError } from '../../errors/index.js';
import type { RenderInput } from '../../types.js';
import type { ExecuteContext } from '../engine.js';

export interface ConvertedDeck {
  kind: 'deck';
  directory: string;
  indexPath: string;
  totalPages: number;
  /** Standalone slide documents, in public (1-based) page order. */
  slides?: OfficeSlide[];
}

export interface OfficeSlide {
  page: number;
  path: string;
}

export interface Office2htmlOptions {
  binary: string;
  workDirectory: string;
  timeoutMs: number;
}

export async function convertWithOffice2html(
  input: RenderInput,
  options: Office2htmlOptions,
  ctx: ExecuteContext
): Promise<ConvertedDeck> {
  const inputPath = await materializePptx(input, options.workDirectory);
  const outputDirectory = path.join(options.workDirectory, 'office2html');

  ctx.onProgress?.({
    phase: 'task',
    task: 'local.office2html',
    message: `Converting ${path.basename(inputPath)} locally (first run may take about 40s)`,
  });

  const { stdout, stderr } = await runOffice2html(
    options.binary,
    [inputPath, '-o', outputDirectory],
    options.timeoutMs
  );
  const output = `${stdout}\n${stderr}`.trim();
  const totalPages = parseOffice2htmlPageCount(output);

  const indexPath = path.join(outputDirectory, 'index.html');
  let indexHtml: string;
  try {
    indexHtml = await fs.readFile(indexPath, 'utf8');
  } catch (error) {
    throw DeckRenderError.conversion('office2html reported success but did not create index.html.', {
      cause: error,
    });
  }
  const slides = await discoverDeckSlides(outputDirectory, indexHtml, totalPages);

  return { kind: 'deck', directory: outputDirectory, indexPath, totalPages, ...(slides ? { slides } : {}) };
}

export function parseOffice2htmlPageCount(output: string): number {
  // New builds report `size: ..., pages: N, assets: M, time: ...`.
  // Keep the old summary for explicitly configured legacy binaries.
  const match = /\b(?:Slides|pages):\s*(\d+)\s*,\s*assets:\s*\d+/i.exec(output);
  const totalPages = match ? Number(match[1]) : 0;
  if (!Number.isSafeInteger(totalPages) || totalPages <= 0) {
    throw DeckRenderError.conversion(
      `office2html completed without a valid slide count${output ? `: ${oneLine(output)}` : '.'}`,
      { hint: 'Expected the office2html summary `pages: N, assets: M` (or legacy `Slides: N, assets: M`).' }
    );
  }

  return totalPages;
}

/** Validate the converter's manifest rather than guessing a filename's page base. */
export async function discoverDeckSlides(
  directory: string,
  indexHtml: string,
  totalPages: number
): Promise<OfficeSlide[] | undefined> {
  for (const script of indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\bid\s*=\s*(["'])slide-meta\1/i.test(script[1] ?? '')) continue;
    let metadata: unknown;
    try {
      metadata = JSON.parse(script[2] ?? '');
    } catch (error) {
      throw DeckRenderError.conversion('office2html produced invalid slide-meta JSON.', { cause: error });
    }
    if (!Array.isArray(metadata) || metadata.length !== totalPages) {
      throw DeckRenderError.conversion(
        'office2html slide-meta count does not match its reported page count.'
      );
    }
    const slides: OfficeSlide[] = [];
    for (const entry of metadata) {
      if (!entry || !Number.isSafeInteger(entry.index) || entry.index < 0 || typeof entry.src !== 'string') {
        throw DeckRenderError.conversion('office2html produced an invalid slide-meta entry.');
      }
      const src: string = entry.src;
      if (
        !src.startsWith('slides/') ||
        !src.endsWith('.html') ||
        /[\\?#]/.test(src) ||
        src.split('/').some((part) => !part || part === '.' || part === '..')
      ) {
        throw DeckRenderError.conversion('office2html slide-meta contains an unsafe slide path.');
      }
      slides.push({ page: entry.index + 1, path: path.resolve(directory, src) });
    }
    slides.sort((a, b) => a.page - b.page);
    if (
      slides.some((slide, index) => slide.page !== index + 1) ||
      new Set(slides.map((s) => s.path)).size !== slides.length
    ) {
      throw DeckRenderError.conversion(
        'office2html slide-meta indexes or paths are duplicated or not contiguous.'
      );
    }
    await validateSlideFiles(directory, slides);
    return slides;
  }

  // Some converter builds omit slide-meta. Accept only a complete numeric
  // sequence, with either a zero or one base; never use readdir's lexical order.
  const slidesDirectory = path.join(directory, 'slides');
  let names: string[];
  try {
    names = await fs.readdir(slidesDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw DeckRenderError.conversion('Cannot read office2html slides directory.', { cause: error });
  }
  const files = names
    .flatMap((name) => {
      const match = /^(\d+)\.html$/i.exec(name);
      return match ? [{ index: Number(match[1]), path: path.join(slidesDirectory, name) }] : [];
    })
    .sort((a, b) => a.index - b.index);
  const base = files[0]?.index;
  if (
    files.length !== totalPages ||
    (base !== 0 && base !== 1) ||
    files.some((file, index) => !Number.isSafeInteger(file.index) || file.index !== index + base)
  ) {
    throw DeckRenderError.conversion('office2html slide files must form a complete numeric page sequence.');
  }
  const slides = files.map((file, index) => ({ page: index + 1, path: file.path }));
  await validateSlideFiles(directory, slides);
  return slides;
}

async function validateSlideFiles(directory: string, slides: OfficeSlide[]): Promise<void> {
  const root = await fs.realpath(directory);
  for (const slide of slides) {
    try {
      const actual = await fs.realpath(slide.path);
      const relative = path.relative(root, actual);
      if (
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative) ||
        !(await fs.stat(actual)).isFile()
      ) {
        throw new Error('Slide is not a file inside the converted deck.');
      }
    } catch (error) {
      throw DeckRenderError.conversion(`office2html page ${slide.page} is missing or not a safe HTML file.`, {
        cause: error,
      });
    }
  }
}

async function materializePptx(input: RenderInput, workDirectory: string): Promise<string> {
  if (input.path) {
    return input.path;
  }
  if (!input.bytes) {
    throw DeckRenderError.usage('Local PPTX rendering requires file or stdin bytes.');
  }
  const target = path.join(workDirectory, input.name ?? 'input.pptx');
  await fs.writeFile(target, input.bytes);
  return target;
}

function runOffice2html(
  binary: string,
  args: string[],
  timeoutMs: number
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr });
          return;
        }

        const detail = oneLine(`${stderr || stdout || error.message}`);
        const timedOut = error.killed || /timed?\s*out/i.test(error.message);
        reject(
          DeckRenderError.conversion(
            timedOut
              ? `office2html timed out after ${Math.ceil(timeoutMs / 1000)}s.`
              : `office2html failed${detail ? `: ${detail}` : '.'}`,
            {
              hint: timedOut
                ? 'Increase --timeout; the first office2html run may spend 20–40 seconds warming up.'
                : 'The local converter currently accepts PPTX input only.',
              cause: error,
            }
          )
        );
      }
    );
  });
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 1_000);
}

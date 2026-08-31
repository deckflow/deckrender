import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DeckRenderError } from '../../errors/index.js';
import {
  LOCAL_TASK_TYPES,
  type LocalTaskType,
  type RenderArtifact,
  type RenderPlan,
  type RenderStep,
} from '../../types.js';
import type { EngineOutput, ExecuteContext, RenderEngine } from '../engine.js';
import { resolveOffice2htmlBinary } from './binary.js';
import { launchLocalBrowser, type LocalBrowser } from './browser.js';
import { captureDeckImages, captureGenericHtml, printDeckPages, type CaptureParams } from './capture.js';
import { convertWithOffice2html, type ConvertedDeck } from './office2html.js';
import { mergePdfPages } from './pdf.js';
import { renderPdfWithPdfJs } from './pdfjs.js';

export interface LocalEngineOptions {
  /** Per-operation timeout in seconds. */
  timeout?: number;
  executablePath?: string;
  office2htmlPath?: string;
}

type Carrier =
  | { kind: 'input' }
  | ConvertedDeck
  | { kind: 'artifacts'; items: RenderArtifact[] }
  | { kind: 'pdf-pages'; items: { page: number; path: string }[] };

const DEFAULT_TIMEOUT_SECONDS = 300;

export class LocalEngine implements RenderEngine {
  readonly name = 'local';

  private readonly timeoutMs: number;
  private readonly executablePath?: string;
  private readonly office2htmlPath?: string;

  constructor(options: LocalEngineOptions = {}) {
    this.timeoutMs = (options.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1_000;
    this.executablePath = options.executablePath;
    this.office2htmlPath = options.office2htmlPath;
  }

  supports(plan: RenderPlan): boolean {
    return (
      plan.kind !== 'passthrough' &&
      plan.steps.length > 0 &&
      plan.steps.every((step) => (LOCAL_TASK_TYPES as readonly string[]).includes(step.task as LocalTaskType))
    );
  }

  async execute(plan: RenderPlan, ctx: ExecuteContext): Promise<EngineOutput> {
    const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-local-'));
    let browser: LocalBrowser | undefined;
    let carrier: Carrier = { kind: 'input' };
    let totalPages = 0;

    const getBrowser = async (): Promise<LocalBrowser> => {
      browser ??= await launchLocalBrowser(this.executablePath);
      return browser;
    };

    try {
      for (const step of plan.steps) {
        switch (step.task) {
          case 'local.office2html': {
            assertCarrier(carrier, 'input', step);
            const binary = await resolveOffice2htmlBinary(this.office2htmlPath);
            carrier = await convertWithOffice2html(
              ctx.input,
              { binary, workDirectory, timeoutMs: this.timeoutMs },
              ctx
            );
            totalPages = carrier.totalPages;
            break;
          }

          case 'local.capture': {
            const captureOptions = {
              browser: await getBrowser(),
              outputDirectory: path.join(workDirectory, 'images'),
              timeoutMs: this.timeoutMs,
            };
            const params = captureParams(step);
            if (carrier.kind === 'deck') {
              const items = await captureDeckImages(carrier, params, plan.pages, captureOptions, ctx);
              if (items.length === 0) {
                throw DeckRenderError.conversion('Local slide capture produced no images.');
              }
              carrier = { kind: 'artifacts', items };
              break;
            }
            assertCarrier(carrier, 'input', step);
            const result = await captureGenericHtml(ctx.input, params, captureOptions, ctx);
            carrier = { kind: 'artifacts', items: result.artifacts };
            totalPages = result.totalPages;
            break;
          }

          case 'local.capture-pdf': {
            assertCarrier(carrier, 'deck', step);
            carrier = {
              kind: 'pdf-pages',
              items: await printDeckPages(
                carrier,
                {
                  browser: await getBrowser(),
                  outputDirectory: path.join(workDirectory, 'pdf-pages'),
                  timeoutMs: this.timeoutMs,
                },
                ctx
              ),
            };
            break;
          }

          case 'local.pdf-merge': {
            assertCarrier(carrier, 'pdf-pages', step);
            const merged = await mergePdfPages(carrier.items, path.join(workDirectory, 'pdf'), ctx);
            carrier = { kind: 'artifacts', items: [merged] };
            break;
          }

          case 'local.pdfjs': {
            assertCarrier(carrier, 'input', step);
            const result = await renderPdfWithPdfJs(
              ctx.input,
              captureParams(step),
              plan.pages,
              {
                browser: await getBrowser(),
                outputDirectory: path.join(workDirectory, 'pdf-images'),
                timeoutMs: this.timeoutMs,
              },
              ctx
            );
            carrier = { kind: 'artifacts', items: result.artifacts };
            totalPages = result.totalPages;
            break;
          }

          default:
            throw DeckRenderError.render(`The local engine cannot execute step ${step.task}.`);
        }
      }

      if (carrier.kind !== 'artifacts' || carrier.items.length === 0) {
        throw DeckRenderError.conversion('Local rendering produced no artifacts.');
      }
      await browser?.browser.close();
      browser = undefined;

      return {
        artifacts: carrier.items.sort((a, b) => a.page - b.page),
        totalPages: totalPages || carrier.items.length,
        cleanup: () => fs.rm(workDirectory, { recursive: true, force: true }),
      };
    } catch (error) {
      await browser?.browser.close().catch(() => undefined);
      await fs.rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }
}

function captureParams(step: RenderStep): CaptureParams {
  const params = step.params;
  const imageFormat = params.imageFormat === 'jpg' ? 'jpg' : 'png';
  return {
    imageFormat,
    ...(typeof params.width === 'number' ? { width: params.width } : {}),
    ...(typeof params.scale === 'number' ? { scale: params.scale } : {}),
    ...(typeof params.jpegQuality === 'number' ? { jpegQuality: params.jpegQuality } : {}),
  };
}

function assertCarrier<K extends Carrier['kind']>(
  carrier: Carrier,
  expected: K,
  step: RenderStep
): asserts carrier is Extract<Carrier, { kind: K }> {
  if (carrier.kind !== expected) {
    throw DeckRenderError.render(
      `Step ${step.task} expected a ${expected} carrier but received ${carrier.kind}.`
    );
  }
}

export {
  LOCAL_NOT_IMPLEMENTED,
  LOCAL_ROUTES,
  findLocalRoute,
  localPlannedReason,
  localSupportedTargets,
  type LocalRoute,
} from './routes.js';
export { resolveOffice2htmlBinary, OFFICE2HTML_PATH_ENV } from './binary.js';
export { CHROMIUM_PATH_ENV } from './browser.js';

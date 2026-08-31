/// <reference lib="dom" />

import fs from 'node:fs/promises';
import http, { type Server } from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { applyPageSelection } from '../../core/pages.js';
import { DeckRenderError } from '../../errors/index.js';
import type { RenderArtifact, RenderInput } from '../../types.js';
import type { ExecuteContext } from '../engine.js';
import type { LocalBrowser } from './browser.js';
import { imageDimensions, type CaptureParams } from './capture.js';

export interface PdfJsOptions {
  browser: LocalBrowser;
  outputDirectory: string;
  timeoutMs: number;
}

export async function renderPdfWithPdfJs(
  input: RenderInput,
  params: CaptureParams,
  selectedPages: number[] | undefined,
  options: PdfJsOptions,
  ctx: ExecuteContext
): Promise<{ artifacts: RenderArtifact[]; totalPages: number }> {
  const bytes = await pdfBytes(input);
  const pdfjsRoot = await resolvePdfJsRoot();
  const localServer = await startPdfJsServer(pdfjsRoot, bytes);
  const context = await options.browser.newContext({ viewport: { width: 1280, height: 960 } });

  try {
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1' && url.port === String(localServer.port)) {
        return route.continue();
      }
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    await page.goto(`http://127.0.0.1:${localServer.port}/`, {
      waitUntil: 'domcontentloaded',
      timeout: options.timeoutMs,
    });
    await page.waitForFunction(() => Boolean((globalThis as { pdfjsReady?: boolean }).pdfjsReady));

    let totalPages: number;
    try {
      totalPages = await page.evaluate(async () => {
        const globals = globalThis as unknown as {
          pdfjsLib: {
            getDocument(options: Record<string, unknown>): { promise: Promise<{ numPages: number }> };
          };
          pdfDocument?: { numPages: number };
        };
        const task = globals.pdfjsLib.getDocument({
          url: '/input.pdf',
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          disableRange: true,
          disableStream: true,
          isEvalSupported: false,
        });
        const document = await task.promise;
        globals.pdfDocument = document;
        return document.numPages;
      });
    } catch (error) {
      throw mapPdfJsError(error);
    }

    const allPages = Array.from({ length: totalPages }, (_, index) => ({ page: index + 1 }));
    const wanted = selectedPages ? applyPageSelection(allPages, selectedPages) : allPages;
    await fs.mkdir(options.outputDirectory, { recursive: true });
    const artifacts: RenderArtifact[] = [];

    for (const [offset, item] of wanted.entries()) {
      ctx.onProgress?.({
        phase: 'task',
        task: 'local.pdfjs',
        message: `Rasterizing PDF page ${item.page} of ${totalPages}`,
        ratio: (offset + 1) / wanted.length,
      });
      let dimensions: { width: number; height: number };
      try {
        dimensions = await page.evaluate(
          async ({ pageNumber, targetWidth, requestedScale }) => {
            type PdfPage = {
              getViewport(options: { scale: number }): { width: number; height: number };
              render(options: Record<string, unknown>): { promise: Promise<void> };
              cleanup(): void;
            };
            const globals = globalThis as unknown as {
              pdfDocument: { getPage(page: number): Promise<PdfPage> };
            };
            const pdfPage = await globals.pdfDocument.getPage(pageNumber);
            const base = pdfPage.getViewport({ scale: 1 });
            const scale =
              targetWidth !== undefined
                ? targetWidth / Math.max(base.width, base.height)
                : (requestedScale ?? 1.5);
            const viewport = pdfPage.getViewport({ scale });
            const canvas = document.querySelector<HTMLCanvasElement>('#pdf-canvas');
            if (!canvas) {
              throw new Error('PDF.js canvas harness is missing.');
            }
            canvas.width = Math.max(1, Math.ceil(viewport.width));
            canvas.height = Math.max(1, Math.ceil(viewport.height));
            canvas.style.width = `${canvas.width}px`;
            canvas.style.height = `${canvas.height}px`;
            const canvasContext = canvas.getContext('2d', { alpha: false });
            if (!canvasContext) {
              throw new Error('Could not create a 2D canvas context.');
            }
            canvasContext.fillStyle = '#fff';
            canvasContext.fillRect(0, 0, canvas.width, canvas.height);
            await pdfPage.render({ canvasContext, viewport, background: '#fff' }).promise;
            pdfPage.cleanup();
            return { width: canvas.width, height: canvas.height };
          },
          {
            pageNumber: item.page,
            targetWidth: params.width,
            requestedScale: params.scale,
          }
        );
      } catch (error) {
        throw mapPdfJsError(error, item.page);
      }

      const output = path.join(
        options.outputDirectory,
        `${String(item.page).padStart(6, '0')}.${params.imageFormat}`
      );
      const screenshot = await page.locator('#pdf-canvas').screenshot({
        path: output,
        type: params.imageFormat === 'jpg' ? 'jpeg' : 'png',
        ...(params.imageFormat === 'jpg' ? { quality: params.jpegQuality ?? 88 } : {}),
        timeout: options.timeoutMs,
      });
      dimensions = imageDimensions(screenshot);
      artifacts.push({
        page: item.page,
        source: output,
        ext: params.imageFormat === 'jpg' ? '.jpg' : '.png',
        width: dimensions.width,
        height: dimensions.height,
      });
    }

    return { artifacts, totalPages };
  } finally {
    await context.close();
    await closeServer(localServer.server);
  }
}

async function pdfBytes(input: RenderInput): Promise<Uint8Array> {
  if (input.bytes) {
    return input.bytes;
  }
  if (input.path) {
    return fs.readFile(input.path);
  }
  throw DeckRenderError.usage('Local PDF rendering requires file or stdin bytes.');
}

async function resolvePdfJsRoot(): Promise<string> {
  try {
    const require = createRequire(import.meta.url);
    return path.dirname(require.resolve('pdfjs-dist/package.json'));
  } catch (error) {
    throw DeckRenderError.render('pdfjs-dist is required for local PDF image output.', {
      hint: 'Reinstall DeckRender without --omit=optional, or install pdfjs-dist@4.8.69.',
      cause: error,
    });
  }
}

async function startPdfJsServer(
  pdfjsRoot: string,
  pdf: Uint8Array
): Promise<{ server: Server; port: number }> {
  const server = http.createServer((request, response) => {
    void handleRequest(request.url ?? '/', response, pdfjsRoot, pdf);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw DeckRenderError.render('Could not start the local PDF.js harness.');
  }
  return { server, port: address.port };
}

async function handleRequest(
  rawUrl: string,
  response: http.ServerResponse,
  pdfjsRoot: string,
  pdf: Uint8Array
): Promise<void> {
  try {
    const pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
    if (pathname === '/') {
      send(response, 200, 'text/html; charset=utf-8', Buffer.from(harnessHtml()));
      return;
    }
    if (pathname === '/input.pdf') {
      send(response, 200, 'application/pdf', Buffer.from(pdf));
      return;
    }
    if (pathname.startsWith('/pdfjs/')) {
      const relative = decodeURIComponent(pathname.slice('/pdfjs/'.length));
      const candidate = path.resolve(pdfjsRoot, relative);
      const rootPrefix = `${path.resolve(pdfjsRoot)}${path.sep}`;
      if (!candidate.startsWith(rootPrefix)) {
        send(response, 403, 'text/plain', Buffer.from('forbidden'));
        return;
      }
      const content = await fs.readFile(candidate);
      send(response, 200, contentType(candidate), content);
      return;
    }
    send(response, 404, 'text/plain', Buffer.from('not found'));
  } catch {
    send(response, 404, 'text/plain', Buffer.from('not found'));
  }
}

function send(
  response: http.ServerResponse,
  status: number,
  contentTypeValue: string,
  bytes: Uint8Array
): void {
  response.writeHead(status, {
    'content-type': contentTypeValue,
    'content-length': bytes.byteLength,
    'cache-control': 'no-store',
  });
  response.end(bytes);
}

function contentType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.mjs' || ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json';
  if (ext === '.ttf' || ext === '.otf') return 'font/ttf';
  return 'application/octet-stream';
}

function harnessHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}canvas{display:block}</style></head>
<body><canvas id="pdf-canvas"></canvas>
<script type="module">
import * as pdfjsLib from '/pdfjs/legacy/build/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/legacy/build/pdf.worker.mjs';
globalThis.pdfjsLib = pdfjsLib;
globalThis.pdfjsReady = true;
</script></body></html>`;
}

function mapPdfJsError(error: unknown, page?: number): DeckRenderError {
  const message = error instanceof Error ? error.message : String(error);
  if (/password|PasswordException/i.test(message)) {
    return DeckRenderError.conversion('Encrypted PDFs are not supported by the local engine.', {
      hint: 'Decrypt the PDF first, or choose --engine cloud.',
      cause: error,
    });
  }
  return DeckRenderError.conversion(
    `PDF.js could not render${page ? ` page ${page}` : ' the document'}: ${message}`,
    { cause: error }
  );
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

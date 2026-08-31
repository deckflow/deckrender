/// <reference lib="dom" />

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyPageSelection } from '../../core/pages.js';
import { DeckRenderError } from '../../errors/index.js';
import { withBaseHref } from '../../input/resolve.js';
import type { RenderArtifact, RenderInput } from '../../types.js';
import type { ExecuteContext } from '../engine.js';
import type { ConvertedDeck, OfficeSlide } from './office2html.js';
import type { LocalBrowser } from './browser.js';

export interface CaptureParams {
  imageFormat: 'png' | 'jpg';
  width?: number;
  scale?: number;
  jpegQuality?: number;
}

export interface CaptureOptions {
  browser: LocalBrowser;
  outputDirectory: string;
  timeoutMs: number;
}

interface Viewport {
  width: number;
  height: number;
}

interface SlideRef {
  page: number;
  slideIndex: number;
}

const OFFLINE_OFFICE_CSS = `
.absolute{position:absolute}.relative{position:relative}.fixed{position:fixed}
.block{display:block}.inline-block{display:inline-block}.hidden{display:none}
.flex{display:flex}.inline-flex{display:inline-flex}.grid{display:grid}
.flex-row{flex-direction:row}.flex-col{flex-direction:column}.flex-wrap{flex-wrap:wrap}
.items-start{align-items:flex-start}.items-center{align-items:center}.items-end{align-items:flex-end}
.justify-start{justify-content:flex-start}.justify-center{justify-content:center}.justify-end{justify-content:flex-end}.justify-between{justify-content:space-between}
.w-full{width:100%}.h-full{height:100%}.min-w-0{min-width:0}.min-h-0{min-height:0}
.overflow-hidden{overflow:hidden}.overflow-visible{overflow:visible}
.whitespace-nowrap{white-space:nowrap}.whitespace-pre-wrap{white-space:pre-wrap}
.text-left{text-align:left}.text-center{text-align:center}.text-right{text-align:right}
.object-contain{object-fit:contain}.object-cover{object-fit:cover}
`;

export async function captureDeckImages(
  deck: ConvertedDeck,
  params: CaptureParams,
  selectedPages: number[] | undefined,
  options: CaptureOptions,
  ctx: ExecuteContext
): Promise<RenderArtifact[]> {
  if (deck.slides) {
    const viewport = await standaloneViewport(deck);
    const slides = selectedPages ? applyPageSelection(deck.slides, selectedPages) : deck.slides;
    return captureStandaloneSlides(
      slides,
      viewport,
      imageScale(viewport, params),
      options,
      async (page, slide, selector) => {
        const output = path.join(
          options.outputDirectory,
          `${String(slide.page).padStart(6, '0')}.${params.imageFormat}`
        );
        const screenshot = await page.locator(selector).screenshot({
          path: output,
          type: params.imageFormat === 'jpg' ? 'jpeg' : 'png',
          ...(params.imageFormat === 'jpg' ? { quality: params.jpegQuality ?? 88 } : {}),
          animations: 'disabled',
          caret: 'hide',
          timeout: options.timeoutMs,
        });
        return {
          page: slide.page,
          source: output,
          ext: params.imageFormat === 'jpg' ? '.jpg' : '.png',
          ...imageDimensions(screenshot),
        };
      },
      (slide, ratio) =>
        ctx.onProgress?.({
          phase: 'task',
          task: 'local.capture',
          message: `Capturing page ${slide.page} of ${deck.totalPages}`,
          ratio,
        })
    );
  }
  const html = await fs.readFile(deck.indexPath, 'utf8');
  const viewport = parseDeckViewport(html);
  const deviceScaleFactor = imageScale(viewport, params);
  const context = await options.browser.newContext({ viewport, deviceScaleFactor });

  try {
    await blockExternalNetwork(context);
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    await loadAndSettle(page, pathToFileURL(deck.indexPath).href, options.timeoutMs, true);
    await page.addStyleTag({ content: OFFLINE_OFFICE_CSS });
    await stabilizeCjkFontFallback(page);

    const slides = await deckSlides(page, deck.totalPages);
    const wanted = selectedPages ? applyPageSelection(slides, selectedPages) : slides;
    await fs.mkdir(options.outputDirectory, { recursive: true });

    const artifacts: RenderArtifact[] = [];
    for (const [offset, slide] of wanted.entries()) {
      ctx.onProgress?.({
        phase: 'task',
        task: 'local.capture',
        message: `Capturing page ${slide.page} of ${deck.totalPages}`,
        ratio: (offset + 1) / wanted.length,
      });
      await isolateSlide(page, '#deck > .slide', slide.slideIndex);
      const target = page.locator(`#deck > .slide[data-slide="${slide.slideIndex}"]`);
      const output = path.join(
        options.outputDirectory,
        `${String(slide.page).padStart(6, '0')}.${params.imageFormat}`
      );
      const screenshot = await target.screenshot({
        path: output,
        type: params.imageFormat === 'jpg' ? 'jpeg' : 'png',
        ...(params.imageFormat === 'jpg' ? { quality: params.jpegQuality ?? 88 } : {}),
        animations: 'disabled',
        caret: 'hide',
        timeout: options.timeoutMs,
      });
      const dimensions = imageDimensions(screenshot);
      artifacts.push({
        page: slide.page,
        source: output,
        ext: params.imageFormat === 'jpg' ? '.jpg' : '.png',
        width: dimensions.width,
        height: dimensions.height,
      });
    }
    return artifacts.sort((a, b) => a.page - b.page);
  } finally {
    await context.close();
  }
}

export async function printDeckPages(
  deck: ConvertedDeck,
  options: CaptureOptions,
  ctx: ExecuteContext
): Promise<{ page: number; path: string }[]> {
  if (deck.slides) {
    const viewport = await standaloneViewport(deck);
    return captureStandaloneSlides(
      deck.slides,
      viewport,
      1,
      options,
      async (page, slide) => {
        const output = path.join(options.outputDirectory, `${String(slide.page).padStart(6, '0')}.pdf`);
        await page.pdf({
          path: output,
          width: `${viewport.width}px`,
          height: `${viewport.height}px`,
          printBackground: true,
          preferCSSPageSize: true,
          pageRanges: '1',
        });
        return { page: slide.page, path: output };
      },
      (slide, ratio) =>
        ctx.onProgress?.({
          phase: 'task',
          task: 'local.capture-pdf',
          message: `Printing page ${slide.page} of ${deck.totalPages}`,
          ratio,
        })
    );
  }
  const html = await fs.readFile(deck.indexPath, 'utf8');
  const viewport = parseDeckViewport(html);
  const context = await options.browser.newContext({ viewport });

  try {
    await blockExternalNetwork(context);
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    await page.emulateMedia({ media: 'screen' });
    await loadAndSettle(page, pathToFileURL(deck.indexPath).href, options.timeoutMs, true);
    await page.addStyleTag({ content: `${OFFLINE_OFFICE_CSS}\n${printCss(viewport)}` });
    await stabilizeCjkFontFallback(page);
    const slides = await deckSlides(page, deck.totalPages);
    await fs.mkdir(options.outputDirectory, { recursive: true });

    const outputs: { page: number; path: string }[] = [];
    for (const [offset, slide] of slides.entries()) {
      ctx.onProgress?.({
        phase: 'task',
        task: 'local.capture-pdf',
        message: `Printing page ${slide.page} of ${deck.totalPages}`,
        ratio: (offset + 1) / slides.length,
      });
      await isolateSlide(page, '#deck > .slide', slide.slideIndex);
      const output = path.join(options.outputDirectory, `${String(slide.page).padStart(6, '0')}.pdf`);
      await page.pdf({
        path: output,
        width: `${viewport.width}px`,
        height: `${viewport.height}px`,
        printBackground: true,
        preferCSSPageSize: true,
        pageRanges: '1',
      });
      outputs.push({ page: slide.page, path: output });
    }
    return outputs.sort((a, b) => a.page - b.page);
  } finally {
    await context.close();
  }
}

async function standaloneViewport(deck: ConvertedDeck): Promise<Viewport> {
  const firstSlide = deck.slides?.[0];
  const fallback = firstSlide ? parseDeckViewport(await fs.readFile(firstSlide.path, 'utf8')) : undefined;
  return parseDeckViewport(await fs.readFile(deck.indexPath, 'utf8'), fallback);
}

/** Bounded page workers: save directly to disk, and settle every worker before closing its context. */
async function captureStandaloneSlides<T>(
  slides: OfficeSlide[],
  viewport: Viewport,
  deviceScaleFactor: number,
  options: CaptureOptions,
  capture: (page: import('playwright-core').Page, slide: OfficeSlide, selector: string) => Promise<T>,
  progress: (slide: OfficeSlide, ratio: number) => void
): Promise<T[]> {
  await fs.mkdir(options.outputDirectory, { recursive: true });
  const context = await options.browser.newContext({ viewport, deviceScaleFactor, serviceWorkers: 'block' });
  try {
    await blockExternalNetwork(context);
    const concurrency = Math.min(slides.length, 4, Math.max(1, os.cpus().length - 2));
    const results: T[] = new Array(slides.length);
    let nextJob = 0;
    let completed = 0;
    let stopped = false;
    const workers = Array.from({ length: concurrency }, async () => {
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(options.timeoutMs);
        await page.emulateMedia({ media: 'screen' });
        while (!stopped) {
          const job = nextJob++;
          const slide = slides[job];
          if (!slide) return;
          await loadAndSettle(page, pathToFileURL(slide.path).href, options.timeoutMs, true);
          const selector = await prepareStandaloneFrame(page, viewport);
          await stabilizeCjkFontFallback(page, selector);
          await settleSlideAssets(page, options.timeoutMs);
          results[job] = await capture(page, slide, selector);
          progress(slide, ++completed / slides.length);
        }
      } catch (error) {
        stopped = true;
        throw error;
      }
    });
    const settled = await Promise.allSettled(workers);
    const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) throw failed.reason;
    return results;
  } finally {
    await context.close();
  }
}

async function prepareStandaloneFrame(
  page: import('playwright-core').Page,
  viewport: Viewport
): Promise<string> {
  const selectors = [
    '#deck > .slide',
    '.slide-canvas',
    '.slide-container',
    '.slide-wrap',
    '.slide',
    '[data-slide]',
  ];
  let selector: string | undefined;
  for (const candidate of selectors) {
    const count = await page.locator(candidate).count();
    if (count === 0) continue;
    if (count !== 1)
      throw DeckRenderError.conversion('A standalone office2html page must contain exactly one slide host.');
    selector = candidate;
    break;
  }
  if (!selector)
    throw DeckRenderError.conversion('office2html standalone page contains no recognizable slide host.');
  await page.addStyleTag({
    content: `${OFFLINE_OFFICE_CSS}\n${printCss(viewport)}
    #app, #stage, #deck { display:block !important; position:relative !important; top:0 !important; left:0 !important; transform:none !important; }
    #stage { width:${viewport.width}px !important; height:${viewport.height}px !important; overflow:hidden !important; }
    ${selector} { display:block !important; visibility:visible !important; position:relative !important; top:0 !important; left:0 !important; margin:0 !important; width:${viewport.width}px !important; height:${viewport.height}px !important; box-sizing:border-box !important; box-shadow:none !important; }
  `,
  });
  await page.evaluate((hostSelector) => {
    const host = document.querySelector<HTMLElement>(hostSelector)!;
    host.classList.add('is-active');
    for (const animation of document.getAnimations()) {
      try {
        animation.finish();
      } catch {
        animation.cancel();
      }
    }
    // Reveal click-gated Office entrances without losing the shape's original transform/opacity.
    for (const shape of Array.from(host.querySelectorAll<HTMLElement>('[data-shape-id]'))) {
      if (shape.classList.contains('anim-pending')) {
        shape.classList.remove('anim-pending');
        shape.style.opacity = shape.dataset.baseOpacity ?? '';
        shape.style.transform = shape.dataset.baseTransform ?? shape.style.transform;
      }
    }
    const properties = [
      'opacity',
      'transform',
      'visibility',
      'filter',
      'clip-path',
      'translate',
      'rotate',
      'scale',
    ];
    for (const element of [host, ...Array.from(host.querySelectorAll('*'))]) {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
      const computed = getComputedStyle(element);
      if (computed.animationName !== 'none' || computed.transitionDuration !== '0s') {
        for (const property of properties) {
          const value = computed.getPropertyValue(property);
          if (value) element.style.setProperty(property, value, 'important');
        }
      }
      element.style.setProperty('animation', 'none', 'important');
      element.style.setProperty('transition', 'none', 'important');
    }
    window.scrollTo(0, 0);
  }, selector);
  return selector;
}

async function settleSlideAssets(page: import('playwright-core').Page, timeoutMs: number): Promise<void> {
  await page.evaluate(
    async (timeout) => {
      await Promise.race([
        Promise.all([
          document.fonts.ready,
          ...Array.from(document.images, (image) => image.decode().catch(() => undefined)),
        ]),
        new Promise<void>((resolve) => setTimeout(resolve, timeout)),
      ]);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
    },
    Math.min(timeoutMs, 3_000)
  );
}

export async function captureGenericHtml(
  input: RenderInput,
  params: CaptureParams,
  options: CaptureOptions,
  ctx: ExecuteContext
): Promise<{ artifacts: RenderArtifact[]; totalPages: number }> {
  if (input.text === undefined) {
    throw DeckRenderError.usage('Local HTML capture requires HTML text input.');
  }

  let html = input.text;
  if (input.path) {
    const base = pathToFileURL(`${path.dirname(input.path)}${path.sep}`).href;
    html = withBaseHref(html, base);
  }
  const htmlPath = path.join(options.outputDirectory, 'input.html');
  await fs.mkdir(options.outputDirectory, { recursive: true });
  await fs.writeFile(htmlPath, html, 'utf8');

  const detected = parseDeckViewport(html, { width: params.width ?? 1440, height: 900 });
  const viewport = params.width
    ? {
        width: params.width,
        height: Math.max(1, Math.round(params.width / (detected.width / detected.height))),
      }
    : detected;
  const deviceScaleFactor = params.scale ?? 1;
  const context = await options.browser.newContext({ viewport, deviceScaleFactor });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    await loadAndSettle(page, pathToFileURL(htmlPath).href, options.timeoutMs, false);
    const probe = await probeGenericSlides(page);
    const targets = probe.selector
      ? Array.from({ length: probe.count }, (_, index) => ({ page: index + 1, index }))
      : [{ page: 1, index: 0 }];
    const artifacts: RenderArtifact[] = [];

    for (const [offset, target] of targets.entries()) {
      ctx.onProgress?.({
        phase: 'task',
        task: 'local.capture',
        message: `Capturing HTML page ${target.page} of ${targets.length}`,
        ratio: (offset + 1) / targets.length,
      });
      const output = path.join(
        options.outputDirectory,
        `html-${String(target.page).padStart(6, '0')}.${params.imageFormat}`
      );
      let width: number;
      let height: number;

      if (probe.selector) {
        await isolateSlideByPosition(page, probe.selector, target.index);
        const locator = page.locator(probe.selector).nth(target.index);
        const box = await locator.boundingBox();
        if (!box) {
          throw DeckRenderError.conversion(`HTML page ${target.page} is not visible after isolation.`);
        }
        const screenshot = await locator.screenshot({
          path: output,
          type: params.imageFormat === 'jpg' ? 'jpeg' : 'png',
          ...(params.imageFormat === 'jpg' ? { quality: params.jpegQuality ?? 88 } : {}),
          animations: 'disabled',
          caret: 'hide',
          timeout: options.timeoutMs,
        });
        const screenshotSize = imageDimensions(screenshot);
        width = screenshotSize.width;
        height = screenshotSize.height;
      } else {
        const screenshot = await page.screenshot({
          path: output,
          type: params.imageFormat === 'jpg' ? 'jpeg' : 'png',
          ...(params.imageFormat === 'jpg' ? { quality: params.jpegQuality ?? 88 } : {}),
          fullPage: true,
          animations: 'disabled',
          caret: 'hide',
          timeout: options.timeoutMs,
        });
        const screenshotSize = imageDimensions(screenshot);
        width = screenshotSize.width;
        height = screenshotSize.height;
      }

      artifacts.push({
        page: target.page,
        source: output,
        ext: params.imageFormat === 'jpg' ? '.jpg' : '.png',
        width,
        height,
      });
    }
    return { artifacts, totalPages: targets.length };
  } finally {
    await context.close();
  }
}

export function parseDeckViewport(
  html: string,
  fallback: Viewport = { width: 1920, height: 1080 }
): Viewport {
  const metaTag = Array.from(html.matchAll(/<meta\b[^>]*>/gi)).find(([tag]) =>
    /\bname\s*=\s*(["'])viewport\1/i.test(tag)
  )?.[0];
  const metaContent = /\bcontent\s*=\s*(["'])(.*?)\1/i.exec(metaTag ?? '')?.[2] ?? '';
  const meta = /\bwidth\s*=\s*(\d+)\b/i.exec(metaContent);
  const style =
    /#deck\s*\{([^}]*)\}/i.exec(html)?.[1] ??
    /\.(?:slide-canvas|slide-container|slide-wrap)\s*\{([^}]*)\}/i.exec(html)?.[1] ??
    '';
  const cssWidth = /(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px/i.exec(style);
  const cssHeight = /(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)px/i.exec(style);
  const requestedWidth =
    [Number(meta?.[1]), Number(cssWidth?.[1]), fallback.width].find(
      (candidate) => Number.isFinite(candidate) && candidate > 0
    ) ?? fallback.width;
  const width = Math.max(1, Math.round(requestedWidth));
  const aspect = /\baspect-ratio\s*:\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?/i.exec(style);
  const numerator = Number(aspect?.[1]);
  const denominator = Number(aspect?.[2] ?? 1);
  const explicitRatio = Number(cssWidth?.[1]) / Number(cssHeight?.[1]);
  const ratio =
    Number.isFinite(explicitRatio) && explicitRatio > 0
      ? explicitRatio
      : numerator > 0 && denominator > 0
        ? numerator / denominator
        : fallback.width / fallback.height;
  const height = Math.max(1, Math.round(width / ratio));
  return {
    width: Number.isFinite(width) && width > 0 ? width : fallback.width,
    height: Number.isFinite(height) && height > 0 ? height : fallback.height,
  };
}

function imageScale(viewport: Viewport, params: CaptureParams): number {
  if (params.width !== undefined) {
    return params.width / Math.max(viewport.width, viewport.height);
  }
  return params.scale ?? 1;
}

async function deckSlides(page: import('playwright-core').Page, expectedTotal: number): Promise<SlideRef[]> {
  const indexes = await page.locator('#deck > .slide').evaluateAll((nodes) =>
    nodes.map((node, domIndex) => {
      const raw = node.getAttribute('data-slide');
      return { domIndex, slideIndex: raw !== null ? Number(raw) : Number.NaN };
    })
  );
  if (indexes.length !== expectedTotal) {
    throw DeckRenderError.conversion(
      `office2html reported ${expectedTotal} slides but its HTML contains ${indexes.length}.`
    );
  }
  if (indexes.some(({ slideIndex }) => !Number.isSafeInteger(slideIndex) || slideIndex < 0)) {
    throw DeckRenderError.conversion('office2html produced an invalid data-slide index.');
  }
  const unique = new Set(indexes.map(({ slideIndex }) => slideIndex));
  if (unique.size !== indexes.length) {
    throw DeckRenderError.conversion('office2html produced duplicate data-slide indexes.');
  }
  const orderedIndexes = [...unique].sort((a, b) => a - b);
  if (orderedIndexes.some((slideIndex, position) => slideIndex !== position)) {
    throw DeckRenderError.conversion('office2html data-slide indexes must be contiguous and start at zero.');
  }
  return indexes
    .map(({ slideIndex }) => ({ page: slideIndex + 1, slideIndex }))
    .sort((a, b) => a.page - b.page);
}

async function isolateSlide(
  page: import('playwright-core').Page,
  selector: string,
  slideIndex: number
): Promise<void> {
  await page.evaluate(
    ({ selector, slideIndex }) => {
      const slides = Array.from(document.querySelectorAll<HTMLElement>(selector));
      const target = slides.find((slide) => Number(slide.dataset.slide) === slideIndex);
      if (!target) {
        throw new Error(`Missing slide ${slideIndex}`);
      }
      for (const animation of document.getAnimations()) {
        try {
          animation.finish();
        } catch {
          animation.cancel();
        }
      }
      for (const slide of slides) {
        const active = slide === target;
        slide.classList.toggle('is-active', active);
        slide.classList.remove('is-enter', 'is-leave');
        slide.style.setProperty('display', active ? 'block' : 'none', 'important');
        slide.style.setProperty('visibility', active ? 'visible' : 'hidden', 'important');
        if (active) {
          slide.style.setProperty('position', 'absolute', 'important');
          slide.style.setProperty('inset', '0', 'important');
          for (const element of Array.from(slide.querySelectorAll<HTMLElement>('[data-shape-id]'))) {
            element.classList.remove('anim-pending');
            element.style.opacity = element.dataset.baseOpacity ?? '';
            element.style.transform = element.dataset.baseTransform ?? element.style.transform;
            element.style.animation = 'none';
            element.style.transition = 'none';
          }
        }
      }
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    },
    { selector, slideIndex }
  );
}

async function isolateSlideByPosition(
  page: import('playwright-core').Page,
  selector: string,
  index: number
): Promise<void> {
  await page.evaluate(
    ({ selector, index }) => {
      const slides = Array.from(document.querySelectorAll<HTMLElement>(selector));
      const target = slides[index];
      if (!target) {
        throw new Error(`Missing page host ${index}`);
      }
      for (const animation of document.getAnimations()) {
        try {
          animation.finish();
        } catch {
          animation.cancel();
        }
      }
      for (const slide of slides) {
        const active = slide === target;
        slide.classList.toggle('is-active', active);
        slide.classList.remove('is-enter', 'is-leave');
        slide.style.setProperty('display', active ? 'block' : 'none', 'important');
        slide.style.setProperty('visibility', active ? 'visible' : 'hidden', 'important');
        if (active) {
          slide.style.setProperty('position', 'absolute', 'important');
          slide.style.setProperty('inset', '0', 'important');
          for (const element of Array.from(slide.querySelectorAll<HTMLElement>('[data-shape-id]'))) {
            element.classList.remove('anim-pending');
            element.style.opacity = element.dataset.baseOpacity ?? '';
            element.style.transform = element.dataset.baseTransform ?? element.style.transform;
            element.style.animation = 'none';
            element.style.transition = 'none';
          }
        }
      }
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    },
    { selector, index }
  );
}

async function probeGenericSlides(
  page: import('playwright-core').Page
): Promise<{ selector?: string; count: number }> {
  const selectors = [
    '#deck > .slide',
    '#slides > .slide',
    '.reveal .slides > section',
    '[data-slide]',
    '.slide',
  ];
  for (const selector of selectors) {
    const count = await page.locator(selector).count();
    if (count > 0) {
      return { selector, count };
    }
  }
  return { count: 1 };
}

async function loadAndSettle(
  page: import('playwright-core').Page,
  url: string,
  timeoutMs: number,
  strictLocal: boolean
): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  if (!strictLocal) {
    await page
      .waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 10_000) })
      .catch(() => undefined);
  }
  await page
    .evaluate(async () => {
      if (document.fonts) {
        await Promise.race([
          document.fonts.ready,
          new Promise<void>((resolve) => globalThis.setTimeout(resolve, 3_000)),
        ]);
      }
    })
    .catch(() => undefined);
  await page.waitForTimeout(strictLocal ? 350 : 750);
}

async function blockExternalNetwork(context: import('playwright-core').BrowserContext): Promise<void> {
  await context.route(/^https?:\/\//i, (route) => route.abort('blockedbyclient'));
}

/**
 * Chromium printing can drop CJK glyph fallback from a Latin font run even
 * when the same run paints correctly on screen. Give CJK runs an explicit
 * local system-font family so both screenshot and print paths are stable.
 */
async function stabilizeCjkFontFallback(
  page: import('playwright-core').Page,
  selector = '#deck > .slide'
): Promise<void> {
  const candidates =
    process.platform === 'darwin'
      ? [
          'PingFang SC',
          'Hiragino Sans GB',
          'Hiragino Kaku Gothic ProN',
          'Apple SD Gothic Neo',
          'Arial Unicode MS',
        ]
      : process.platform === 'win32'
        ? ['Microsoft YaHei', 'Yu Gothic', 'Malgun Gothic', 'Microsoft JhengHei', 'SimSun']
        : [
            'Noto Sans CJK SC',
            'Noto Sans CJK JP',
            'Noto Sans CJK KR',
            'Noto Sans SC',
            'WenQuanYi Zen Hei',
            'DejaVu Sans',
          ];

  await page.evaluate(
    ({ fontFamilies, selector }) => {
      const cjk = /[\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
      for (const slide of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          if (cjk.test(node.data) && !node.parentElement?.closest('.deckrender-cjk')) {
            nodes.push(node);
          }
        }
        for (const node of nodes) {
          const fragment = document.createDocumentFragment();
          for (const part of node.data.split(/([\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+)/)) {
            if (!part) continue;
            if (!cjk.test(part)) {
              fragment.append(part);
              continue;
            }
            const span = document.createElement('span');
            span.className = 'deckrender-cjk';
            span.style.fontFamily = fontFamilies.map((name) => `"${name}"`).join(',');
            span.textContent = part;
            fragment.append(span);
          }
          node.replaceWith(fragment);
        }
      }
    },
    { fontFamilies: candidates, selector }
  );
}

function printCss(viewport: Viewport): string {
  return `
@page { size: ${viewport.width}px ${viewport.height}px; margin: 0; }
html, body, #app, #deck { width: ${viewport.width}px !important; height: ${viewport.height}px !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
`;
}

/** Read dimensions from a Playwright PNG/JPEG buffer without another image dependency. */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer.subarray(1, 4).toString('ascii') === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1] ?? 0;
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > buffer.length) {
        break;
      }
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += length + 2;
    }
  }

  throw DeckRenderError.conversion('Chromium returned an image with an unrecognized encoding.');
}

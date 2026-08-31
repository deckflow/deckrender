/// <reference lib="dom" />

import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import type { Locator, Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExecuteContext } from '../../src/engines/engine.js';
import { launchLocalBrowser, type LocalBrowser } from '../../src/engines/local/browser.js';
import { captureDeckImages, imageDimensions, printDeckPages } from '../../src/engines/local/capture.js';
import type { ConvertedDeck } from '../../src/engines/local/office2html.js';
import { mergePdfPages } from '../../src/engines/local/pdf.js';

const describeLocal = process.env.DECKRENDER_LOCAL_E2E === '1' ? describe : describe.skip;
const TEST_TIMEOUT = 120_000;
const CAPTURE_TIMEOUT = 30_000;
const executeContext: ExecuteContext = {
  input: { kind: 'stdin', format: 'pptx', display: 'standalone-slide-fixture' },
};

interface Observation {
  output: string | undefined;
  text: string | null;
  localImageWidth: number;
  externalScriptRan: boolean;
  entranceOpacity: string | undefined;
  entranceTransform: string | undefined;
  entranceTransformIsIdentity: boolean | undefined;
  entranceAnimation: string | undefined;
  shapeOpacity: string | undefined;
  shapeTransform: string | undefined;
  shapeRotation: number | undefined;
  shapePending: boolean | undefined;
}

interface BrowserStats {
  contextsCreated: number;
  contextsClosed: number;
  openPages: number;
  peakPages: number;
  navigations: string[];
  captures: Observation[];
  failureInjected: boolean;
}

/** Keep genuine Playwright contexts/pages; only observe calls and inject a one-shot I/O failure. */
function trackBrowser(
  localBrowser: LocalBrowser,
  missingSlide: string,
  failure?: 'navigation' | 'screenshot'
): { browser: LocalBrowser; stats: BrowserStats } {
  const stats: BrowserStats = {
    contextsCreated: 0,
    contextsClosed: 0,
    openPages: 0,
    peakPages: 0,
    navigations: [],
    captures: [],
    failureInjected: false,
  };

  const observe = async (page: Page, output: string | undefined): Promise<void> => {
    const observation = await page.evaluate(() => {
      const image = document.querySelector<HTMLImageElement>('#local-image');
      const entrance = document.querySelector<HTMLElement>('#entrance');
      const entranceStyle = entrance ? getComputedStyle(entrance) : undefined;
      const shape = document.querySelector<HTMLElement>('#pending-shape');
      const shapeStyle = shape ? getComputedStyle(shape) : undefined;
      const shapeMatrix = shapeStyle ? new DOMMatrixReadOnly(shapeStyle.transform) : undefined;
      return {
        text: document.querySelector('h1')?.textContent ?? null,
        localImageWidth: image?.complete ? image.naturalWidth : 0,
        externalScriptRan: document.documentElement.hasAttribute('data-external-script-ran'),
        entranceOpacity: entranceStyle?.opacity,
        entranceTransform: entranceStyle?.transform,
        entranceTransformIsIdentity: entranceStyle
          ? new DOMMatrixReadOnly(entranceStyle.transform).isIdentity
          : undefined,
        entranceAnimation: entranceStyle?.animationName,
        shapeOpacity: shapeStyle?.opacity,
        shapeTransform: shape?.style.transform,
        shapeRotation: shapeMatrix ? (Math.atan2(shapeMatrix.b, shapeMatrix.a) * 180) / Math.PI : undefined,
        shapePending: shape?.classList.contains('anim-pending'),
      };
    });
    stats.captures.push({ output, ...observation });
  };

  const trackLocator = (locator: Locator, page: Page): Locator => {
    const screenshot = locator.screenshot.bind(locator);
    vi.spyOn(locator, 'screenshot').mockImplementation(async (options) => {
      await observe(page, options?.path);
      if (failure === 'screenshot' && !stats.failureInjected) {
        stats.failureInjected = true;
        // A real closed-target failure tests cleanup beyond a mocked rejection.
        await page.close();
      }
      return screenshot(options);
    });
    const first = locator.first.bind(locator);
    const last = locator.last.bind(locator);
    const nth = locator.nth.bind(locator);
    vi.spyOn(locator, 'first').mockImplementation(() => trackLocator(first(), page));
    vi.spyOn(locator, 'last').mockImplementation(() => trackLocator(last(), page));
    vi.spyOn(locator, 'nth').mockImplementation((index) => trackLocator(nth(index), page));
    return locator;
  };

  return {
    stats,
    browser: {
      browser: localBrowser.browser,
      newContext: async (options) => {
        const context = await localBrowser.newContext(options);
        stats.contextsCreated += 1;
        context.on('close', () => {
          stats.contextsClosed += 1;
        });
        context.on('page', (page) => {
          stats.openPages += 1;
          stats.peakPages = Math.max(stats.peakPages, stats.openPages);
          page.on('close', () => {
            stats.openPages -= 1;
          });
        });
        const newPage = context.newPage.bind(context);
        vi.spyOn(context, 'newPage').mockImplementation(async () => {
          const page = await newPage();
          const goto = page.goto.bind(page);
          vi.spyOn(page, 'goto').mockImplementation(async (url, navigationOptions) => {
            stats.navigations.push(url);
            if (failure === 'navigation' && !stats.failureInjected) {
              stats.failureInjected = true;
              return goto(pathToFileURL(missingSlide).href, navigationOptions);
            }
            return goto(url, navigationOptions);
          });
          const locator = page.locator.bind(page);
          vi.spyOn(page, 'locator').mockImplementation((selector, locatorOptions) =>
            trackLocator(locator(selector, locatorOptions), page)
          );
          const pdf = page.pdf.bind(page);
          vi.spyOn(page, 'pdf').mockImplementation(async (pdfOptions) => {
            await observe(page, pdfOptions?.path);
            return pdf(pdfOptions);
          });
          return page;
        });
        return context;
      },
    },
  };
}

function expectClosed(stats: BrowserStats, browser: LocalBrowser): void {
  expect(stats.contextsCreated).toBeGreaterThan(0);
  expect(stats.contextsClosed).toBe(stats.contextsCreated);
  expect(stats.openPages).toBe(0);
  expect(stats.peakPages).toBeLessThanOrEqual(4);
  expect(browser.browser.contexts()).toHaveLength(0);
}

function expectReady(observation: Observation | undefined, page: number): void {
  expect(observation).toMatchObject({
    text: `Page ${page}`,
    localImageWidth: 24,
    externalScriptRan: false,
    entranceOpacity: '1',
    // Finished transform animations may serialize `none` as an identity matrix.
    entranceTransformIsIdentity: true,
    entranceAnimation: 'none',
    shapeOpacity: '0.6',
    shapeTransform: 'rotate(5deg)',
    shapePending: false,
  });
  expect(observation?.shapeRotation).toBeCloseTo(5, 3);
}

describeLocal('standalone office2html slides', () => {
  let workDirectory: string | undefined;
  let browser: LocalBrowser | undefined;
  let server: http.Server | undefined;
  let deck: ConvertedDeck;
  let externalRequests = 0;

  beforeAll(async () => {
    workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-lazy-slides-'));
    server = http.createServer((request, response) => {
      externalRequests += 1;
      if (request.url?.endsWith('.js')) {
        response.writeHead(200, { 'content-type': 'application/javascript' });
        response.end('document.documentElement.setAttribute("data-external-script-ran", "yes");');
      } else {
        response.writeHead(200, { 'content-type': 'image/svg+xml' });
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>');
      }
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing local HTTP server port.');
    const externalOrigin = `http://127.0.0.1:${address.port}`;
    const directory = path.join(workDirectory, 'deck');
    await fs.mkdir(path.join(directory, 'slides'), { recursive: true });
    await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
    await fs.writeFile(
      path.join(directory, 'assets', 'local.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#26a269"/></svg>'
    );
    const slides = Array.from({ length: 12 }, (_, index) => ({
      page: index + 1,
      path: path.join(directory, 'slides', `${String(index).padStart(4, '0')}.html`),
    }));
    for (const slide of slides) {
      await fs.writeFile(
        slide.path,
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=640, initial-scale=1">
        <style>
          html,body{margin:0;padding:0}
          .slide-canvas{position:relative;width:640px;height:360px;overflow:hidden;background:hsl(${slide.page * 27} 60% 80%);font-family:sans-serif}
          h1{margin:0;padding:36px;font-size:48px}p{margin:0 36px}img{position:absolute;left:36px;bottom:36px}
          @keyframes enter{from{opacity:0;transform:translateX(-64px)}to{opacity:1;transform:none}}
          #entrance{position:absolute;top:180px;left:36px;opacity:0;transform:translateX(-64px);animation:enter 60s linear forwards}
          #pending-shape{position:absolute;top:240px;left:36px}
          .anim-pending{opacity:0!important;transform:translateX(-80px)!important}
        </style>
        <section class="slide-canvas"><h1>Page ${slide.page}</h1><p>本地渲染</p>
          <div id="entrance">Animated entrance</div>
          <div id="pending-shape" class="anim-pending" data-shape-id="shape-1" data-base-opacity="0.6" data-base-transform="rotate(5deg)" style="opacity:0;transform:translateX(-80px)">Original shape styling</div>
          <img id="local-image" src="../assets/local.svg" width="24" height="24">
          <img src="${externalOrigin}/remote.svg" width="24" height="24" style="left:80px">
        </section><script src="${externalOrigin}/remote.js"></script>`
      );
    }
    const indexPath = path.join(directory, 'index.html');
    // The lazy shell deliberately has neither slide DOM nor size information.
    await fs.writeFile(
      indexPath,
      `<!doctype html><script id="slide-meta" type="application/json">${JSON.stringify(
        slides.map((slide) => ({
          index: slide.page - 1,
          src: `slides/${path.basename(slide.path)}`,
        }))
      )}</script>`
    );
    deck = { kind: 'deck', directory, indexPath, totalPages: slides.length, slides };
    browser = await launchLocalBrowser();
  }, TEST_TIMEOUT);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      await browser?.browser.close();
    } finally {
      try {
        if (server?.listening) {
          await new Promise<void>((resolve, reject) => {
            server!.close((error) => (error ? reject(error) : resolve()));
          });
        }
      } finally {
        if (workDirectory) await fs.rm(workDirectory, { recursive: true, force: true });
      }
    }
  }, TEST_TIMEOUT);

  it(
    'captures selected JPEG pages in numeric order, loading only local slide assets',
    async () => {
      const tracked = trackBrowser(browser!, path.join(workDirectory!, 'missing.html'));
      const selected = [2, 10, 12];
      const artifacts = await captureDeckImages(
        deck,
        { imageFormat: 'jpg', width: 800, jpegQuality: 90 },
        selected,
        {
          browser: tracked.browser,
          outputDirectory: path.join(workDirectory!, 'jpeg'),
          timeoutMs: CAPTURE_TIMEOUT,
        },
        executeContext
      );

      expect(artifacts.map((artifact) => artifact.page)).toEqual(selected);
      for (const artifact of artifacts) {
        const bytes = await fs.readFile(artifact.source);
        expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
        expect(imageDimensions(bytes)).toEqual({ width: 800, height: 450 });
        expect(artifact).toMatchObject({ ext: '.jpg', width: 800, height: 450 });
        expectReady(
          tracked.stats.captures.find((capture) => capture.output === artifact.source),
          artifact.page
        );
      }
      expect(tracked.stats.navigations.sort()).toEqual(
        deck
          .slides!.filter((slide) => selected.includes(slide.page))
          .map((slide) => pathToFileURL(slide.path).href)
          .sort()
      );
      expect(externalRequests).toBe(0);
      expectClosed(tracked.stats, browser!);
    },
    TEST_TIMEOUT
  );

  it(
    'prints and merges all twelve standalone pages without loading the lazy shell',
    async () => {
      const tracked = trackBrowser(browser!, path.join(workDirectory!, 'missing.html'));
      const pages = await printDeckPages(
        deck,
        {
          browser: tracked.browser,
          outputDirectory: path.join(workDirectory!, 'printed'),
          timeoutMs: CAPTURE_TIMEOUT,
        },
        executeContext
      );
      expect(pages.map((page) => page.page)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
      for (const page of pages) {
        expectReady(
          tracked.stats.captures.find((capture) => capture.output === page.path),
          page.page
        );
      }
      const merged = await mergePdfPages(pages, path.join(workDirectory!, 'merged'), executeContext);
      const document = await PDFDocument.load(await fs.readFile(merged.source));
      expect(document.getPageCount()).toBe(12);
      for (const page of document.getPages()) {
        // Chromium converts CSS pixels to PDF points at 96px / 72pt.
        expect(page.getWidth()).toBeCloseTo(480, 0);
        expect(page.getHeight()).toBeCloseTo(270, 0);
      }
      expect(tracked.stats.navigations.sort()).toEqual(
        deck.slides!.map((slide) => pathToFileURL(slide.path).href).sort()
      );
      expect(externalRequests).toBe(0);
      expectClosed(tracked.stats, browser!);
    },
    TEST_TIMEOUT
  );

  it.each(['navigation', 'screenshot'] as const)(
    'closes every context after a %s failure and allows a subsequent render',
    async (failure) => {
      const tracked = trackBrowser(browser!, path.join(workDirectory!, 'missing.html'), failure);
      await expect(
        captureDeckImages(
          deck,
          { imageFormat: 'png' },
          [1, 2, 3, 4, 5],
          {
            browser: tracked.browser,
            outputDirectory: path.join(workDirectory!, `failed-${failure}`),
            timeoutMs: CAPTURE_TIMEOUT,
          },
          executeContext
        )
      ).rejects.toThrow();
      expect(tracked.stats.failureInjected).toBe(true);
      expectClosed(tracked.stats, browser!);

      const outputs = await captureDeckImages(
        deck,
        { imageFormat: 'png' },
        [12],
        {
          browser: tracked.browser,
          outputDirectory: path.join(workDirectory!, `recovered-${failure}`),
          timeoutMs: CAPTURE_TIMEOUT,
        },
        executeContext
      );
      expect(outputs).toEqual([expect.objectContaining({ page: 12, width: 640, height: 360 })]);
      expectClosed(tracked.stats, browser!);
      expect(externalRequests).toBe(0);
    },
    TEST_TIMEOUT
  );
});

import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { DeckRenderError } from '../../errors/index.js';
import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright-core';

export const CHROMIUM_PATH_ENV = 'DECKRENDER_CHROMIUM_EXECUTABLE_PATH';

export interface LocalBrowser {
  browser: Browser;
  newContext(options?: BrowserContextOptions): Promise<BrowserContext>;
}

export async function launchLocalBrowser(explicitPath?: string): Promise<LocalBrowser> {
  let playwright: typeof import('playwright-core');
  try {
    playwright = await import('playwright-core');
  } catch (error) {
    throw DeckRenderError.render('playwright-core is required by the local engine.', {
      hint: 'Reinstall DeckRender without --omit=optional, or install playwright-core@1.55.1.',
      cause: error,
    });
  }

  const executablePath = await resolveChromiumExecutable(playwright.chromium, explicitPath);
  try {
    const browser = await playwright.chromium.launch({
      executablePath,
      headless: true,
      args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
    });
    return {
      browser,
      newContext: (options) => browser.newContext(options),
    };
  } catch (error) {
    throw DeckRenderError.render(`Could not launch Chromium at ${executablePath}.`, {
      hint: `Set $${CHROMIUM_PATH_ENV} or pass --executable-path with a compatible Chrome/Chromium executable.`,
      cause: error,
    });
  }
}

async function resolveChromiumExecutable(
  chromium: (typeof import('playwright-core'))['chromium'],
  explicitPath?: string
): Promise<string> {
  const configured = explicitPath ?? process.env[CHROMIUM_PATH_ENV];
  if (configured) {
    const absolute = path.resolve(configured);
    if (await isExecutable(absolute)) {
      return absolute;
    }
    throw DeckRenderError.render(`Chromium executable is missing or not executable: ${configured}`, {
      hint: `Check --executable-path or $${CHROMIUM_PATH_ENV}.`,
    });
  }

  // playwright-core knows the cache location but does not download a browser.
  // Only use its path if another Playwright installation populated it.
  const playwrightPath = chromium.executablePath();
  if (await isExecutable(playwrightPath)) {
    return playwrightPath;
  }

  for (const candidate of systemBrowserCandidates()) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  for (const name of pathBrowserNames()) {
    const candidate = await findOnPath(name);
    if (candidate) {
      return candidate;
    }
  }

  throw DeckRenderError.render('No compatible Chromium or Chrome executable was found.', {
    hint:
      `Install Chrome/Chromium, then set $${CHROMIUM_PATH_ENV}. ` +
      'playwright-core intentionally does not download a browser.',
  });
}

function systemBrowserCandidates(): string[] {
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  if (process.platform === 'win32') {
    const roots = [
      process.env.PROGRAMFILES,
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
    ].filter((value): value is string => Boolean(value));
    return roots.flatMap((root) => [
      path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(root, 'Chromium', 'Application', 'chrome.exe'),
      path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
}

function pathBrowserNames(): string[] {
  return process.platform === 'win32'
    ? ['chrome.exe', 'chromium.exe', 'msedge.exe']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform !== 'win32') {
      await fs.access(candidate, fsConstants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

async function findOnPath(name: string): Promise<string | undefined> {
  for (const entry of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(entry, name);
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

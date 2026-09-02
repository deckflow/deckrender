import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DeckRenderError } from '../../errors/index.js';

export const OFFICE2HTML_PATH_ENV = 'DECKRENDER_OFFICE2HTML_PATH';

const OFFICE2HTML_PACKAGE = '@deckflow/office2html';

interface Office2htmlPackage {
  getBinaryPath?: () => unknown;
}

export async function resolveOffice2htmlBinary(explicitPath?: string): Promise<string> {
  const configured = explicitPath ?? (process.env[OFFICE2HTML_PATH_ENV] || undefined);
  if (configured !== undefined) {
    return requireExecutable(configured, 'office2html');
  }

  const packaged = await resolvePackagedBinary();
  if (packaged) {
    return packaged;
  }

  const fromPath = await findOnPath(process.platform === 'win32' ? 'office2html.exe' : 'office2html');
  if (fromPath) {
    return fromPath;
  }

  const configureHint =
    `Set ${OFFICE2HTML_PATH_ENV} or run ` +
    '`deckrender config set office2html-path /absolute/path/to/office2html` ' +
    'to use a custom executable, or add office2html to PATH.';
  throw DeckRenderError.render('office2html is required for local PPTX rendering but was not found.', {
    hint:
      `Install ${OFFICE2HTML_PACKAGE} with optional dependencies enabled, or reinstall deckrender ` +
      'with optional dependencies ' +
      'enabled (`npm install --include=optional @deckflow/deckrender`; for a global CLI, ' +
      '`npm install -g --include=optional @deckflow/deckrender`). ' +
      configureHint,
  });
}

async function resolvePackagedBinary(): Promise<string | undefined> {
  const packageRequire = createRequire(import.meta.url);
  let runtime: Office2htmlPackage;
  try {
    runtime = packageRequire(OFFICE2HTML_PACKAGE) as Office2htmlPackage;
  } catch {
    return undefined;
  }

  if (typeof runtime?.getBinaryPath !== 'function') {
    return undefined;
  }

  let candidate: unknown;
  try {
    candidate = runtime.getBinaryPath();
  } catch {
    return undefined;
  }

  if (typeof candidate !== 'string' || !candidate) {
    return undefined;
  }
  const absolute = path.resolve(candidate);
  return (await isExecutable(absolute)) ? absolute : undefined;
}

async function requireExecutable(candidate: string, label: string): Promise<string> {
  const absolute = path.resolve(candidate);
  if (await isExecutable(absolute)) {
    return absolute;
  }
  throw DeckRenderError.render(`${label} executable is missing or not executable: ${candidate}`, {
    hint: `Check the configured path and file permissions.`,
  });
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
  const entries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const entry of entries) {
    const directory = process.platform === 'win32' ? entry.replace(/^"(.*)"$/, '$1') : entry;
    if (!directory) continue;
    const candidate = path.resolve(directory, name);
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

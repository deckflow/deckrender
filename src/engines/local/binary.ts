import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DeckRenderError } from '../../errors/index.js';

export const OFFICE2HTML_PATH_ENV = 'DECKRENDER_OFFICE2HTML_PATH';

interface PlatformBinary {
  packageName: string;
  executableName: string;
}

const PLATFORM_BINARIES: Record<string, PlatformBinary> = {
  'darwin-arm64': {
    packageName: '@deckflow/office2html-darwin-arm64',
    executableName: 'office2html',
  },
  'darwin-x64': {
    packageName: '@deckflow/office2html-darwin-x64',
    executableName: 'office2html',
  },
  'linux-x64': {
    packageName: '@deckflow/office2html-linux-x64',
    executableName: 'office2html',
  },
  'win32-x64': {
    packageName: '@deckflow/office2html-win32-x64',
    executableName: 'office2html.exe',
  },
};

export async function resolveOffice2htmlBinary(explicitPath?: string): Promise<string> {
  const platform = PLATFORM_BINARIES[`${process.platform}-${process.arch}`];
  if (!platform) {
    throw DeckRenderError.render(
      `The local PPTX engine is not available on ${process.platform}-${process.arch}.`,
      { hint: 'Supported platforms: macOS arm64/x64, Linux x64, and Windows x64.' }
    );
  }

  const configured = explicitPath ?? process.env[OFFICE2HTML_PATH_ENV];
  if (configured) {
    return requireExecutable(configured, 'office2html');
  }

  const packaged = await resolvePackagedBinary(platform);
  if (packaged) {
    return packaged;
  }

  const fromPath = await findOnPath(platform.executableName);
  if (fromPath) {
    return fromPath;
  }

  throw DeckRenderError.render('office2html is required for local PPTX rendering but was not found.', {
    hint:
      `Install ${platform.packageName}, set $${OFFICE2HTML_PATH_ENV}, ` +
      'or run `deckrender config set office2html-path /absolute/path/to/office2html`.',
  });
}

async function resolvePackagedBinary(platform: PlatformBinary): Promise<string | undefined> {
  const require = createRequire(import.meta.url);
  let manifestPath: string;
  try {
    manifestPath = require.resolve(`${platform.packageName}/package.json`);
  } catch {
    return undefined;
  }

  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const relative =
      typeof manifest.bin === 'string'
        ? manifest.bin
        : (manifest.bin?.office2html ?? `bin/${platform.executableName}`);
    const candidate = path.resolve(path.dirname(manifestPath), relative);
    return (await isExecutable(candidate)) ? candidate : undefined;
  } catch {
    return undefined;
  }
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
    const candidate = path.join(entry, name);
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

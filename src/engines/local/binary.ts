import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DeckRenderError } from '../../errors/index.js';

export const OFFICE2HTML_PATH_ENV = 'DECKRENDER_OFFICE2HTML_PATH';
// Keep installation guidance aligned with the pinned optionalDependencies.
const OFFICE2HTML_PACKAGE_VERSION = '0.1.0';

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
  const configured = explicitPath ?? (process.env[OFFICE2HTML_PATH_ENV] || undefined);
  if (configured !== undefined) {
    return requireExecutable(configured, 'office2html');
  }

  const platformKey = `${process.platform}-${process.arch}`;
  const platform = PLATFORM_BINARIES[platformKey];
  if (platform) {
    const packaged = await resolvePackagedBinary(platform);
    if (packaged) {
      return packaged;
    }
  }

  const fromPath = await findOnPath(process.platform === 'win32' ? 'office2html.exe' : 'office2html');
  if (fromPath) {
    return fromPath;
  }

  const configureHint =
    `Set ${OFFICE2HTML_PATH_ENV} or run ` +
    '`deckrender config set office2html-path /absolute/path/to/office2html` ' +
    'to use a custom executable, or add office2html to PATH.';
  if (!platform) {
    throw DeckRenderError.render(`No prebuilt office2html package is available for ${platformKey}.`, {
      hint: 'Prebuilt platforms: macOS arm64/x64, Linux x64, and Windows x64. ' + configureHint,
    });
  }

  throw DeckRenderError.render('office2html is required for local PPTX rendering but was not found.', {
    hint:
      `Run \`npm install --omit=optional ${platform.packageName}@${OFFICE2HTML_PACKAGE_VERSION}\` ` +
      'in your project to add this platform only, or reinstall deckrender with optional dependencies ' +
      'enabled (`npm install --include=optional @deckflow/deckrender`; for a global CLI, ' +
      '`npm install -g --include=optional @deckflow/deckrender`). ' +
      configureHint,
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

  const packageDirectory = path.dirname(manifestPath);
  // Upstream platform packages contain a root executable and have no bin/main entry.
  const rootBinary = path.join(packageDirectory, platform.executableName);
  if (await isExecutable(rootBinary)) {
    return rootBinary;
  }

  try {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as {
      bin?: string | Record<string, string>;
    } | null;
    const relative = typeof manifest?.bin === 'string' ? manifest.bin : manifest?.bin?.office2html;
    if (typeof relative === 'string' && relative) {
      const candidate = path.resolve(packageDirectory, relative);
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  } catch {
    // A missing/malformed bin entry should not prevent checking the legacy layout.
  }

  const legacyBinary = path.join(packageDirectory, 'bin', platform.executableName);
  return (await isExecutable(legacyBinary)) ? legacyBinary : undefined;
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

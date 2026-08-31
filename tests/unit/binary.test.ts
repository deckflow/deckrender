import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFICE2HTML_PATH_ENV, resolveOffice2htmlBinary } from '../../src/engines/local/binary.js';
import packageManifest from '../../package.json';

const { resolveManifest, stat, access, readFile } = vi.hoisted(() => ({
  resolveManifest: vi.fn(),
  stat: vi.fn(),
  access: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('node:module', () => ({
  createRequire: () => ({ resolve: resolveManifest }),
}));

vi.mock('node:fs/promises', () => ({
  default: { stat, access, readFile },
}));

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const originalArch = Object.getOwnPropertyDescriptor(process, 'arch')!;
const packageDirectory = path.resolve('virtual-node-modules/office2html');
const manifestPath = path.join(packageDirectory, 'package.json');
const pathDirectory = path.resolve('virtual-path');
const executables = new Set<string>();
const nonExecutableFiles = new Set<string>();
const directories = new Set<string>();

function usePlatform(platform: NodeJS.Platform, arch: string): void {
  Object.defineProperty(process, 'platform', { value: platform });
  Object.defineProperty(process, 'arch', { value: arch });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv(OFFICE2HTML_PATH_ENV, '');
  delete process.env[OFFICE2HTML_PATH_ENV];
  vi.stubEnv('PATH', pathDirectory);
  usePlatform('linux', 'x64');
  executables.clear();
  nonExecutableFiles.clear();
  directories.clear();
  resolveManifest.mockImplementation(() => {
    throw new Error('MODULE_NOT_FOUND');
  });
  readFile.mockResolvedValue('{}');
  stat.mockImplementation(async (candidate: string) => {
    if (executables.has(candidate) || nonExecutableFiles.has(candidate)) {
      return { isFile: () => true };
    }
    if (directories.has(candidate)) {
      return { isFile: () => false };
    }
    throw new Error('ENOENT');
  });
  access.mockImplementation(async (candidate: string) => {
    if (!executables.has(candidate)) throw new Error('EACCES');
  });
});

afterEach(() => {
  Object.defineProperty(process, 'platform', originalPlatform);
  Object.defineProperty(process, 'arch', originalArch);
  vi.unstubAllEnvs();
});

describe('office2html platform packages', () => {
  it.each([
    ['darwin', 'arm64', 'office2html'],
    ['darwin', 'x64', 'office2html'],
    ['linux', 'x64', 'office2html'],
    ['win32', 'x64', 'office2html.exe'],
  ] as const)('resolves the upstream root executable on %s-%s', async (platform, arch, name) => {
    usePlatform(platform, arch);
    resolveManifest.mockReturnValue(manifestPath);
    const executable = path.join(packageDirectory, name);
    executables.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
    expect(resolveManifest).toHaveBeenCalledTimes(1);
    expect(resolveManifest).toHaveBeenCalledWith(`@deckflow/office2html-${platform}-${arch}/package.json`);
    expect(readFile).not.toHaveBeenCalled();
    if (platform === 'win32') expect(access).not.toHaveBeenCalled();
    else expect(access).toHaveBeenCalledWith(executable, fsConstants.X_OK);
  });

  it('prefers the upstream root executable over a legacy manifest or PATH', async () => {
    resolveManifest.mockReturnValue(manifestPath);
    readFile.mockResolvedValue('{"bin":"custom/office2html"}');
    const root = path.join(packageDirectory, 'office2html');
    executables.add(root);
    executables.add(path.join(packageDirectory, 'custom/office2html'));
    executables.add(path.join(pathDirectory, 'office2html'));

    await expect(resolveOffice2htmlBinary()).resolves.toBe(root);
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each([{ bin: 'custom/office2html' }, { bin: { office2html: 'custom/office2html' } }])(
    'supports the legacy manifest bin field %j',
    async (manifest) => {
      resolveManifest.mockReturnValue(manifestPath);
      readFile.mockResolvedValue(JSON.stringify(manifest));
      const executable = path.join(packageDirectory, 'custom/office2html');
      executables.add(executable);

      await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
    }
  );

  it.each(['{}', '{"bin":"missing"}', '{"bin":{"office2html":3}}', 'null', '{'])(
    'supports the legacy bin directory with manifest %s',
    async (manifest) => {
      resolveManifest.mockReturnValue(manifestPath);
      readFile.mockResolvedValue(manifest);
      const executable = path.join(packageDirectory, 'bin/office2html');
      executables.add(executable);

      await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
    }
  );

  it('uses the Windows executable suffix in the legacy bin directory', async () => {
    usePlatform('win32', 'x64');
    resolveManifest.mockReturnValue(manifestPath);
    const executable = path.join(packageDirectory, 'bin/office2html.exe');
    executables.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
  });

  it('falls back to PATH when the optional package is absent', async () => {
    const executable = path.join(pathDirectory, 'office2html');
    executables.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
  });

  it('falls back to PATH when the package binary is missing or lacks execute permission', async () => {
    resolveManifest.mockReturnValue(manifestPath);
    nonExecutableFiles.add(path.join(packageDirectory, 'office2html'));
    const executable = path.join(pathDirectory, 'office2html');
    executables.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
  });

  it.each([
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'x64'],
    ['win32', 'x64'],
  ] as const)('gives platform-specific installation guidance on %s-%s', async (platform, arch) => {
    usePlatform(platform, arch);
    const packageName =
      `@deckflow/office2html-${platform}-${arch}` as keyof typeof packageManifest.optionalDependencies;
    const version = packageManifest.optionalDependencies[packageName];

    await expect(resolveOffice2htmlBinary()).rejects.toMatchObject({
      code: 'render_error',
      message: expect.stringContaining('office2html is required for local PPTX rendering'),
      hint: expect.stringContaining(`npm install --omit=optional ${packageName}@${version}`),
    });
    await expect(resolveOffice2htmlBinary()).rejects.toMatchObject({
      hint: expect.stringContaining('npm install --include=optional'),
    });
  });
});

describe('office2html custom executables', () => {
  it('prefers an explicit path over the environment, packages, and PATH', async () => {
    const explicit = path.resolve('custom/explicit-office2html');
    const environment = path.resolve('custom/env-office2html');
    vi.stubEnv(OFFICE2HTML_PATH_ENV, environment);
    executables.add(explicit);
    executables.add(environment);
    executables.add(path.join(pathDirectory, 'office2html'));

    await expect(resolveOffice2htmlBinary(explicit)).resolves.toBe(explicit);
    expect(resolveManifest).not.toHaveBeenCalled();
    expect(stat).toHaveBeenCalledTimes(1);
    expect(stat).toHaveBeenCalledWith(explicit);
  });

  it('uses the environment override before packages or PATH', async () => {
    const executable = path.resolve('custom/env-office2html');
    vi.stubEnv(OFFICE2HTML_PATH_ENV, executable);
    executables.add(executable);
    executables.add(path.join(pathDirectory, 'office2html'));

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
    expect(resolveManifest).not.toHaveBeenCalled();
  });

  it('resolves a relative explicit path to an absolute path', async () => {
    const relative = 'custom/office2html';
    executables.add(path.resolve(relative));

    await expect(resolveOffice2htmlBinary(relative)).resolves.toBe(path.resolve(relative));
  });

  it.each(['missing', 'directory', 'non-executable', 'empty'])(
    'rejects a %s explicit override instead of silently falling back',
    async (kind) => {
      const configured = kind === 'empty' ? '' : path.resolve(`custom/${kind}`);
      if (kind === 'directory' || kind === 'empty') directories.add(path.resolve(configured));
      if (kind === 'non-executable') nonExecutableFiles.add(configured);
      executables.add(path.join(pathDirectory, 'office2html'));
      vi.stubEnv(OFFICE2HTML_PATH_ENV, path.join(pathDirectory, 'office2html'));

      await expect(resolveOffice2htmlBinary(configured)).rejects.toMatchObject({
        code: 'render_error',
        message: expect.stringContaining('executable is missing or not executable'),
      });
      expect(resolveManifest).not.toHaveBeenCalled();
    }
  );

  it('rejects an invalid environment override instead of silently falling back', async () => {
    vi.stubEnv(OFFICE2HTML_PATH_ENV, path.resolve('missing'));
    executables.add(path.join(pathDirectory, 'office2html'));

    await expect(resolveOffice2htmlBinary()).rejects.toMatchObject({ code: 'render_error' });
    expect(resolveManifest).not.toHaveBeenCalled();
  });

  it('ignores an empty environment variable', async () => {
    vi.stubEnv(OFFICE2HTML_PATH_ENV, '');
    const executable = path.join(pathDirectory, 'office2html');
    executables.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
  });

  it('accepts a Windows executable without a POSIX execute permission bit', async () => {
    usePlatform('win32', 'x64');
    const executable = path.resolve('custom/office2html.exe');
    nonExecutableFiles.add(executable);

    await expect(resolveOffice2htmlBinary(executable)).resolves.toBe(executable);
    expect(access).not.toHaveBeenCalled();
  });

  it.each(['explicit', 'environment', 'PATH'])(
    'allows a custom binary via %s on an architecture without a prebuilt package',
    async (source) => {
      usePlatform('linux', 'arm64');
      const executable = path.join(pathDirectory, 'office2html');
      executables.add(executable);
      if (source === 'environment') vi.stubEnv(OFFICE2HTML_PATH_ENV, executable);

      await expect(resolveOffice2htmlBinary(source === 'explicit' ? executable : undefined)).resolves.toBe(
        executable
      );
      expect(resolveManifest).not.toHaveBeenCalled();
    }
  );

  it('uses an .exe PATH fallback even on an unsupported Windows architecture', async () => {
    usePlatform('win32', 'arm64');
    const executable = path.join(pathDirectory, 'office2html.exe');
    executables.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
    expect(resolveManifest).not.toHaveBeenCalled();
  });

  it('explains the custom binary option when the platform has no prebuilt package', async () => {
    usePlatform('linux', 'arm64');

    await expect(resolveOffice2htmlBinary()).rejects.toMatchObject({
      code: 'render_error',
      message: 'No prebuilt office2html package is available for linux-arm64.',
      hint: expect.stringContaining(OFFICE2HTML_PATH_ENV),
    });
    expect(resolveManifest).not.toHaveBeenCalled();
  });

  it('walks PATH in order, skipping directories and non-executable files', async () => {
    const firstDirectory = path.resolve('first-path');
    const secondDirectory = path.resolve('second-path');
    const lastDirectory = path.resolve('last-path');
    vi.stubEnv('PATH', [firstDirectory, secondDirectory, lastDirectory].join(path.delimiter));
    directories.add(path.join(firstDirectory, 'office2html'));
    nonExecutableFiles.add(path.join(secondDirectory, 'office2html'));
    const executable = path.join(lastDirectory, 'office2html');
    executables.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
  });

  it('returns absolute paths for relative PATH entries', async () => {
    vi.stubEnv('PATH', 'custom');
    const executable = path.resolve('custom/office2html');
    executables.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
  });

  it('handles quoted Windows PATH entries containing spaces', async () => {
    usePlatform('win32', 'x64');
    const directory = path.resolve('Program Files/office2html');
    vi.stubEnv('PATH', `"${directory}"`);
    const executable = path.join(directory, 'office2html.exe');
    executables.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
  });

  it('skips empty quoted Windows PATH entries', async () => {
    usePlatform('win32', 'x64');
    vi.stubEnv('PATH', `""${path.delimiter}"${pathDirectory}"`);
    executables.add(path.resolve('office2html.exe'));
    const executable = path.join(pathDirectory, 'office2html.exe');
    executables.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
  });

  it('does not search the current directory when PATH is absent', async () => {
    delete process.env.PATH;
    executables.add(path.resolve('office2html'));

    await expect(resolveOffice2htmlBinary()).rejects.toMatchObject({ code: 'render_error' });
    expect(stat).not.toHaveBeenCalled();
  });
});

import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFICE2HTML_PATH_ENV, resolveOffice2htmlBinary } from '../../src/engines/local/binary.js';

const { packageRequire, stat, access } = vi.hoisted(() => ({
  packageRequire: vi.fn(),
  stat: vi.fn(),
  access: vi.fn(),
}));

vi.mock('node:module', () => ({
  createRequire: () => packageRequire,
}));

vi.mock('node:fs/promises', () => ({
  default: { stat, access },
}));

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const originalArch = Object.getOwnPropertyDescriptor(process, 'arch')!;
const packageDirectory = path.resolve('virtual-node-modules/office2html');
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
  packageRequire.mockImplementation(() => {
    throw new Error('MODULE_NOT_FOUND');
  });
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

describe('@deckflow/office2html package', () => {
  it('resolves the binary through the package public API', async () => {
    const executable = path.join(packageDirectory, 'office2html');
    packageRequire.mockReturnValue({ getBinaryPath: () => executable });
    executables.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
    expect(packageRequire).toHaveBeenCalledOnce();
    expect(packageRequire).toHaveBeenCalledWith('@deckflow/office2html');
    expect(access).toHaveBeenCalledWith(executable, fsConstants.X_OK);
  });

  it('accepts the package binary on Windows without a POSIX execute permission bit', async () => {
    usePlatform('win32', 'x64');
    const executable = path.join(packageDirectory, 'office2html.exe');
    packageRequire.mockReturnValue({ getBinaryPath: () => executable });
    nonExecutableFiles.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
    expect(access).not.toHaveBeenCalled();
  });

  it('falls back to PATH when the optional package is absent', async () => {
    const executable = path.join(pathDirectory, 'office2html');
    executables.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
  });

  it.each(['missing API', 'throwing API', 'missing binary', 'non-executable binary'])(
    'falls back to PATH for a package with a %s',
    async (kind) => {
      const packaged = path.join(packageDirectory, 'office2html');
      if (kind === 'missing API') packageRequire.mockReturnValue({});
      if (kind === 'throwing API') {
        packageRequire.mockReturnValue({
          getBinaryPath: () => {
            throw new Error('unsupported platform');
          },
        });
      }
      if (kind === 'missing binary') {
        packageRequire.mockReturnValue({ getBinaryPath: () => packaged });
      }
      if (kind === 'non-executable binary') {
        packageRequire.mockReturnValue({ getBinaryPath: () => packaged });
        nonExecutableFiles.add(packaged);
      }
      const executable = path.join(pathDirectory, 'office2html');
      executables.add(executable);

      await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
    }
  );

  it('falls back to PATH when the package returns an invalid binary path', async () => {
    packageRequire.mockReturnValue({ getBinaryPath: () => undefined });
    const executable = path.join(pathDirectory, 'office2html');
    executables.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
  });

  it('gives entry-package installation guidance when no binary is available', async () => {
    await expect(resolveOffice2htmlBinary()).rejects.toMatchObject({
      code: 'render_error',
      message: expect.stringContaining('office2html is required for local PPTX rendering'),
      hint: expect.stringContaining('@deckflow/office2html'),
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
    expect(packageRequire).not.toHaveBeenCalled();
    expect(stat).toHaveBeenCalledTimes(1);
    expect(stat).toHaveBeenCalledWith(explicit);
  });

  it('uses the environment override before packages or PATH', async () => {
    const executable = path.resolve('custom/env-office2html');
    vi.stubEnv(OFFICE2HTML_PATH_ENV, executable);
    executables.add(executable);
    executables.add(path.join(pathDirectory, 'office2html'));

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
    expect(packageRequire).not.toHaveBeenCalled();
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
      expect(packageRequire).not.toHaveBeenCalled();
    }
  );

  it('rejects an invalid environment override instead of silently falling back', async () => {
    vi.stubEnv(OFFICE2HTML_PATH_ENV, path.resolve('missing'));
    executables.add(path.join(pathDirectory, 'office2html'));

    await expect(resolveOffice2htmlBinary()).rejects.toMatchObject({ code: 'render_error' });
    expect(packageRequire).not.toHaveBeenCalled();
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
    'allows a custom binary via %s when the entry package has no runtime',
    async (source) => {
      usePlatform('linux', 'arm64');
      const executable = path.join(pathDirectory, 'office2html');
      executables.add(executable);
      if (source === 'environment') vi.stubEnv(OFFICE2HTML_PATH_ENV, executable);

      await expect(resolveOffice2htmlBinary(source === 'explicit' ? executable : undefined)).resolves.toBe(
        executable
      );
      if (source === 'PATH') expect(packageRequire).toHaveBeenCalledOnce();
      else expect(packageRequire).not.toHaveBeenCalled();
    }
  );

  it('uses an .exe PATH fallback even on an unsupported Windows architecture', async () => {
    usePlatform('win32', 'arm64');
    const executable = path.join(pathDirectory, 'office2html.exe');
    executables.add(executable);

    await expect(resolveOffice2htmlBinary()).resolves.toBe(executable);
    expect(packageRequire).toHaveBeenCalledOnce();
  });

  it('explains the custom binary option when the entry package has no runtime', async () => {
    usePlatform('linux', 'arm64');

    await expect(resolveOffice2htmlBinary()).rejects.toMatchObject({
      code: 'render_error',
      message: 'office2html is required for local PPTX rendering but was not found.',
      hint: expect.stringContaining(OFFICE2HTML_PATH_ENV),
    });
    expect(packageRequire).toHaveBeenCalledOnce();
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

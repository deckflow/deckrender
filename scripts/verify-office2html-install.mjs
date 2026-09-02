#!/usr/bin/env node
/**
 * Verify the published @deckflow/office2html wrapper contract and DeckRender's
 * npm/pnpm install behavior. Platform selection belongs to the wrapper package.
 * Requires npm, pnpm, tar, and an existing dist/ build.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants as fsConstants, createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readOffice2htmlPackage, verifyOffice2htmlManifest } from './office2html-packages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const upstreamRegistry = 'https://registry.npmjs.org/';
const { target } = await readOffice2htmlPackage(root);
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-packaging-'));

try {
  const mainPnpm = await packMain('pnpm');
  const mainNpm = await packMain('npm');
  console.log(
    `Verified npm and pnpm DeckRender tarballs: only ${target.name} is declared for office2html.`
  );

  await verifyWrapperTarball();

  for (const scenario of [
    { name: 'npm-native', manager: 'npm', main: mainNpm, omit: false },
    { name: 'npm-cloud-only', manager: 'npm', main: mainNpm, omit: true },
    { name: 'pnpm-native', manager: 'pnpm', main: mainPnpm, omit: false },
    { name: 'pnpm-cloud-only', manager: 'pnpm', main: mainPnpm, omit: true },
  ]) {
    await verifyInstall(scenario);
  }
} finally {
  if (process.env.KEEP_PACKAGING_ARTIFACTS === '1') {
    console.log(`Packaging artifacts retained at ${temporaryRoot}`);
  } else {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function verifyWrapperTarball() {
  const destination = path.join(temporaryRoot, 'upstream-wrapper');
  await fs.mkdir(destination);
  const spec = `${target.name}@${target.version}`;
  const metadata = JSON.parse(
    await run('npm', ['view', spec, 'dist', '--json', `--registry=${upstreamRegistry}`])
  );
  assert.equal(metadata.integrity, target.integrity, `Registry integrity drift for ${spec}.`);

  const packed = await readPacked(
    await run('npm', [
      'pack',
      spec,
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      destination,
      `--registry=${upstreamRegistry}`,
    ]),
    destination
  );
  assert.equal(
    `sha512-${await digest(packed.filename, 'sha512', 'base64')}`,
    target.integrity,
    `Tarball integrity mismatch for ${spec}.`
  );
  const { cli, platformPackages } = verifyOffice2htmlManifest(packed.manifest, target);
  for (const file of [packed.manifest.main, cli]) {
    assert(
      packed.files.some((entry) => entry.path === file),
      `${spec} tarball is missing its public entry: ${file}.`
    );
  }
  console.log(
    `Verified ${spec}: public API/CLI, SHA-512 integrity, and ${platformPackages.length} wrapper-managed runtimes.`
  );
}

async function verifyInstall({ name, manager, main, omit }) {
  const installRoot = path.join(temporaryRoot, name);
  await fs.mkdir(installRoot);
  await fs.writeFile(
    path.join(installRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'deckrender-install-test',
        version: '0.0.0',
        private: true,
        dependencies: { '@deckflow/deckrender': `file:${main.filename}` },
      },
      null,
      2
    )}\n`
  );

  await run(
    manager,
    [
      'install',
      '--ignore-scripts',
      `--registry=${upstreamRegistry}`,
      ...(manager === 'npm'
        ? [
            '--no-audit',
            '--no-fund',
            `--cache=${path.join(installRoot, 'cache')}`,
            ...(omit ? ['--omit=optional'] : []),
          ]
        : [
            '--reporter=append-only',
            `--store-dir=${path.join(installRoot, 'store')}`,
            ...(omit ? ['--no-optional'] : []),
          ]),
    ],
    installRoot
  );

  const consumerRequire = createRequire(path.join(installRoot, 'package.json'));
  const deckrenderManifest = consumerRequire.resolve('@deckflow/deckrender/package.json');
  const deckrenderRequire = createRequire(deckrenderManifest);
  if (omit) {
    assert.throws(
      () => deckrenderRequire.resolve(target.name),
      (error) => error?.code === 'MODULE_NOT_FOUND',
      `${target.name} must be absent from ${name}.`
    );
    console.log(`${name}: ${target.name} omitted.`);
    return;
  }

  const runtime = deckrenderRequire(target.name);
  assert.equal(typeof runtime.getBinaryPath, 'function', `${target.name} must export getBinaryPath().`);
  const binaryPath = runtime.getBinaryPath();
  const stat = await fs.stat(binaryPath);
  assert(stat.isFile() && stat.size > 0, `${name} installed no native office2html executable.`);
  if (process.platform !== 'win32') await fs.access(binaryPath, fsConstants.X_OK);
  console.log(`${name}: ${target.name} resolved ${binaryPath}.`);
}

async function packMain(manager) {
  const destination = path.join(temporaryRoot, `main-${manager}`);
  await fs.mkdir(destination);
  const packed = await readPacked(
    await run(manager, [
      'pack',
      '--json',
      manager === 'pnpm' ? '--config.ignore-scripts=true' : '--ignore-scripts',
      '--pack-destination',
      destination,
    ]),
    destination
  );
  for (const file of ['dist/index.js', 'dist/cli.js', 'dist/browser/index.js', 'dist/browser/index.d.ts']) {
    assert(
      packed.files.some((entry) => entry.path === file),
      `Missing ${file}; run pnpm build first.`
    );
  }
  assert(
    packed.files.every(
      ({ path: file }) => !file.startsWith('packages/') && !/(^|\/)office2html(?:\.exe)?$/.test(file)
    ),
    'The DeckRender tarball must not bundle platform binaries.'
  );
  assert(
    !JSON.stringify(packed.manifest).includes('workspace:'),
    'The DeckRender tarball must not contain workspace dependencies.'
  );
  const directOffice2html = Object.keys(packed.manifest.optionalDependencies ?? {}).filter((name) =>
    name.startsWith('@deckflow/office2html')
  );
  assert.deepEqual(directOffice2html, [target.name]);
  assert.equal(packed.manifest.optionalDependencies[target.name], target.version);
  return packed;
}

async function readPacked(json, destination) {
  const result = JSON.parse(json);
  const packed = Array.isArray(result) ? result[0] : result;
  packed.filename = path.resolve(destination, packed.filename);
  const manifest = JSON.parse(await run('tar', ['-xOf', packed.filename, 'package/package.json']));
  return { ...packed, manifest };
}

async function run(command, args, cwd = root, encoding = 'utf8') {
  const isWindowsShim = process.platform === 'win32' && ['npm', 'pnpm'].includes(command);
  const executable = isWindowsShim ? process.env.ComSpec || 'cmd.exe' : command;
  const invocation = isWindowsShim
    ? [
        '/d',
        '/s',
        '/c',
        `"${[`${command}.cmd`, ...args].map((value) => `"${value.replaceAll('"', '""')}"`).join(' ')}"`,
      ]
    : args;
  try {
    const { stdout } = await execute(executable, invocation, {
      cwd,
      encoding,
      maxBuffer: 40 * 1024 * 1024,
      timeout: 120_000,
      ...(isWindowsShim ? { windowsVerbatimArguments: true } : {}),
    });
    return stdout;
  } catch (error) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${error.stdout ?? ''}${error.stderr ?? ''}`, {
      cause: error,
    });
  }
}

async function digest(filename, algorithm = 'sha256', encoding = 'hex') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest(encoding);
}

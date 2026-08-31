#!/usr/bin/env node
/**
 * Verify main publish tarballs and pinned upstream npm packages without publishing
 * anything. Upstream tarballs are integrity-checked against pnpm-lock.yaml, then a
 * loopback-only registry records npm/pnpm downloads and platform filtering.
 * Requires pnpm, npm >= 10 (for --os/--cpu), tar, and an existing dist/ build.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readOffice2htmlPackages, verifyOffice2htmlManifest } from './office2html-packages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const upstreamRegistry = 'https://registry.npmjs.org/';
const { targets } = await readOffice2htmlPackages(root);
const npmVersion = (await run('npm', ['--version'])).trim();
assert(Number(npmVersion.split('.')[0]) >= 10, 'This check requires npm >= 10 for --os/--cpu.');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-packaging-'));
const artifacts = new Map();
const downloads = new Map();
let server;

try {
  const main = await packMain('pnpm');
  await packMain('npm');
  console.log(
    'Verified npm and pnpm main tarballs: pinned upstream dependencies, no workspace references or binaries.'
  );

  const upstreamChecks = await Promise.allSettled(
    targets.map(async (target) => {
      const destination = path.join(temporaryRoot, `upstream-${target.os}-${target.cpu}`);
      await fs.mkdir(destination);
      const spec = `${target.name}@${target.version}`;
      const metadata = JSON.parse(
        await run('npm', ['view', spec, 'dist', '--json', `--registry=${upstreamRegistry}`])
      );
      assert.equal(
        metadata.integrity,
        target.integrity,
        `Registry integrity differs from the lockfile for ${spec}.`
      );
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
      const integrity = `sha512-${await digest(packed.filename, 'sha512', 'base64')}`;
      assert.equal(integrity, target.integrity, `Tarball integrity mismatch for ${spec}.`);
      verifyOffice2htmlManifest(packed.manifest, target);
      const binary = packed.files.find(({ path: file }) => file === target.binary);
      assert(binary && binary.size > 0, `Missing root executable in ${spec}.`);
      assert((binary.mode & 0o111) !== 0, `Upstream binary is not executable in ${spec}.`);
      const binaryBytes = await run(
        'tar',
        ['-xOf', packed.filename, `package/${target.binary}`],
        root,
        'buffer'
      );
      artifacts.set(target.name, {
        ...packed,
        target,
        integrity,
        sha1: await digest(packed.filename, 'sha1'),
        binarySha256: createHash('sha256').update(binaryBytes).digest('hex'),
      });
      console.log(`Verified upstream ${spec}: SHA-512 integrity, OS/CPU, and root executable.`);
    })
  );
  const failures = upstreamChecks.filter((result) => result.status === 'rejected');
  if (failures.length) {
    throw new AggregateError(
      failures.map((result) => result.reason),
      'Upstream package verification failed.'
    );
  }

  let registry;
  server = http.createServer((request, response) => {
    const requested = decodeURIComponent(new URL(request.url, registry).pathname).slice(1);
    const artifact = artifacts.get(requested);
    if (artifact) {
      response.setHeader('Content-Type', 'application/json');
      const manifest = artifact.manifest;
      response.end(
        JSON.stringify({
          name: manifest.name,
          'dist-tags': { latest: manifest.version },
          versions: {
            [manifest.version]: {
              ...manifest,
              dist: {
                tarball: `${registry}tarballs/${path.basename(artifact.filename)}`,
                shasum: artifact.sha1,
                integrity: artifact.integrity,
              },
            },
          },
        })
      );
      return;
    }
    for (const [name, candidate] of artifacts) {
      if (requested === `tarballs/${path.basename(candidate.filename)}`) {
        downloads.set(name, (downloads.get(name) ?? 0) + 1);
        response.setHeader('Content-Type', 'application/octet-stream');
        createReadStream(candidate.filename).pipe(response);
        return;
      }
    }
    response.writeHead(404);
    response.end('This test registry contains only the office2html platform packages.');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  registry = `http://127.0.0.1:${server.address().port}/`;

  const scenarios = targets.map((target) => ({
    name: `npm-${target.os}-${target.cpu}`,
    manager: 'npm',
    os: target.os,
    cpu: target.cpu,
    expected: target.name,
  }));
  scenarios.push(
    { name: 'npm-unsupported-linux-arm64', manager: 'npm', os: 'linux', cpu: 'arm64' },
    {
      name: 'npm-cloud-only-omit-optional',
      manager: 'npm',
      os: process.platform,
      cpu: process.arch,
      omit: true,
    },
    {
      name: `pnpm-native-${process.platform}-${process.arch}`,
      manager: 'pnpm',
      expected: targets.find(({ os, cpu }) => os === process.platform && cpu === process.arch)?.name,
    },
    { name: 'pnpm-cloud-only-no-optional', manager: 'pnpm', omit: true },
    { name: 'pnpm-cloud-only-frozen-lockfile', manager: 'pnpm', omit: true, frozen: true }
  );

  for (const scenario of scenarios) {
    const installRoot = path.join(temporaryRoot, scenario.name);
    await fs.mkdir(installRoot);
    // Use the actual main tarball's optional versions, without installing its
    // unrelated JS dependencies. All four binary packages are upstream tarballs.
    await fs.writeFile(
      path.join(installRoot, 'package.json'),
      JSON.stringify(
        {
          name: 'deckrender-platform-install-test',
          version: '0.0.0',
          private: true,
          optionalDependencies: Object.fromEntries(
            [...artifacts.keys()].map((name) => [name, main.manifest.optionalDependencies[name]])
          ),
        },
        null,
        2
      )
    );
    if (scenario.frozen) {
      await fs.copyFile(
        path.join(temporaryRoot, 'pnpm-cloud-only-no-optional', 'pnpm-lock.yaml'),
        path.join(installRoot, 'pnpm-lock.yaml')
      );
    }
    downloads.clear();
    await run(
      scenario.manager,
      [
        'install',
        '--ignore-scripts',
        `--registry=${registry}`,
        ...(scenario.manager === 'npm'
          ? [
              '--no-audit',
              '--no-fund',
              '--package-lock=false',
              `--cache=${path.join(installRoot, 'cache')}`,
              `--os=${scenario.os}`,
              `--cpu=${scenario.cpu}`,
              ...(scenario.omit ? ['--omit=optional'] : []),
            ]
          : [
              '--reporter=append-only',
              `--store-dir=${path.join(installRoot, 'store')}`,
              ...(scenario.omit ? ['--no-optional'] : []),
              ...(scenario.frozen ? ['--frozen-lockfile'] : []),
            ]),
      ],
      installRoot
    );

    const installed = (
      await fs.readdir(path.join(installRoot, 'node_modules', '@deckflow')).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      })
    )
      .map((name) => `@deckflow/${name}`)
      .sort();
    const expected = scenario.expected ? [scenario.expected] : [];
    assert.deepEqual(installed, expected, `Incorrect installed packages for ${scenario.name}.`);
    if (scenario.manager === 'pnpm' && scenario.omit && !scenario.frozen) {
      // pnpm 9 may fetch the native optional tarball while resolving a fresh
      // lockfile even when it does not install it. Do not claim npm's zero-fetch
      // --omit=optional guarantee for pnpm; foreign-platform fetches still fail.
      const native = targets.find(({ os, cpu }) => os === process.platform && cpu === process.arch);
      for (const [name, count] of downloads) {
        assert.equal(name, native?.name, `Foreign-platform download for ${scenario.name}.`);
        assert.equal(count, 1, `Repeated optional download for ${scenario.name}.`);
      }
    } else {
      assert.deepEqual(
        [...downloads.keys()].sort(),
        expected,
        `Unnecessary binary downloads for ${scenario.name}.`
      );
    }
    if (scenario.expected) {
      assert.equal(downloads.get(scenario.expected), 1, 'The matching binary must be downloaded once.');
      const artifact = artifacts.get(scenario.expected);
      const binary = path.join(installRoot, 'node_modules', scenario.expected, artifact.target.binary);
      assert.equal(
        await digest(binary),
        artifact.binarySha256,
        'Installed binary differs from the integrity-verified upstream artifact.'
      );
    }
    console.log(
      `${scenario.name}: ${installed.length} platform package(s) installed, ${downloads.size} binary tarball(s) downloaded.`
    );
  }
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (process.env.KEEP_PACKAGING_ARTIFACTS === '1') {
    console.log(`Packaging artifacts retained at ${temporaryRoot}`);
  } else {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
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
    'The main tarball must not bundle platform binaries.'
  );
  assert(
    !JSON.stringify(packed.manifest).includes('workspace:'),
    'The main tarball must not contain workspace dependencies.'
  );
  for (const target of targets) {
    assert.equal(packed.manifest.optionalDependencies?.[target.name], target.version);
  }
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
  // Windows .cmd launchers require cmd.exe. Quote every controlled argument so
  // checkout and temporary-directory paths containing spaces stay intact.
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

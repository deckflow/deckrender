#!/usr/bin/env node
/**
 * Verify real publish tarballs and npm's platform filtering without publishing
 * anything. A loopback-only registry records downloads, so the check catches
 * both extra installed packages and unnecessary foreign-platform downloads.
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execute = promisify(execFile);
const npmVersion = (await run('npm', ['--version'])).trim();
assert(Number(npmVersion.split('.')[0]) >= 10, 'This check requires npm >= 10 for --os/--cpu.');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-packaging-'));
const artifacts = new Map();
const downloads = new Map();
let server;

try {
  const main = await pack(root);
  assert(
    main.files.some(({ path: file }) => file === 'dist/index.js'),
    'Run pnpm build first.'
  );
  assert(
    main.files.some(({ path: file }) => file === 'dist/cli.js'),
    'Missing built CLI.'
  );
  assert(
    main.files.every(({ path: file }) => !file.startsWith('packages/') && !file.includes('/bin/office2html')),
    'The main tarball must not bundle platform binaries.'
  );

  const directories = (await fs.readdir(path.join(root, 'packages')))
    .filter((name) => name.startsWith('office2html-'))
    .sort();
  for (const directory of directories) {
    const packed = await pack(path.join(root, 'packages', directory));
    const manifest = packed.manifest;
    assert.equal(main.manifest.optionalDependencies?.[manifest.name], main.manifest.version);
    assert.equal(manifest.version, main.manifest.version);
    assert.equal(manifest.os?.length, 1, `${manifest.name} needs exactly one os.`);
    assert.equal(manifest.cpu?.length, 1, `${manifest.name} needs exactly one cpu.`);
    assert(packed.files.some(({ path: file }) => file === manifest.bin?.office2html));
    artifacts.set(manifest.name, {
      ...packed,
      sha1: await digest(packed.filename, 'sha1'),
      binarySha256: await digest(path.join(root, 'packages', directory, manifest.bin.office2html)),
    });
  }
  assert.equal(artifacts.size, 4, 'Expected the four supported platform packages.');
  console.log('Verified five publish tarballs; main optional workspace references became release versions.');

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

  const scenarios = [...artifacts.values()].map(({ manifest }) => ({
    name: `${manifest.os[0]}-${manifest.cpu[0]}`,
    os: manifest.os[0],
    cpu: manifest.cpu[0],
    expected: manifest.name,
  }));
  scenarios.push(
    { name: 'unsupported-linux-arm64', os: 'linux', cpu: 'arm64' },
    { name: 'cloud-only-omit-optional', os: process.platform, cpu: process.arch, omit: true }
  );

  for (const scenario of scenarios) {
    const installRoot = path.join(temporaryRoot, scenario.name);
    await fs.mkdir(installRoot);
    // Use the actual main tarball's optional versions, without installing its
    // unrelated JS dependencies. All four binary packages are real tarballs.
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
    downloads.clear();
    await run(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        `--registry=${registry}`,
        `--cache=${path.join(installRoot, 'cache')}`,
        `--os=${scenario.os}`,
        `--cpu=${scenario.cpu}`,
        ...(scenario.omit ? ['--omit=optional'] : []),
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
    assert.deepEqual(
      [...downloads.keys()].sort(),
      expected,
      `Unnecessary binary downloads for ${scenario.name}.`
    );
    if (scenario.expected) {
      assert.equal(downloads.get(scenario.expected), 1, 'The matching binary must be downloaded once.');
      const artifact = artifacts.get(scenario.expected);
      const binary = path.join(
        installRoot,
        'node_modules',
        scenario.expected,
        artifact.manifest.bin.office2html
      );
      assert.equal(
        await digest(binary),
        artifact.binarySha256,
        'Installed binary differs from the bundled artifact.'
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

async function pack(directory) {
  const packed = JSON.parse(
    await run('pnpm', ['--dir', directory, 'pack', '--json', '--pack-destination', temporaryRoot])
  );
  const manifest = JSON.parse(await run('tar', ['-xOf', packed.filename, 'package/package.json']));
  return { ...packed, manifest };
}

async function run(command, args, cwd = root) {
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
      maxBuffer: 10 * 1024 * 1024,
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

async function digest(filename, algorithm = 'sha256') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

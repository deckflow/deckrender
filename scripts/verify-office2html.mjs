import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  {
    name: '@deckflow/office2html-darwin-arm64',
    directory: 'office2html-darwin-arm64',
    os: 'darwin',
    cpu: 'arm64',
    binary: 'bin/office2html',
    bytes: 15_296_448,
    sha256: 'b0d20c0cef9eb39eddf4c836cb410e1a773f7b0d456c5521f225552c828e9dda',
  },
  {
    name: '@deckflow/office2html-darwin-x64',
    directory: 'office2html-darwin-x64',
    os: 'darwin',
    cpu: 'x64',
    binary: 'bin/office2html',
    bytes: 16_279_472,
    sha256: '6f08c708fc5361ed487c9971107bd9301a862ed210183f5f5fc7cbbe63c80450',
  },
  {
    name: '@deckflow/office2html-linux-x64',
    directory: 'office2html-linux-x64',
    os: 'linux',
    cpu: 'x64',
    binary: 'bin/office2html',
    bytes: 16_127_078,
    sha256: 'eeae34d40c56007f6ac46d7f109a5604b788f427a27d703cc5d5c67f988dce4e',
  },
  {
    name: '@deckflow/office2html-win32-x64',
    directory: 'office2html-win32-x64',
    os: 'win32',
    cpu: 'x64',
    binary: 'bin/office2html.exe',
    bytes: 14_714_999,
    sha256: '1080d1a0324e33e04bfb20d1a829dccb1c02ff2d3cbf03142466aed67093b31d',
  },
];

const rootManifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));

for (const target of targets) {
  const packageRoot = path.join(root, 'packages', target.directory);
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.name !== target.name || manifest.os?.[0] !== target.os || manifest.cpu?.[0] !== target.cpu) {
    throw new Error(`Invalid platform metadata for ${target.name}`);
  }
  if (manifest.version !== rootManifest.version) {
    throw new Error(`${target.name} must use root version ${rootManifest.version}`);
  }
  if (manifest.bin?.office2html !== target.binary) {
    throw new Error(`Invalid bin entry for ${target.name}`);
  }
  if (rootManifest.optionalDependencies?.[target.name] !== 'workspace:*') {
    throw new Error(`${target.name} must be a root optionalDependency`);
  }

  const binaryPath = path.join(packageRoot, target.binary);
  const stat = await fs.stat(binaryPath);
  if (stat.size !== target.bytes) {
    throw new Error(`Unexpected size for ${target.name}: ${stat.size}`);
  }
  if (process.platform !== 'win32' && (stat.mode & 0o111) === 0) {
    throw new Error(`Binary is not executable: ${binaryPath}`);
  }

  const digest = await sha256(binaryPath);
  if (digest !== target.sha256) {
    throw new Error(`SHA-256 mismatch for ${target.name}: ${digest}`);
  }
}

console.log(`Verified ${targets.length} bundled office2html platform packages.`);

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const input = createReadStream(file);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

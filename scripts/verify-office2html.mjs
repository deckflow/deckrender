#!/usr/bin/env node
/** Offline validation. --require-installed additionally requires the native optional runtime. */
import assert from 'node:assert/strict';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOffice2htmlPackages, verifyOffice2htmlManifest } from './office2html-packages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const args = process.argv.slice(2);
assert(
  args.every((arg) => arg === '--require-installed'),
  'Usage: verify-office2html.mjs [--require-installed]'
);
const { targets } = await readOffice2htmlPackages(root);
console.log(
  `Verified ${targets.length} pinned upstream office2html dependencies and lockfile integrity entries.`
);

const target = targets.find(({ os, cpu }) => os === process.platform && cpu === process.arch);
if (!target) {
  assert(
    !args.includes('--require-installed'),
    `No upstream office2html package for ${process.platform}-${process.arch}.`
  );
  console.log(`No office2html package is required on unsupported ${process.platform}-${process.arch}.`);
} else {
  let manifestPath;
  try {
    manifestPath = require.resolve(`${target.name}/package.json`);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    const hint = `${target.name} is not installed (valid for cloud-only installs). Run pnpm install, or npm install --include=optional, for local PPTX rendering.`;
    assert(!args.includes('--require-installed'), hint);
    console.log(hint);
  }
  if (manifestPath) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    verifyOffice2htmlManifest(manifest, target);
    const binaryPath = path.join(path.dirname(manifestPath), target.binary);
    const stat = await fs.stat(binaryPath);
    assert(stat.isFile() && stat.size > 0, `Missing upstream executable: ${binaryPath}`);
    if (process.platform !== 'win32') await fs.access(binaryPath, fsConstants.X_OK);
    console.log(`Verified native upstream runtime: ${target.name}@${target.version}/${target.binary}.`);
  }
}

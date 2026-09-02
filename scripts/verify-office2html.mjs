#!/usr/bin/env node
/** Offline validation. --require-installed additionally requires a usable native runtime. */
import assert from 'node:assert/strict';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOffice2htmlPackage, verifyOffice2htmlManifest } from './office2html-packages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRequire = createRequire(path.join(root, 'package.json'));
const args = process.argv.slice(2);
assert(
  args.every((arg) => arg === '--require-installed'),
  'Usage: verify-office2html.mjs [--require-installed]'
);
const required = args.includes('--require-installed');
const { target } = await readOffice2htmlPackage(root);
console.log(`Verified the single pinned ${target.name}@${target.version} lockfile dependency.`);

let entryPath;
try {
  entryPath = packageRequire.resolve(target.name);
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  unavailable(`${target.name} is not installed (valid for cloud-only installs).`);
}

if (entryPath) {
  const manifest = JSON.parse(await fs.readFile(path.join(path.dirname(entryPath), 'package.json'), 'utf8'));
  verifyOffice2htmlManifest(manifest, target);

  let runtime;
  try {
    runtime = packageRequire(target.name);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    unavailable(`${target.name} has no runtime for ${process.platform}-${process.arch}: ${detail}`);
  }
  if (runtime) {
    assert.equal(typeof runtime.getBinaryPath, 'function', `${target.name} must export getBinaryPath().`);
    const binaryPath = runtime.getBinaryPath();
    assert.equal(typeof binaryPath, 'string', `${target.name}.getBinaryPath() must return a path.`);
    const stat = await fs.stat(binaryPath);
    assert(stat.isFile() && stat.size > 0, `Missing upstream executable: ${binaryPath}`);
    if (process.platform !== 'win32') await fs.access(binaryPath, fsConstants.X_OK);
    console.log(`Verified ${target.name}@${target.version} getBinaryPath(): ${binaryPath}`);
  }
}

function unavailable(message) {
  const hint = `${message} Install with optional dependencies enabled for local PPTX rendering.`;
  assert(!required, hint);
  console.log(hint);
}

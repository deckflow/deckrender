#!/usr/bin/env node
/**
 * Keep src/version.ts in step with package.json.
 *
 * The CLI cannot read package.json at runtime — it ships as a bundle in dist/
 * and `../package.json` does not resolve under global installs or npx. So the
 * version is inlined, and this script (run with --check in CI) makes sure the
 * two never drift.
 *
 *   node scripts/sync-version.mjs          rewrite src/version.ts
 *   node scripts/sync-version.mjs --check   exit 1 if it is stale
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const versionFile = path.join(root, 'src', 'version.ts');

const { version } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf-8'));
const source = await fs.readFile(versionFile, 'utf-8');
const current = /export const VERSION = '([^']+)';/.exec(source)?.[1];

if (current === version) {
  process.exit(0);
}

if (process.argv.includes('--check')) {
  console.error(
    `src/version.ts is out of date: has ${current}, package.json says ${version}.\n` +
      'Run: node scripts/sync-version.mjs'
  );
  process.exit(1);
}

await fs.writeFile(
  versionFile,
  source.replace(/export const VERSION = '[^']+';/, `export const VERSION = '${version}';`)
);
console.log(`src/version.ts updated to ${version}`);

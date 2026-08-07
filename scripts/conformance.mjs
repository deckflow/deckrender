#!/usr/bin/env node
/**
 * Render every file in tests/test-data to every output format and report the
 * result as a matrix.
 *
 * This drives the built CLI against the real backend, so it needs credentials
 * and costs quota. It is the ground truth behind docs/formats.md —
 * run it when the route table changes.
 *
 *   pnpm build && node scripts/conformance.mjs
 *   node scripts/conformance.mjs --only pptx,html
 *   node scripts/conformance.mjs --keep     # leave rendered artifacts on disk
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(root, 'dist', 'cli.js');
const DATA = path.join(root, 'tests', 'test-data');

const TARGETS = ['image', 'pdf', 'video'];

/** What the project promises today. Mismatches are what this script hunts for. */
const EXPECTED = {
  pdf: { image: 'yes', pdf: 'yes', video: 'soon' },
  pptx: { image: 'yes', pdf: 'yes', video: 'yes' },
  docx: { image: 'yes', pdf: 'yes', video: 'no' },
  xlsx: { image: 'soon', pdf: 'soon', video: 'no' },
  key: { image: 'yes', pdf: 'yes', video: 'soon' },
  pages: { image: 'yes', pdf: 'yes', video: 'no' },
  numbers: { image: 'yes', pdf: 'yes', video: 'no' },
  html: { image: 'yes', pdf: 'yes', video: 'yes' },
};

const args = process.argv.slice(2);
const only = valueOf('--only')
  ?.split(',')
  .map((s) => s.trim());
const keep = args.includes('--keep');

/**
 * Attempts per combination.
 *
 * Some backend converters fail intermittently on large inputs — `.key` to PDF
 * succeeded roughly one run in three during development while producing a
 * valid 9 MB PDF when it did. The CLI itself deliberately does not retry a
 * failed conversion (it would spend quota twice on a genuine failure), so the
 * tolerance lives here, in the harness, where a flake is reported as such
 * rather than masked.
 */
const attempts = Number(valueOf('--attempts') ?? 2);

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function discoverInputs() {
  const entries = await fs.readdir(DATA, { withFileTypes: true });
  const found = new Map();

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const ext = path.extname(entry.name).toLowerCase().slice(1);
    if (!ext || !(ext in EXPECTED)) continue;
    // Prefer the first match per extension so a directory bundle and a zipped
    // copy of the same document do not both get probed.
    if (!found.has(ext)) {
      found.set(ext, path.join(DATA, entry.name));
    }
  }

  return found;
}

/** Classify one CLI invocation. */
async function attempt(input, target, outDir) {
  const out = path.join(outDir, `${path.basename(input)}.${target}`);
  const started = Date.now();

  try {
    const { stdout } = await run('node', [CLI, input, '--format', target, '-o', out, '--json'], {
      timeout: 600_000,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    });
    const result = JSON.parse(stdout);
    return {
      status: 'yes',
      ms: Date.now() - started,
      route: result.route.join(' → '),
      pages: result.pages,
      files: result.outputs.length,
      engine: result.engine,
    };
  } catch (error) {
    const stderr = String(error.stderr ?? '');
    let payload;
    const start = stderr.lastIndexOf('\n{');
    try {
      payload = JSON.parse(start >= 0 ? stderr.slice(start + 1) : stderr);
    } catch {
      payload = undefined;
    }
    const code = payload?.error?.code;
    const message = payload?.error?.message ?? stderr.split('\n')[0] ?? String(error);

    return {
      status: code === 'not_implemented' ? 'soon' : code === 'unsupported_format' ? 'no' : 'FAIL',
      ms: Date.now() - started,
      code: code ?? 'unknown',
      message,
    };
  }
}

const SYMBOL = { yes: '✅', no: '❌', soon: '🕓', FAIL: '💥' };

async function main() {
  await fs.access(CLI).catch(() => {
    throw new Error('dist/cli.js is missing. Run `pnpm build` first.');
  });

  const inputs = await discoverInputs();
  if (inputs.size === 0) {
    throw new Error(`No recognised test files in ${DATA}`);
  }

  const outDir = keep
    ? path.join(root, 'tests', 'test-data', '__conformance__')
    : await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-conf-'));
  await fs.mkdir(outDir, { recursive: true });

  const rows = [];
  const problems = [];

  for (const [ext, file] of [...inputs].sort()) {
    if (only && !only.includes(ext)) continue;

    const row = { ext, file, cells: {} };
    for (const target of TARGETS) {
      process.stderr.write(`  ${ext} → ${target} ... `);
      const expected = EXPECTED[ext]?.[target];

      let outcome = await attempt(file, target, outDir);
      let retries = 0;
      // Only a hard failure is worth retrying; `no` and `soon` are decisions,
      // not flakes, and repeating them just burns time.
      while (outcome.status === 'FAIL' && expected === 'yes' && retries < attempts - 1) {
        retries += 1;
        process.stderr.write(`retry ${retries} ... `);
        outcome = await attempt(file, target, outDir);
      }
      if (retries > 0 && outcome.status === 'yes') {
        outcome.flaky = retries;
      }

      row.cells[target] = outcome;
      const matches = outcome.status === expected;
      process.stderr.write(
        `${SYMBOL[outcome.status] ?? '?'} ${outcome.status}` +
          (outcome.flaky ? ` (flaky: succeeded on attempt ${outcome.flaky + 1})` : '') +
          (matches ? '' : `  (expected ${expected})`) +
          '\n'
      );
      if (!matches) {
        problems.push({ ext, target, got: outcome, expected });
      }
    }
    rows.push(row);
  }

  console.log(`\n| Input | ${TARGETS.map((t) => t.padEnd(6)).join(' | ')} |`);
  console.log(`| --- | ${TARGETS.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    const cells = TARGETS.map((t) => {
      const cell = row.cells[t];
      const mark = SYMBOL[cell.status] ?? '?';
      if (cell.status !== 'yes') return mark;
      return `${mark} ${(cell.ms / 1000).toFixed(1)}s${cell.flaky ? ' ⚠︎' : ''}`;
    });
    console.log(`| .${row.ext} | ${cells.join(' | ')} |`);
  }

  console.log('\nRoutes taken');
  for (const row of rows) {
    for (const target of TARGETS) {
      const cell = row.cells[target];
      if (cell.status === 'yes') {
        console.log(
          `  .${row.ext} → ${target.padEnd(5)} ${cell.route}  (${cell.pages} page(s), ${cell.files} file(s))`
        );
      }
    }
  }

  const flaky = rows.flatMap((row) =>
    TARGETS.filter((t) => row.cells[t].flaky).map((t) => `.${row.ext} → ${t}`)
  );
  if (flaky.length > 0) {
    console.log(`\n⚠︎ Needed a retry (backend flakiness): ${flaky.join(', ')}`);
  }

  if (problems.length > 0) {
    console.log('\nMismatches vs. the documented matrix');
    for (const problem of problems) {
      console.log(
        `  .${problem.ext} → ${problem.target}: expected ${problem.expected}, got ${problem.got.status}` +
          (problem.got.message ? `\n      ${problem.got.message}` : '')
      );
    }
  } else {
    console.log('\nEverything matches the documented matrix.');
  }

  if (!keep) {
    await fs.rm(outDir, { recursive: true, force: true });
  } else {
    console.log(`\nArtifacts kept in ${outDir}`);
  }

  process.exit(problems.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

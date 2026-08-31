import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Options } from 'tsup';

const SDK_SHA256 = 'ee62aa3d21ab8e671a64103e72540064efb2712d4a7c56bce849645bb5f706b3';

/**
 * Temporary, build-only bridge for the pinned upstream 0.7.3 release.
 * Keep its upload/hash/multipart/auth/task/SSE implementations unchanged; remove
 * only filesystem inputs, Node UUID persistence, and Node runtime detection.
 * The checksum deliberately fails closed on any upstream change. Nothing in
 * node_modules is edited, and the Node build never uses this transform.
 * Remove this bridge when upstream ships a tested browser export.
 */
export function browserDeckopsSource(source: string): string {
  if (createHash('sha256').update(source).digest('hex') !== SDK_SHA256) {
    throw new Error(
      'Unrecognized @deckops/sdk source. Audit its browser export before updating the compatibility bridge.'
    );
  }
  function replaceSection(start: string, end: string, replacement: string): void {
    const a = source.indexOf(start);
    const b = source.indexOf(end, a + start.length);
    if (a < 0 || b < 0) throw new Error(`Missing DeckOps browser boundary: ${start}`);
    source = source.slice(0, a) + replacement + source.slice(b);
  }
  replaceSection(
    '    if (typeof input === "string") {',
    '    if (this.isBlob(input)) {',
    '    if (typeof input === "string") throw new Error("Filesystem inputs are not available in the browser SDK.");\n'
  );
  replaceSection('  isNodeRuntime() {', '  calculateMD5(data) {', '');
  replaceSection('function isNode() {', 'function isBrowserWithLocalStorage() {', '');
  replaceSection(
    'async function getNodeConfigDir() {',
    'async function resolveWithCustomStorage(options) {',
    'async function readFromDefaultStorage() { return readBrowserStorage(); }\n' +
      'async function persistToDefaultStorage(value) { writeBrowserStorage(value); }\n'
  );
  replaceSection(
    '  if (isNode() && isValidAuthUuid(process.env.DECKOPS_AUTH_UUID)) {',
    '  if (options.authUuidStorage) {',
    ''
  );
  source = source.replace(' && !(typeof process !== "undefined" && process.versions?.node)', '');
  if (/\bprocess\b|import\s*\(/.test(source)) {
    throw new Error('A Node runtime reference or dynamic import survived the DeckOps browser transform.');
  }
  return source;
}

export function deckopsBrowserPlugin(): NonNullable<Options['esbuildPlugins']>[number] {
  return {
    name: 'deckops-0.7.3-browser',
    setup(build) {
      build.onLoad({ filter: /[/\\]@deckops[/\\]sdk[/\\]dist[/\\]index\.js$/ }, async (args) => ({
        contents: browserDeckopsSource(await readFile(args.path, 'utf8')),
        loader: 'js',
        resolveDir: path.dirname(args.path),
      }));
    },
  };
}

/**
 * Package version.
 *
 * Inlined rather than read from package.json at runtime: the bundled CLI lives
 * in dist/ and reading `../package.json` breaks under global installs and npx.
 * Kept in sync by scripts/sync-version.mjs, which CI verifies.
 */
export const VERSION = '0.3.0';

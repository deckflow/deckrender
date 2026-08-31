import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export const office2htmlPlatforms = [
  { os: 'darwin', cpu: 'arm64', binary: 'office2html' },
  { os: 'darwin', cpu: 'x64', binary: 'office2html' },
  { os: 'linux', cpu: 'x64', binary: 'office2html' },
  { os: 'win32', cpu: 'x64', binary: 'office2html.exe' },
].map((platform) => ({
  ...platform,
  name: `@deckflow/office2html-${platform.os}-${platform.cpu}`,
}));

/** Read only the platform entries in pnpm's checked-in lockfile; no network or YAML dependency. */
export async function readOffice2htmlPackages(root) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const lockfile = await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  const optional = manifest.optionalDependencies ?? {};
  assert.deepEqual(
    Object.keys(optional)
      .filter((name) => name.startsWith('@deckflow/office2html-'))
      .sort(),
    office2htmlPlatforms.map(({ name }) => name).sort(),
    'Declare exactly the four supported upstream office2html packages as optional dependencies.'
  );
  assert(
    !lockfile.includes('link:packages/office2html-'),
    'office2html must resolve from npm, not workspace links.'
  );

  const importer = entry(entry(lockfile, 'importers', 0), '.', 2);
  const lockedOptional = entry(importer, 'optionalDependencies', 4);
  const packages = entry(lockfile, 'packages', 0);
  const snapshots = entry(lockfile, 'snapshots', 0);
  const targets = office2htmlPlatforms.map((target) => {
    const version = optional[target.name];
    assert.match(version ?? '', /^\d+\.\d+\.\d+$/, `${target.name} must pin an exact upstream release.`);
    assert(!manifest.dependencies?.[target.name], `${target.name} must remain optional.`);
    const dependency = entry(lockedOptional, target.name, 6);
    for (const field of ['specifier', 'version']) {
      assert.equal(scalar(dependency, field), version, `Lockfile ${field} drift for ${target.name}.`);
    }
    const locked = entry(packages, `${target.name}@${version}`, 2);
    assert.equal(scalar(locked, 'os'), `[${target.os}]`, `Invalid locked os for ${target.name}.`);
    assert.equal(scalar(locked, 'cpu'), `[${target.cpu}]`, `Invalid locked cpu for ${target.name}.`);
    const integrity = /\bintegrity: (sha512-[A-Za-z0-9+/]+={0,2})/.exec(locked)?.[1];
    assert(
      integrity && Buffer.from(integrity.slice(7), 'base64').length === 64,
      `Missing SHA-512 integrity for ${target.name}.`
    );
    assert.equal(
      scalar(entry(snapshots, `${target.name}@${version}`, 2), 'optional'),
      'true',
      `${target.name} must remain optional in the lockfile.`
    );
    return { ...target, version, integrity };
  });
  assert.equal(
    new Set(targets.map(({ version }) => version)).size,
    1,
    'Platform packages must use the same upstream release.'
  );
  return { manifest, targets };
}

export function verifyOffice2htmlManifest(manifest, target) {
  assert.equal(manifest.name, target.name, 'Unexpected upstream package name.');
  assert.equal(manifest.version, target.version, `Version drift for ${target.name}.`);
  assert.deepEqual(manifest.os, [target.os], `Invalid os metadata for ${target.name}.`);
  assert.deepEqual(manifest.cpu, [target.cpu], `Invalid cpu metadata for ${target.name}.`);
  assert(
    manifest.files?.includes(target.binary),
    `${target.name} must ship ${target.binary} at the package root.`
  );
}

// This deliberately accepts pnpm's mapping serialization, not arbitrary YAML.
// Keeping the lookup scoped by indentation avoids matching importer entries in snapshots.
function entry(source, key, indent) {
  const lines = source.split(/\r?\n/);
  const prefixes = [key, `'${key}'`, `"${key}"`].map((value) => `${' '.repeat(indent)}${value}:`);
  const start = lines.findIndex((line) => prefixes.some((prefix) => line.startsWith(prefix)));
  assert(start >= 0, `Missing lockfile entry: ${key}`);
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || lines[end].search(/\S/) > indent)) end += 1;
  return lines.slice(start + 1, end).join('\n');
}

function scalar(source, key) {
  const value = new RegExp(`^ +${key}: (.+)$`, 'm').exec(source)?.[1];
  return value?.replace(/^['"]|['"]$/g, '');
}

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

export const office2htmlPackageName = '@deckflow/office2html';

/** Validate DeckRender's single direct office2html dependency and its lockfile entry. */
export async function readOffice2htmlPackage(root) {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const lockfile = await fs.readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8');
  const optional = manifest.optionalDependencies ?? {};
  const directOffice2html = Object.keys(optional).filter((name) =>
    name.startsWith(office2htmlPackageName)
  );
  assert.deepEqual(
    directOffice2html,
    [office2htmlPackageName],
    `Declare only ${office2htmlPackageName} as the direct optional office2html dependency.`
  );
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    assert(
      !Object.keys(manifest[field] ?? {}).some((name) => name.startsWith(office2htmlPackageName)),
      `${office2htmlPackageName} must be declared only once, in optionalDependencies.`
    );
  }
  assert(
    !lockfile.includes('link:packages/office2html-') &&
      !lockfile.includes('workspace:packages/office2html-'),
    'office2html must resolve from npm, not a workspace package.'
  );

  const version = optional[office2htmlPackageName];
  assert.match(
    version ?? '',
    /^\d+\.\d+\.\d+$/,
    `${office2htmlPackageName} must pin an exact upstream release.`
  );
  const importer = entry(entry(lockfile, 'importers', 0), '.', 2);
  const lockedOptional = entry(importer, 'optionalDependencies', 4);
  const dependency = entry(lockedOptional, office2htmlPackageName, 6);
  for (const field of ['specifier', 'version']) {
    assert.equal(
      scalar(dependency, field),
      version,
      `Lockfile ${field} drift for ${office2htmlPackageName}.`
    );
  }

  const packages = entry(lockfile, 'packages', 0);
  const locked = entry(packages, `${office2htmlPackageName}@${version}`, 2);
  const integrity = /\bintegrity: (sha512-[A-Za-z0-9+/]+={0,2})/.exec(locked)?.[1];
  assert(
    integrity && Buffer.from(integrity.slice(7), 'base64').length === 64,
    `Missing SHA-512 integrity for ${office2htmlPackageName}.`
  );

  const snapshots = entry(lockfile, 'snapshots', 0);
  assert.equal(
    scalar(entry(snapshots, `${office2htmlPackageName}@${version}`, 2), 'optional'),
    'true',
    `${office2htmlPackageName} must remain optional in the lockfile.`
  );

  return {
    manifest,
    target: { name: office2htmlPackageName, version, integrity },
  };
}

/** Validate the public wrapper contract without duplicating its platform routing table. */
export function verifyOffice2htmlManifest(manifest, target) {
  assert.equal(manifest.name, target.name, 'Unexpected upstream package name.');
  assert.equal(manifest.version, target.version, `Version drift for ${target.name}.`);
  assert.equal(typeof manifest.main, 'string', `${target.name} must expose a CommonJS entry.`);
  const cli = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.office2html;
  assert.equal(typeof cli, 'string', `${target.name} must expose the office2html CLI.`);

  const platformPackages = Object.entries(manifest.optionalDependencies ?? {});
  assert(platformPackages.length > 0, `${target.name} must declare its platform runtimes.`);
  for (const [name, version] of platformPackages) {
    assert(
      name.startsWith(`${office2htmlPackageName}-`),
      `${target.name} contains an unexpected optional dependency: ${name}.`
    );
    assert.equal(version, target.version, `${name} must match ${target.name}@${target.version}.`);
  }
  return { cli, platformPackages: platformPackages.map(([name]) => name) };
}

// This deliberately accepts pnpm's mapping serialization, not arbitrary YAML.
// Keeping the lookup scoped by indentation avoids matching importer entries in snapshots.
function entry(source, key, indent) {
  const lines = source.split(/\r?\n/);
  const prefixes = [key, `'${key}'`, `"${key}"`].map(
    (value) => `${' '.repeat(indent)}${value}:`
  );
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

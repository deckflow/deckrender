import fs from 'node:fs/promises';
import path from 'node:path';
import { DeckRenderError } from '../errors/index.js';
import { isHttpUrl } from '../engines/artifacts.js';
import type { ProgressEvent, RenderArtifact, RenderOutputEntry } from '../types.js';
import { frameName, templatedName } from './naming.js';

export interface WriteOptions {
  /** `-o` value. Undefined means "derive from the input". */
  out?: string;
  /** Base name used when `out` is absent, e.g. `presentation`. */
  baseName: string;
  /** Directory used when `out` is absent. */
  baseDir: string;
  onProgress?: (event: ProgressEvent) => void;
}

export interface WriteResult {
  entries: RenderOutputEntry[];
  /** What the human-readable success line prints. */
  target: string;
}

/**
 * Persist artifacts, following the layout rules in contracts/cli-output.md.
 *
 * The shape of the output depends on both `-o` and how many frames came back,
 * so all of that decision-making lives here rather than being spread across
 * the engine and the CLI.
 */
export async function writeArtifacts(
  artifacts: RenderArtifact[],
  options: WriteOptions
): Promise<WriteResult> {
  if (artifacts.length === 0) {
    throw DeckRenderError.conversion('Nothing to write: the render produced no artifacts.');
  }

  const multi = artifacts.length > 1;
  const out = options.out;

  if (out === '-') {
    if (multi) {
      throw DeckRenderError.usage(`Cannot stream ${artifacts.length} frames to stdout.`, {
        hint: 'Write to a directory or a .zip instead, or narrow the output with --pages.',
      });
    }
    const bytes = await fetchArtifact(artifacts[0]!, options);
    process.stdout.write(bytes);
    return { entries: [entryFor(artifacts[0]!, '-', bytes.length)], target: '-' };
  }

  if (!out) {
    return multi
      ? writeDirectory(artifacts, path.join(options.baseDir, options.baseName), options)
      : writeSingleFile(
          artifacts[0]!,
          path.join(options.baseDir, `${options.baseName}${artifacts[0]!.ext}`),
          options
        );
  }

  const ext = path.extname(out).toLowerCase();

  if (ext === '.zip') {
    return writeZip(artifacts, out, options);
  }

  if (!ext || (await isExistingDirectory(out))) {
    return writeDirectory(artifacts, out, options);
  }

  if (!multi) {
    return writeSingleFile(artifacts[0]!, out, options);
  }

  return writeTemplated(artifacts, out, options);
}

async function writeSingleFile(
  artifact: RenderArtifact,
  target: string,
  options: WriteOptions
): Promise<WriteResult> {
  const bytes = await fetchArtifact(artifact, options);
  await fs.mkdir(path.dirname(path.resolve(target)), { recursive: true });
  await fs.writeFile(target, bytes);
  return {
    entries: [entryFor(artifact, target, bytes.length)],
    target,
  };
}

async function writeDirectory(
  artifacts: RenderArtifact[],
  dir: string,
  options: WriteOptions
): Promise<WriteResult> {
  await fs.mkdir(dir, { recursive: true });
  const entries: RenderOutputEntry[] = [];

  for (const [index, artifact] of artifacts.entries()) {
    const bytes = await fetchArtifact(artifact, options);
    const name = frameName(index + 1, artifacts.length, artifact.ext);
    const target = path.join(dir, name);
    await fs.writeFile(target, bytes);
    entries.push(entryFor(artifact, target, bytes.length));
  }

  return { entries, target: dir };
}

async function writeTemplated(
  artifacts: RenderArtifact[],
  out: string,
  options: WriteOptions
): Promise<WriteResult> {
  await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
  const entries: RenderOutputEntry[] = [];

  for (const [index, artifact] of artifacts.entries()) {
    const bytes = await fetchArtifact(artifact, options);
    const target = templatedName(out, index + 1, artifacts.length);
    await fs.writeFile(target, bytes);
    entries.push(entryFor(artifact, target, bytes.length));
  }

  return { entries, target: `${entries.length} files matching ${templatedName(out, 1, artifacts.length)}` };
}

async function writeZip(
  artifacts: RenderArtifact[],
  out: string,
  options: WriteOptions
): Promise<WriteResult> {
  const { createZip } = await import('./zip.js');
  const entries: RenderOutputEntry[] = [];
  const zipEntries: { name: string; bytes: Uint8Array }[] = [];

  for (const [index, artifact] of artifacts.entries()) {
    const bytes = await fetchArtifact(artifact, options);
    const name = frameName(index + 1, artifacts.length, artifact.ext);
    zipEntries.push({ name, bytes });
    entries.push(entryFor(artifact, name, bytes.length));
  }

  await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await fs.writeFile(out, createZip(zipEntries));

  return { entries, target: out };
}

function entryFor(artifact: RenderArtifact, file: string, bytes: number): RenderOutputEntry {
  return {
    page: artifact.page,
    file,
    ...(artifact.width !== undefined ? { width: artifact.width } : {}),
    ...(artifact.height !== undefined ? { height: artifact.height } : {}),
    bytes,
  };
}

/** Read an artifact's bytes, whether it lives on the network or on disk. */
async function fetchArtifact(artifact: RenderArtifact, options: WriteOptions): Promise<Buffer> {
  if (!isHttpUrl(artifact.source)) {
    return fs.readFile(artifact.source);
  }

  options.onProgress?.({ phase: 'download', message: `Downloading page ${artifact.page}` });

  const response = await fetch(artifact.source);
  if (!response.ok) {
    throw DeckRenderError.conversion(
      `Failed to download page ${artifact.page}: ${response.status} ${response.statusText}`
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

async function isExistingDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

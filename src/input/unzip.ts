import zlib from 'node:zlib';
import { promisify } from 'node:util';

const inflateRaw = promisify(zlib.inflateRaw);

/**
 * Read a single entry out of a ZIP archive.
 *
 * Deliberately minimal: iWork documents are ZIP containers, and pulling one
 * known file out of them is the whole requirement. A general-purpose ZIP
 * library would be a dependency for a job that is ~80 lines of buffer reads.
 *
 * Supports stored (method 0) and deflate (method 8), which covers everything
 * iWork writes.
 */

const EOCD_SIGNATURE = 0x06054b50;
const EOCD64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_COMMENT = 0xffff;

export interface ZipEntryInfo {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/** List the archive's entries by walking its central directory. */
export function listZipEntries(buffer: Buffer): ZipEntryInfo[] {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd === undefined) {
    return [];
  }

  let count = buffer.readUInt16LE(eocd + 10);
  let directoryOffset = buffer.readUInt32LE(eocd + 16);

  // ZIP64: the 32-bit fields saturate and the real values live in a separate
  // record. iWork bundles with many assets do hit this.
  if (count === 0xffff || directoryOffset === 0xffffffff) {
    const zip64 = findZip64Directory(buffer, eocd);
    if (zip64) {
      count = zip64.count;
      directoryOffset = zip64.offset;
    }
  }

  const entries: ZipEntryInfo[] = [];
  let cursor = directoryOffset;

  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      break;
    }
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);

    entries.push({
      name: buffer.toString('utf-8', cursor + 46, cursor + 46 + nameLength),
      method: buffer.readUInt16LE(cursor + 10),
      compressedSize: buffer.readUInt32LE(cursor + 20),
      uncompressedSize: buffer.readUInt32LE(cursor + 24),
      localHeaderOffset: buffer.readUInt32LE(cursor + 42),
    });

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** Extract one entry's bytes. Returns undefined when the name is absent. */
export async function readZipEntry(buffer: Buffer, name: string): Promise<Buffer | undefined> {
  const entry = listZipEntries(buffer).find((candidate) => candidate.name === name);
  if (!entry) {
    return undefined;
  }
  return readEntryData(buffer, entry);
}

export async function readEntryData(buffer: Buffer, entry: ZipEntryInfo): Promise<Buffer | undefined> {
  const header = entry.localHeaderOffset;
  if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== LOCAL_SIGNATURE) {
    return undefined;
  }

  // The local header repeats the name and extra lengths, and they can differ
  // from the central directory's, so read them from here.
  const nameLength = buffer.readUInt16LE(header + 26);
  const extraLength = buffer.readUInt16LE(header + 28);
  const start = header + 30 + nameLength + extraLength;
  const data = buffer.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) {
    return Buffer.from(data);
  }
  if (entry.method === 8) {
    return Buffer.from(await inflateRaw(data));
  }
  return undefined;
}

function findEndOfCentralDirectory(buffer: Buffer): number | undefined {
  const earliest = Math.max(0, buffer.length - MAX_COMMENT - 22);
  for (let offset = buffer.length - 22; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return undefined;
}

function findZip64Directory(buffer: Buffer, eocd: number): { count: number; offset: number } | undefined {
  const locator = eocd - 20;
  if (locator < 0 || buffer.readUInt32LE(locator) !== EOCD64_LOCATOR_SIGNATURE) {
    return undefined;
  }

  const record = Number(buffer.readBigUInt64LE(locator + 8));
  if (record < 0 || record + 56 > buffer.length) {
    return undefined;
  }

  return {
    count: Number(buffer.readBigUInt64LE(record + 32)),
    offset: Number(buffer.readBigUInt64LE(record + 48)),
  };
}

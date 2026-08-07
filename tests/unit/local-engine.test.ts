import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractIworkPreview } from '../../src/engines/local.js';
import { jpegToPdf, readJpegSize } from '../../src/output/jpeg-pdf.js';
import { listZipEntries, readZipEntry } from '../../src/input/unzip.js';
import { createZip } from '../../src/output/zip.js';
import type { DeckRenderError } from '../../src/errors/index.js';

/**
 * A JPEG with just enough structure to carry dimensions.
 *
 * The PDF wrapper treats the payload as opaque, so a real photo would only
 * make the fixtures large.
 */
function fakeJpeg(width: number, height: number): Buffer {
  const sof = Buffer.alloc(21);
  sof.writeUInt16BE(0xffd8, 0); // SOI
  sof.writeUInt16BE(0xffc0, 2); // SOF0
  sof.writeUInt16BE(17, 4); // segment length
  sof.writeUInt8(8, 6); // precision
  sof.writeUInt16BE(height, 7);
  sof.writeUInt16BE(width, 9);
  sof.writeUInt8(3, 11); // component count
  sof.writeUInt16BE(0xffd9, 19); // EOI
  return sof;
}

let workDir: string;

beforeEach(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckrender-local-'));
});

afterEach(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

describe('zip reader', () => {
  it('reads a stored entry', async () => {
    const zip = createZip([{ name: 'preview.jpg', bytes: fakeJpeg(100, 200) }]);
    expect(listZipEntries(zip).map((e) => e.name)).toEqual(['preview.jpg']);
    expect(await readZipEntry(zip, 'preview.jpg')).toEqual(fakeJpeg(100, 200));
  });

  it('reads a deflated entry', async () => {
    // iWork mixes stored and deflated members, so both paths must work.
    const payload = Buffer.from('x'.repeat(500));
    const deflated = zlib.deflateRawSync(payload);
    const zip = buildDeflatedZip('data.bin', payload, deflated);

    expect(await readZipEntry(zip, 'data.bin')).toEqual(payload);
  });

  it('returns undefined for a missing entry', async () => {
    const zip = createZip([{ name: 'a.txt', bytes: Buffer.from('hi') }]);
    expect(await readZipEntry(zip, 'nope.jpg')).toBeUndefined();
  });

  it('returns no entries for something that is not a zip', () => {
    expect(listZipEntries(Buffer.from('definitely not a zip'))).toEqual([]);
  });
});

describe('readJpegSize', () => {
  it('reads dimensions from the frame header', () => {
    expect(readJpegSize(fakeJpeg(724, 1022))).toEqual({ width: 724, height: 1022 });
  });

  it('rejects non-JPEG bytes', () => {
    expect(() => readJpegSize(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toThrowError(/not a JPEG/);
  });
});

describe('jpegToPdf', () => {
  it('produces a single-page PDF sized to the image', () => {
    const pdf = jpegToPdf(fakeJpeg(724, 1022));
    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 724 1022]');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Type /Catalog');
  });

  it('embeds the JPEG bytes verbatim rather than re-encoding', () => {
    const jpeg = fakeJpeg(10, 10);
    expect(jpegToPdf(jpeg).includes(jpeg)).toBe(true);
  });

  it('declares an xref entry per object', () => {
    const text = jpegToPdf(fakeJpeg(10, 10)).toString('latin1');
    expect(text).toContain('xref\n0 6\n');
    expect(text).toContain('/Size 6');
  });
});

describe('extractIworkPreview', () => {
  it('reads the preview from a directory bundle', async () => {
    // iCloud and Finder each save a different shape; this is the loose one.
    const bundle = path.join(workDir, 'doc.pages');
    await fs.mkdir(bundle, { recursive: true });
    await fs.writeFile(path.join(bundle, 'preview.jpg'), fakeJpeg(724, 1022));

    expect(readJpegSize(await extractIworkPreview(bundle, undefined))).toEqual({
      width: 724,
      height: 1022,
    });
  });

  it('reads the preview from a single-file bundle', async () => {
    const file = path.join(workDir, 'doc.numbers');
    await fs.writeFile(
      file,
      createZip([
        { name: 'Index/Document.iwa', bytes: Buffer.from('opaque') },
        { name: 'preview.jpg', bytes: fakeJpeg(800, 600) },
      ])
    );

    expect(readJpegSize(await extractIworkPreview(file, undefined))).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('reads from in-memory bytes when there is no path', async () => {
    const zip = createZip([{ name: 'preview.jpg', bytes: fakeJpeg(320, 240) }]);
    expect(readJpegSize(await extractIworkPreview(undefined, zip))).toEqual({
      width: 320,
      height: 240,
    });
  });

  it('falls back to the web preview when the full one is absent', async () => {
    const file = path.join(workDir, 'doc.pages');
    await fs.writeFile(file, createZip([{ name: 'preview-web.jpg', bytes: fakeJpeg(400, 300) }]));

    expect(readJpegSize(await extractIworkPreview(file, undefined))).toEqual({
      width: 400,
      height: 300,
    });
  });

  it('explains what to do when the document carries no preview', async () => {
    const file = path.join(workDir, 'doc.pages');
    await fs.writeFile(file, createZip([{ name: 'Index/Document.iwa', bytes: Buffer.from('x') }]));

    try {
      await extractIworkPreview(file, undefined);
      throw new Error('expected a throw');
    } catch (error) {
      expect((error as DeckRenderError).code).toBe('conversion_error');
      expect((error as DeckRenderError).hint).toMatch(/Include preview in document/);
    }
  });
});

/** Hand-build a zip with one deflated member; createZip only stores. */
function buildDeflatedZip(name: string, raw: Buffer, deflated: Buffer): Buffer {
  const nameBytes = Buffer.from(name);
  const crc = zlib.crc32 ? zlib.crc32(raw) : crc32(raw);

  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(raw.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);

  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10); // deflate
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  nameBytes.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + deflated.length, 16);

  return Buffer.concat([local, deflated, central, eocd]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

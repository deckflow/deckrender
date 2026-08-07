import { DeckRenderError } from '../errors/index.js';

/**
 * Wrap a JPEG in a single-page PDF.
 *
 * PDF can carry JPEG data verbatim through the DCTDecode filter, so this is a
 * container swap rather than a re-encode: no image library, no quality loss,
 * no dependency. It exists so formats that only yield a raster preview can
 * still answer `--format pdf`.
 */
export function jpegToPdf(jpeg: Buffer): Buffer {
  const { width, height } = readJpegSize(jpeg);

  const objects: Buffer[] = [];
  const push = (body: string | Buffer): void => {
    objects.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body);
  };

  push('<< /Type /Catalog /Pages 2 0 R >>');
  push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  push(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`
  );
  push(
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
        'latin1'
      ),
      jpeg,
      Buffer.from('\nendstream', 'latin1'),
    ])
  );

  const content = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`;
  push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  let position = chunks[0]!.length;

  for (const [index, body] of objects.entries()) {
    offsets.push(position);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
      body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    chunks.push(chunk);
    position += chunk.length;
  }

  const xrefOffset = position;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref, 'latin1'));

  return Buffer.concat(chunks);
}

/**
 * Read pixel dimensions from a JPEG's start-of-frame marker.
 *
 * The PDF page box has to match the image or the result is stretched, and the
 * dimensions are only available by walking the marker segments.
 */
export function readJpegSize(jpeg: Buffer): { width: number; height: number } {
  if (jpeg.length < 4 || jpeg.readUInt16BE(0) !== 0xffd8) {
    throw DeckRenderError.conversion('Embedded preview is not a JPEG.');
  }

  let offset = 2;
  while (offset + 9 < jpeg.length) {
    if (jpeg[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = jpeg[offset + 1]!;
    // SOF0..SOF15, excluding the non-frame markers DHT (c4), JPG (c8), DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: jpeg.readUInt16BE(offset + 5),
        width: jpeg.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + jpeg.readUInt16BE(offset + 2);
  }

  throw DeckRenderError.conversion('Could not read the preview image dimensions.');
}

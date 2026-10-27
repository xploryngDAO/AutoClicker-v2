export interface ZipFileEntry {
  path: string;
  content: string | Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16LE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >>> 8) & 0xff;
}

function writeUint32LE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = val & 0xff;
  buf[offset + 1] = (val >>> 8) & 0xff;
  buf[offset + 2] = (val >>> 16) & 0xff;
  buf[offset + 3] = (val >>> 24) & 0xff;
}

function writeUint32BE(buf: Uint8Array, offset: number, val: number): void {
  buf[offset] = (val >>> 24) & 0xff;
  buf[offset + 1] = (val >>> 16) & 0xff;
  buf[offset + 2] = (val >>> 8) & 0xff;
  buf[offset + 3] = val & 0xff;
}

export function createZipArchive(entries: ZipFileEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const prepared = entries.map((entry) => {
    const cleanPath = entry.path.replace(/^\/+/, '');
    const nameBytes = encoder.encode(cleanPath);
    const dataBytes =
      typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content;
    const checksum = crc32(dataBytes);
    return { nameBytes, dataBytes, checksum };
  });

  let localSize = 0;
  let centralSize = 0;
  for (const item of prepared) {
    localSize += 30 + item.nameBytes.length + item.dataBytes.length;
    centralSize += 46 + item.nameBytes.length;
  }

  const totalSize = localSize + centralSize + 22;
  const out = new Uint8Array(totalSize);

  const dosTime = (10 << 11) | (30 << 5) | 0;
  const dosDate = ((2026 - 1980) << 9) | (10 << 5) | 26;

  let localOffset = 0;
  const offsets: number[] = [];

  for (const item of prepared) {
    offsets.push(localOffset);
    writeUint32LE(out, localOffset, 0x04034b50); // Local file header signature
    writeUint16LE(out, localOffset + 4, 20); // Version needed to extract (2.0)
    writeUint16LE(out, localOffset + 6, 0x0800); // UTF-8 filename flag
    writeUint16LE(out, localOffset + 8, 0); // Store (no compression)
    writeUint16LE(out, localOffset + 10, dosTime);
    writeUint16LE(out, localOffset + 12, dosDate);
    writeUint32LE(out, localOffset + 14, item.checksum);
    writeUint32LE(out, localOffset + 18, item.dataBytes.length);
    writeUint32LE(out, localOffset + 22, item.dataBytes.length);
    writeUint16LE(out, localOffset + 26, item.nameBytes.length);
    writeUint16LE(out, localOffset + 28, 0);
    out.set(item.nameBytes, localOffset + 30);
    out.set(item.dataBytes, localOffset + 30 + item.nameBytes.length);
    localOffset += 30 + item.nameBytes.length + item.dataBytes.length;
  }

  const centralStart = localOffset;
  let centralOffset = centralStart;

  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i];
    const isDir = item.nameBytes.length > 0 && item.nameBytes[item.nameBytes.length - 1] === 47; // ends with '/'
    writeUint32LE(out, centralOffset, 0x02014b50); // Central directory signature
    writeUint16LE(out, centralOffset + 4, (3 << 8) | 20); // Version made by: Unix 2.0
    writeUint16LE(out, centralOffset + 6, 20); // Version needed to extract: 2.0
    writeUint16LE(out, centralOffset + 8, 0x0800); // UTF-8 flag
    writeUint16LE(out, centralOffset + 10, 0); // Store
    writeUint16LE(out, centralOffset + 12, dosTime);
    writeUint16LE(out, centralOffset + 14, dosDate);
    writeUint32LE(out, centralOffset + 16, item.checksum);
    writeUint32LE(out, centralOffset + 20, item.dataBytes.length);
    writeUint32LE(out, centralOffset + 24, item.dataBytes.length);
    writeUint16LE(out, centralOffset + 28, item.nameBytes.length);
    writeUint16LE(out, centralOffset + 30, 0);
    writeUint16LE(out, centralOffset + 32, 0);
    writeUint16LE(out, centralOffset + 34, 0);
    writeUint16LE(out, centralOffset + 36, 0);
    // External file attributes: Unix permissions (0644 file / 0755 dir) + DOS attribute (0x20 archive / 0x10 directory)
    const externalAttr = isDir ? ((0o040755 << 16) | 0x10) : ((0o100644 << 16) | 0x20);
    writeUint32LE(out, centralOffset + 38, externalAttr);
    writeUint32LE(out, centralOffset + 42, offsets[i]);
    out.set(item.nameBytes, centralOffset + 46);
    centralOffset += 46 + item.nameBytes.length;
  }

  // End of central directory record
  writeUint32LE(out, centralOffset, 0x06054b50);
  writeUint16LE(out, centralOffset + 4, 0);
  writeUint16LE(out, centralOffset + 6, 0);
  writeUint16LE(out, centralOffset + 8, prepared.length);
  writeUint16LE(out, centralOffset + 10, prepared.length);
  writeUint32LE(out, centralOffset + 12, centralSize);
  writeUint32LE(out, centralOffset + 16, centralStart);
  writeUint16LE(out, centralOffset + 20, 0);

  return out;
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32BE(chunk, 0, data.length);
  for (let i = 0; i < 4; i++) {
    chunk[4 + i] = type.charCodeAt(i);
  }
  chunk.set(data, 8);
  const crcVal = crc32(chunk.subarray(4, 8 + data.length));
  writeUint32BE(chunk, 8 + data.length, crcVal);
  return chunk;
}

/**
 * Generates a valid uncompressed PNG icon with a cobalt rounded square & white checkmark motif
 * so unpacked Chrome/Edge MV3 extensions load cleanly without missing icon errors.
 */
export function createExtensionIconPng(size: number): Uint8Array {
  const rowStride = 1 + size * 4;
  const rawScanlines = new Uint8Array(size * rowStride);

  for (let y = 0; y < size; y++) {
    const rowStart = y * rowStride;
    rawScanlines[rowStart] = 0; // Filter type 0 (None)
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;
      const nx = x / size;
      const ny = y / size;

      // Checkmark diagonal geometry
      const d1 = Math.abs((nx - 0.28) - (ny - 0.52)) < 0.085 && nx >= 0.24 && nx <= 0.44;
      const d2 = Math.abs((nx - 0.44) + (ny - 0.68)) < 0.085 && nx >= 0.41 && nx <= 0.76;
      const isCheck = d1 || d2;

      if (isCheck) {
        rawScanlines[px] = 255;
        rawScanlines[px + 1] = 255;
        rawScanlines[px + 2] = 255;
        rawScanlines[px + 3] = 255;
      } else {
        rawScanlines[px] = 37;  // #2563EB cobalt
        rawScanlines[px + 1] = 99;
        rawScanlines[px + 2] = 235;
        rawScanlines[px + 3] = 255;
      }
    }
  }

  // Zlib wrapper with stored deflate blocks (max 65535 bytes per block)
  const blocks: Uint8Array[] = [];
  let offset = 0;
  while (offset < rawScanlines.length) {
    const chunkLen = Math.min(65535, rawScanlines.length - offset);
    const isFinal = offset + chunkLen >= rawScanlines.length ? 1 : 0;
    const block = new Uint8Array(5 + chunkLen);
    block[0] = isFinal;
    writeUint16LE(block, 1, chunkLen);
    writeUint16LE(block, 3, (~chunkLen) & 0xffff);
    block.set(rawScanlines.subarray(offset, offset + chunkLen), 5);
    blocks.push(block);
    offset += chunkLen;
  }

  const blocksTotal = blocks.reduce((acc, b) => acc + b.length, 0);
  const zlibStream = new Uint8Array(2 + blocksTotal + 4);
  zlibStream[0] = 0x78;
  zlibStream[1] = 0x01;
  let zPos = 2;
  for (const b of blocks) {
    zlibStream.set(b, zPos);
    zPos += b.length;
  }
  writeUint32BE(zlibStream, zPos, adler32(rawScanlines));

  const ihdr = new Uint8Array(13);
  writeUint32BE(ihdr, 0, size);
  writeUint32BE(ihdr, 4, size);
  ihdr[8] = 8; // Bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', zlibStream);
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  const png = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let p = 0;
  png.set(signature, p);
  p += signature.length;
  png.set(ihdrChunk, p);
  p += ihdrChunk.length;
  png.set(idatChunk, p);
  p += idatChunk.length;
  png.set(iendChunk, p);
  return png;
}

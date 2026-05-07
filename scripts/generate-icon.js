// Generate a simple 256x256 PNG icon for CC Island
const fs = require('fs');
const path = require('path');

// Create a minimal valid PNG with a simple design
// We'll create a 64x64 base and scale up
const size = 256;

// PNG file signature
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function createIHDR() {
  const chunk = Buffer.alloc(13);
  chunk.writeUInt32BE(size, 0);  // width
  chunk.writeUInt32BE(size, 4);  // height
  chunk[8] = 8;   // bit depth
  chunk[9] = 6;   // color type: RGBA
  chunk[10] = 0;  // compression
  chunk[11] = 0;  // filter
  chunk[12] = 0;  // interlace
  return createChunk('IHDR', chunk);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createImageData() {
  // Create image data with filter byte at start of each row
  const rawData = Buffer.alloc(size * (1 + size * 4));

  const cx = size / 2;
  const cy = size / 2;
  const rx = size * 0.45;
  const ry = size * 0.45;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * (1 + size * 4);
    rawData[rowOffset] = 0; // filter: none

    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * 4;
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= 1.05) {
        // Inside the pill shape
        // Gradient from indigo (99,102,241) to purple (168,85,247)
        const t = (y / size);
        const r = Math.floor(99 + t * 69);
        const g = Math.floor(102 - t * 17);
        const b = Math.floor(241 + t * 6);

        // Edge glow
        const edgeAlpha = dist > 0.85 ? (1.05 - dist) / 0.2 : 1;

        rawData[px] = r;     // R
        rawData[px + 1] = g; // G
        rawData[px + 2] = b; // B
        rawData[px + 3] = Math.floor(255 * edgeAlpha); // A
      } else {
        // Transparent
        rawData[px] = 0;
        rawData[px + 1] = 0;
        rawData[px + 2] = 0;
        rawData[px + 3] = 0;
      }
    }
  }

  // Compress with zlib (deflate)
  const zlib = require('zlib');
  return zlib.deflateSync(rawData);
}

function generateIcon() {
  const ihdr = createIHDR();
  const compressedData = createImageData();
  const idat = createChunk('IDAT', compressedData);
  const iend = createChunk('IEND', Buffer.alloc(0));

  const png = Buffer.concat([signature, ihdr, idat, iend]);

  const outPath = path.join(__dirname, '..', 'assets', 'icon.png');
  fs.writeFileSync(outPath, png);
  console.log(`Icon generated: ${outPath} (${png.length} bytes)`);
}

generateIcon();

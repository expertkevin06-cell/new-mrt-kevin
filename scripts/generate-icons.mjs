import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public', 'icons');

fs.mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);

  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

function png(width, height, renderPixel) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const raw = Buffer.alloc(height * (1 + width * 4));
  let pos = 0;

  for (let y = 0; y < height; y++) {
    raw[pos++] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const px = renderPixel(x, y);
      raw[pos++] = px[0] & 255;
      raw[pos++] = px[1] & 255;
      raw[pos++] = px[2] & 255;
      raw[pos++] = px[3] & 255;
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 });
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', iend)
  ]);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function over(dst, src) {
  const sa = src[3] / 255;
  if (sa === 0) return dst;

  const da = dst[3] / 255;
  const oa = sa + da * (1 - sa);

  if (oa === 0) return [0, 0, 0, 0];

  const r = (src[0] * sa + dst[0] * da * (1 - sa)) / oa;
  const g = (src[1] * sa + dst[1] * da * (1 - sa)) / oa;
  const b = (src[2] * sa + dst[2] * da * (1 - sa)) / oa;

  return [
    Math.round(r),
    Math.round(g),
    Math.round(b),
    Math.round(oa * 255)
  ];
}

function sdRoundRect(x, y, w, h, r) {
  const qx = Math.abs(x - w / 2) - (w / 2 - r);
  const qy = Math.abs(y - h / 2) - (h / 2 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdRect(x, y, cx, cy, hw, hh) {
  return Math.max(Math.abs(x - cx) - hw, Math.abs(y - cy) - hh);
}

function alphaFromSd(sd) {
  return clamp(0.5 - sd, 0, 1);
}

function drawPixel(x, y, size, maskable) {
  const scale = size / 512;
  const cx = size / 2;
  const cy = size / 2;

  const blue = [30, 64, 175, 255];
  const white = [248, 250, 252, 255];

  let px = maskable ? blue.slice() : [0, 0, 0, 0];

  if (!maskable) {
    const radius = 96 * scale;
    const bgAlpha = alphaFromSd(sdRoundRect(x, y, size, size, radius));
    if (bgAlpha > 0) {
      px = over(px, [blue[0], blue[1], blue[2], Math.round(bgAlpha * 255)]);
    }
  }

  const outerR = (maskable ? 112 : 150) * scale;
  const innerR = (maskable ? 70 : 95) * scale;
  const barW = (maskable ? 28 : 36) * scale;
  const barL = (maskable ? 200 : 272) * scale;

  const dist = Math.hypot(x - cx, y - cy);

  const outerAlpha = clamp(outerR - dist + 0.5, 0, 1);
  if (outerAlpha > 0) {
    px = over(px, [white[0], white[1], white[2], Math.round(outerAlpha * 255)]);
  }

  const innerAlpha = clamp(innerR - dist + 0.5, 0, 1);
  if (innerAlpha > 0) {
    px = over(px, [blue[0], blue[1], blue[2], Math.round(innerAlpha * 255)]);
  }

  const verticalAlpha = alphaFromSd(sdRect(x, y, cx, cy, barW / 2, barL / 2));
  const horizontalAlpha = alphaFromSd(sdRect(x, y, cx, cy, barL / 2, barW / 2));
  const barAlpha = Math.max(verticalAlpha, horizontalAlpha);

  if (barAlpha > 0) {
    px = over(px, [white[0], white[1], white[2], Math.round(barAlpha * 255)]);
  }

  return px;
}

function write(name, buffer) {
  const file = path.join(outDir, name);
  fs.writeFileSync(file, buffer);
  console.log(`✅ Icône générée : public/icons/${name}`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#1e40af"/>
  <circle cx="256" cy="256" r="150" fill="#f8fafc"/>
  <circle cx="256" cy="256" r="95" fill="#1e40af"/>
  <rect x="238" y="120" width="36" height="272" rx="18" fill="#f8fafc"/>
  <rect x="120" y="238" width="272" height="36" rx="18" fill="#f8fafc"/>
</svg>
`;

fs.writeFileSync(path.join(outDir, 'icon.svg'), svg, 'utf8');
console.log('✅ Icône générée : public/icons/icon.svg');

write('icon-192.png', png(192, 192, (x, y) => drawPixel(x + 0.5, y + 0.5, 192, false)));
write('icon-512.png', png(512, 512, (x, y) => drawPixel(x + 0.5, y + 0.5, 512, false)));
write('icon-maskable-192.png', png(192, 192, (x, y) => drawPixel(x + 0.5, y + 0.5, 192, true)));
write('icon-maskable-512.png', png(512, 512, (x, y) => drawPixel(x + 0.5, y + 0.5, 512, true)));
write('apple-touch-icon.png', png(180, 180, (x, y) => drawPixel(x + 0.5, y + 0.5, 180, false)));

console.log('\n✅ Génération des icônes PWA terminée.');

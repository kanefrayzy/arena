// Generate Arena1v1 PWA icons (192, 512, maskable) as PNGs via pngjs.
// Renders: dark rounded-square background + cyan "A1" glyph (drawn pixel-by-pixel
// using a simple bitmap font + filled circle + chevron accents).
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const BG = [0x0b, 0x0d, 0x12, 0xff];
const SURFACE = [0x14, 0x18, 0x21, 0xff];
const ACCENT = [0x00, 0xe0, 0xff, 0xff];

function setPx(png, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) << 2;
  // alpha-over compositing (simple)
  if (a === 0xff) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 0xff;
    return;
  }
  const da = png.data[i + 3] / 255;
  const sa = a / 255;
  const oa = sa + da * (1 - sa);
  png.data[i] = Math.round((r * sa + png.data[i] * da * (1 - sa)) / oa);
  png.data[i + 1] = Math.round((g * sa + png.data[i + 1] * da * (1 - sa)) / oa);
  png.data[i + 2] = Math.round((b * sa + png.data[i + 2] * da * (1 - sa)) / oa);
  png.data[i + 3] = Math.round(oa * 255);
}

function fillRect(png, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPx(png, x, y, color);
}

function fillRoundedRect(png, x0, y0, w, h, r, color) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // corner check
      let inside = true;
      if (x < r && y < r) inside = (r - x) * (r - x) + (r - y) * (r - y) <= r * r;
      else if (x >= w - r && y < r) inside = (x - (w - r - 1)) * (x - (w - r - 1)) + (r - y) * (r - y) <= r * r;
      else if (x < r && y >= h - r) inside = (r - x) * (r - x) + (y - (h - r - 1)) * (y - (h - r - 1)) <= r * r;
      else if (x >= w - r && y >= h - r) inside = (x - (w - r - 1)) * (x - (w - r - 1)) + (y - (h - r - 1)) * (y - (h - r - 1)) <= r * r;
      if (inside) setPx(png, x0 + x, y0 + y, color);
    }
  }
}

function fillCircle(png, cx, cy, r, color) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) setPx(png, cx + x, cy + y, color);
    }
  }
}

function strokeCircle(png, cx, cy, r, w, color) {
  const r2 = r * r;
  const ri = (r - w) * (r - w);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = x * x + y * y;
      if (d <= r2 && d >= ri) setPx(png, cx + x, cy + y, color);
    }
  }
}

// Crosshair / arena emblem
function drawEmblem(png, cx, cy, size, color) {
  const r = Math.round(size * 0.42);
  const ringW = Math.max(2, Math.round(size * 0.06));
  strokeCircle(png, cx, cy, r, ringW, color);

  // Inner dot
  fillCircle(png, cx, cy, Math.round(size * 0.06), color);

  // 4 tick marks (N/E/S/W)
  const tickLen = Math.round(size * 0.12);
  const tickW = Math.max(2, Math.round(size * 0.05));
  const inner = r - ringW - 2;
  // top
  fillRect(png, cx - Math.floor(tickW / 2), cy - inner - tickLen, tickW, tickLen, color);
  // bottom
  fillRect(png, cx - Math.floor(tickW / 2), cy + inner + 2, tickW, tickLen, color);
  // left
  fillRect(png, cx - inner - tickLen, cy - Math.floor(tickW / 2), tickLen, tickW, color);
  // right
  fillRect(png, cx + inner + 2, cy - Math.floor(tickW / 2), tickLen, tickW, color);
}

function makeIcon(size, opts = {}) {
  const png = new PNG({ width: size, height: size });
  const safe = opts.maskable ? Math.round(size * 0.1) : 0; // safe-zone padding
  // Background (rounded for non-maskable, full for maskable)
  if (opts.maskable) {
    fillRect(png, 0, 0, size, size, BG);
  } else {
    const radius = Math.round(size * 0.18);
    fillRoundedRect(png, 0, 0, size, size, radius, BG);
  }
  // Inner soft surface ring
  const innerSize = size - safe * 2;
  const innerR = Math.round(innerSize * 0.46);
  strokeCircle(png, size / 2, size / 2, innerR, Math.max(1, Math.round(size * 0.015)), [0x14, 0x18, 0x21, 0xff]);

  // Emblem
  drawEmblem(png, Math.round(size / 2), Math.round(size / 2), innerSize, ACCENT);

  return PNG.sync.write(png);
}

const targets = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-maskable-512.png', size: 512, maskable: true },
  { name: 'apple-touch-icon.png', size: 180, maskable: false },
];

const outDir = resolve(process.argv[2] || './public/icons');
mkdirSync(outDir, { recursive: true });
for (const t of targets) {
  const buf = makeIcon(t.size, { maskable: t.maskable });
  const p = resolve(outDir, t.name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
  console.log(`wrote ${p} (${buf.length} bytes)`);
}

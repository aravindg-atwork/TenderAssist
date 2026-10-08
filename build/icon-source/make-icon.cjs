// Renders the TenderAssist app icon (Speed Post: postbox-red tile, date-postmark
// ring, TA in Barlow Condensed) and packs build/icon.ico and build/icon.png.
// Run: npx electron build/icon-source/make-icon.cjs
// The SVG is drawn onto a canvas at each size (true transparency, no screen
// capture). Small sizes (16, 24) use a simpler drawing without the ring.
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const root = join(__dirname, '..', '..');
const font = readFileSync(join(root, 'node_modules', '@fontsource', 'barlow-condensed', 'files', 'barlow-condensed-latin-700-normal.woff2')).toString('base64');

const tile = `
  <defs>
    <style>@font-face { font-family: BC; font-weight: 700; src: url(data:font/woff2;base64,${font}) format('woff2'); }</style>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e3382f"/>
      <stop offset="1" stop-color="#bd221b"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="0.5" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="48" y="48" width="928" height="928" rx="212" fill="url(#g)"/>
  <rect x="48" y="48" width="928" height="928" rx="212" fill="url(#sheen)"/>
  <rect x="49.5" y="49.5" width="925" height="925" rx="210.5" fill="none" stroke="#8f1812" stroke-opacity="0.35" stroke-width="3"/>`;

const DETAILED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${tile}
  <circle cx="512" cy="512" r="318" fill="none" stroke="#fff" stroke-width="30"/>
  <circle cx="512" cy="512" r="262" fill="none" stroke="#fff" stroke-width="12" stroke-dasharray="26 20" stroke-opacity="0.9"/>
  <text x="512" y="652" text-anchor="middle" font-family="BC" font-weight="700" font-size="400" letter-spacing="6" fill="#fff">TA</text>
</svg>`;

const SIMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${tile}
  <text x="512" y="720" text-anchor="middle" font-family="BC" font-weight="700" font-size="620" letter-spacing="10" fill="#fff">TA</text>
</svg>`;

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512];

// Runs in the page: draws each SVG onto a canvas at each size and returns PNG data URLs.
const drawAll = (detailed, simple, sizes) => `(async () => {
  const load = (svg) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('svg did not load'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
  const [big, small] = await Promise.all([load(${JSON.stringify(detailed)}), load(${JSON.stringify(simple)})]);
  await new Promise((r) => setTimeout(r, 300));
  const out = {};
  for (const size of ${JSON.stringify(sizes)}) {
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(size <= 24 ? small : big, 0, 0, size, size);
    out[size] = canvas.toDataURL('image/png');
  }
  return out;
})()`;

function packIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((png) => png.data)]);
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({ width: 200, height: 200, show: false, webPreferences: { backgroundThrottling: false } });
    await win.loadURL('data:text/html;charset=utf-8,<!doctype html><html><body></body></html>');
    const urls = await win.webContents.executeJavaScript(drawAll(DETAILED, SIMPLE, SIZES));
    const png = (size) => Buffer.from(urls[size].split(',')[1], 'base64');
    const icoSizes = SIZES.filter((size) => size <= 256);
    writeFileSync(join(root, 'build', 'icon.ico'), packIco(icoSizes.map((size) => ({ size, data: png(size) }))));
    writeFileSync(join(root, 'build', 'icon.png'), png(512));
    for (const size of SIZES) writeFileSync(join(__dirname, `preview-${size}.png`), png(size));
    console.log('ICON written', icoSizes.join(','), '+ icon.png 512');
  } catch (error) {
    console.error('ICON failed', error);
    process.exitCode = 1;
  }
  app.quit();
});

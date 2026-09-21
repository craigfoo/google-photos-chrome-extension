#!/usr/bin/env node
// Render the Chrome Web Store listing assets into store/:
//
//   screenshot-1-context-menu.png   1280x800
//   screenshot-2-uploading.png      1280x800
//   screenshot-3-success-dark.png   1280x800
//   screenshot-4-options.png        1280x800
//   promo-small-440x280.png         small promo tile
//   promo-marquee-1400x560.png      marquee promo tile
//
// The screenshots are mock browser windows around a sample page; the toast in
// them is the real src/toast.js, driven exactly as the service worker drives
// it. The sample photo is procedural SVG so no third-party image is shipped.
//
// Needs playwright-core and a Chromium/Chrome binary:
//   npm install --no-save playwright-core
//   CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe" node scripts/make-store-assets.mjs
// (on Linux/macOS set CHROME_PATH to your chrome/chromium executable.)

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'store');
const { STRINGS } = await import(path.join(ROOT, 'src/strings.js'));
const toastSrc = fs.readFileSync(path.join(ROOT, 'src/toast.js'), 'utf8');
const icon128 = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'icons/icon128.png')).toString('base64');
const icon16 = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'icons/icon16.png')).toString('base64');

const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;

// ---------------------------------------------------------------------------
// Sample photo (procedural, so the listing ships no third-party image)
// ---------------------------------------------------------------------------

const photoSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 560">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3b6fd6"/><stop offset="0.55" stop-color="#8fb6f2"/><stop offset="1" stop-color="#f9c9a3"/>
    </linearGradient>
    <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7fa9e6"/><stop offset="1" stop-color="#2f5aa8"/>
    </linearGradient>
  </defs>
  <rect width="900" height="560" fill="url(#sky)"/>
  <circle cx="690" cy="160" r="54" fill="#fff1b8"/>
  <polygon points="0,380 140,210 250,320 330,190 460,360 560,230 700,370 800,260 900,340 900,420 0,420" fill="#6f83b3"/>
  <polygon points="0,420 120,300 220,380 340,250 470,400 590,300 720,410 830,330 900,400 900,440 0,440" fill="#4a5c8c"/>
  <polygon points="330,190 300,236 360,236" fill="#ffffff"/>
  <polygon points="560,230 532,272 590,272" fill="#ffffff"/>
  <polygon points="140,210 118,246 164,246" fill="#ffffff"/>
  <polygon points="0,440 200,420 420,450 640,425 900,445 900,560 0,560" fill="#2e3d66"/>
  <rect y="450" width="900" height="110" fill="url(#lake)"/>
  <polygon points="60,470 90,400 120,470" fill="#1f2c4d"/><polygon points="110,478 150,388 190,478" fill="#1f2c4d"/>
  <polygon points="770,475 800,405 830,475" fill="#1f2c4d"/><polygon points="820,480 855,395 890,480" fill="#1f2c4d"/>
</svg>`;
const photoUrl = 'data:image/svg+xml;utf8,' + encodeURIComponent(photoSvg);

// ---------------------------------------------------------------------------
// Mock browser + page
// ---------------------------------------------------------------------------

function browserMock({ dark, badge, badgeColor, caption, body, extraCss = '' }) {
  const c = dark
    ? { frame: '#202124', tab: '#35363a', bar: '#35363a', omni: '#202124', text: '#e8eaed', muted: '#9aa0a6', page: '#202124', pageText: '#e8eaed', pageMuted: '#9aa0a6', card: '#2d2e31', rule: '#3c4043' }
    : { frame: '#dee1e6', tab: '#ffffff', bar: '#ffffff', omni: '#f1f3f4', text: '#202124', muted: '#5f6368', page: '#ffffff', pageText: '#202124', pageMuted: '#5f6368', card: '#ffffff', rule: '#e8eaed' };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; font-family: ${FONT}; color: ${c.pageText}; background: ${c.page}; }
    .chrome { height: 88px; background: ${c.frame}; }
    .tabs { height: 40px; display: flex; align-items: flex-end; padding: 0 8px; }
    .tab { height: 34px; width: 300px; background: ${c.tab}; border-radius: 8px 8px 0 0; display: flex; align-items: center; gap: 8px; padding: 0 12px; font-size: 12px; color: ${c.text}; white-space: nowrap; overflow: hidden; }
    .tab .fav { width: 16px; height: 16px; border-radius: 4px; background: linear-gradient(135deg, #4285f4, #34a853); }
    .toolbar { height: 48px; background: ${c.bar}; display: flex; align-items: center; padding: 0 12px; gap: 14px; }
    .nav { color: ${c.muted}; font-size: 18px; letter-spacing: 6px; }
    .omni { flex: 1; height: 32px; background: ${c.omni}; border-radius: 16px; display: flex; align-items: center; padding: 0 14px; font-size: 13px; color: ${c.text}; gap: 8px; }
    .omni .lock { color: ${c.muted}; font-size: 12px; }
    .ext { position: relative; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; }
    .ext img { width: 16px; height: 16px; }
    .badge { position: absolute; right: 0; bottom: 1px; min-width: 14px; height: 13px; padding: 0 3px; border-radius: 3px; background: ${badgeColor || '#188038'}; color: #fff; font-size: 9px; font-weight: 700; line-height: 13px; text-align: center; }
    .puzzle { color: ${c.muted}; font-size: 16px; }
    .avatar { width: 26px; height: 26px; border-radius: 13px; background: linear-gradient(135deg, #f6b73c, #ea4335); }
    .dots { color: ${c.muted}; font-size: 18px; writing-mode: vertical-lr; }
    .page { position: relative; height: 712px; }
    .site { max-width: 980px; margin: 0 auto; padding: 100px 40px 24px; }
    .masthead { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 1px solid ${c.rule}; padding-bottom: 14px; margin-bottom: 26px; }
    .masthead .brand { font-weight: 700; font-size: 18px; letter-spacing: 0.5px; }
    .masthead nav { color: ${c.pageMuted}; font-size: 14px; display: flex; gap: 22px; }
    h1 { font-size: 34px; margin: 0 0 8px; line-height: 1.15; }
    .byline { color: ${c.pageMuted}; font-size: 14px; margin-bottom: 20px; }
    .photo { width: 900px; height: 360px; object-fit: cover; border-radius: 10px; display: block; }
    p.lede { font-size: 17px; line-height: 1.6; max-width: 760px; margin: 20px 0 0; }
    .caption { position: absolute; left: 40px; top: 24px; z-index: 5; background: ${c.card}; color: ${c.pageText}; padding: 16px 22px; border-radius: 14px; font-size: 26px; font-weight: 700; box-shadow: 0 10px 30px rgba(0,0,0,${dark ? 0.5 : 0.16}); display: flex; align-items: center; gap: 14px; }
    .caption img { width: 36px; height: 36px; border-radius: 9px; }
    /* Chrome-style context menu */
    .menu { position: absolute; z-index: 6; width: 262px; background: ${dark ? '#292a2d' : '#ffffff'}; color: ${c.text}; border: 1px solid ${dark ? '#3c4043' : '#c7c7c7'}; box-shadow: 0 6px 20px rgba(0,0,0,0.25); padding: 6px 0; font-size: 13px; border-radius: 4px; }
    .menu div { height: 28px; display: flex; align-items: center; padding: 0 12px 0 34px; position: relative; }
    .menu div.sep { height: 1px; margin: 5px 1px; padding: 0; background: ${dark ? '#3c4043' : '#e3e3e3'}; }
    .menu div.hl { background: ${dark ? '#3c4043' : '#e8e8e8'}; }
    .menu div img { position: absolute; left: 10px; width: 16px; height: 16px; }
    .cursor { position: absolute; z-index: 7; width: 22px; height: 22px; }
    ${extraCss}
  </style></head><body>
  <div class="chrome">
    <div class="tabs"><div class="tab"><span class="fav"></span>Field Notes — A week in the Dolomites</div></div>
    <div class="toolbar">
      <span class="nav">‹ › ↻</span>
      <div class="omni"><span class="lock">🔒</span>fieldnotes.example/dolomites</div>
      <div class="ext"><img src="${icon16}">${badge ? `<span class="badge">${badge}</span>` : ''}</div>
      <span class="puzzle">🧩</span>
      <span class="avatar"></span>
      <span class="dots">⋯</span>
    </div>
  </div>
  <div class="page">
    ${caption ? `<div class="caption"><img src="${icon128}">${caption}</div>` : ''}
    ${body}
  </div>
  </body></html>`;
}

const article = `
  <div class="site">
    <div class="masthead"><span class="brand">FIELD NOTES</span><nav><span>Trips</span><span>Gear</span><span>Maps</span><span>About</span></nav></div>
    <h1>A week in the Dolomites, on foot</h1>
    <div class="byline">Seven days, four rifugios, one very tired pair of boots.</div>
    <img class="photo" src="${photoUrl}" alt="">
    <p class="lede">We left the car at Passo Falzarego before sunrise and did not see it again until the following Sunday. What follows is less a guide than a set of notes on light, weather and which hut serves the best strudel.</p>
  </div>`;

const contextMenu = (x, y) => `
  <div class="menu" style="left:${x}px; top:${y}px">
    <div>Open image in new tab</div>
    <div>Save image as…</div>
    <div>Copy image</div>
    <div>Copy image address</div>
    <div class="sep"></div>
    <div class="hl"><img src="${icon16}">${STRINGS.menuTitle}</div>
    <div class="sep"></div>
    <div>Inspect</div>
  </div>
  <svg class="cursor" style="left:${x - 6}px; top:${y - 8}px" viewBox="0 0 24 24"><path d="M5 3l14 9-6 1.5L16 20l-3 1.5-3-6.5L5 19z" fill="#fff" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

// ---------------------------------------------------------------------------
// Promo tiles
// ---------------------------------------------------------------------------

function promoTile({ w, h, titleSize, tagSize, iconSize, showToast }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; font-family: ${FONT}; }
    body { background: linear-gradient(135deg, #e8f0fe 0%, #ffffff 45%, #fef7e0 100%); display: flex; align-items: center; justify-content: center; }
    .wrap { display: flex; align-items: center; gap: ${Math.round(iconSize * 0.3)}px; padding: 0 ${Math.round(w * 0.06)}px; }
    .icon { width: ${iconSize}px; height: ${iconSize}px; border-radius: ${Math.round(iconSize * 0.22)}px; box-shadow: 0 ${Math.round(iconSize * 0.1)}px ${Math.round(iconSize * 0.3)}px rgba(26, 115, 232, 0.28); flex: 0 0 auto; }
    h1 { margin: 0 0 6px; font-size: ${titleSize}px; color: #202124; letter-spacing: -0.5px; line-height: 1.05; }
    p { margin: 0; font-size: ${tagSize}px; color: #5f6368; line-height: 1.35; }
    .toast { margin-top: ${Math.round(tagSize * 1.2)}px; display: inline-flex; align-items: center; gap: 12px; background: #fff; border-radius: 12px; padding: 12px 16px 12px 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.14); border-bottom: 3px solid #188038; }
    .toast img { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; }
    .toast b { display: block; color: #188038; font-size: ${Math.round(tagSize * 0.85)}px; }
    .toast span { color: #1a73e8; font-size: ${Math.round(tagSize * 0.75)}px; font-weight: 600; }
  </style></head><body>
    <div class="wrap">
      <img class="icon" src="${icon128}">
      <div>
        <h1>Upload to Google Photos</h1>
        <p>Right-click any image. It's in your library seconds later.</p>
        ${showToast ? `<div class="toast"><img src="${photoUrl}"><div><b>${STRINGS.toast.success}</b><span>${STRINGS.toast.openLink}</span></div></div>` : ''}
      </div>
    </div>
  </body></html>`;
}

// ---------------------------------------------------------------------------
// Options page, served over http so its ES module import works
// ---------------------------------------------------------------------------

function serveRepo(extraPages = {}) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    const route = req.url.split('?')[0];
    if (extraPages[route]) { res.setHeader('Content-Type', 'text/html'); return res.end(extraPages[route]); }
    const file = path.join(ROOT, decodeURIComponent(route));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function optionsMock(dark, port) {
  const c = dark ? { bg: '#202124', card: '#2d2e31', text: '#e8eaed', muted: '#9aa0a6' } : { bg: '#f1f3f4', card: '#ffffff', text: '#202124', muted: '#5f6368' };
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; font-family: ${FONT}; background: ${c.bg}; }
    .caption { position: absolute; left: 40px; top: 40px; background: ${c.card}; color: ${c.text}; padding: 16px 22px; border-radius: 14px; font-size: 26px; font-weight: 700; box-shadow: 0 10px 30px rgba(0,0,0,0.16); display: flex; align-items: center; gap: 14px; }
    .caption img { width: 36px; height: 36px; border-radius: 9px; }
    .dialog { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 560px; background: ${c.card}; border-radius: 16px; box-shadow: 0 24px 60px rgba(0,0,0,0.22); overflow: hidden; }
    .dialog .head { display: flex; align-items: center; gap: 12px; padding: 18px 24px; border-bottom: 1px solid rgba(128,128,128,0.2); color: ${c.text}; font-size: 15px; }
    .dialog .head img { width: 24px; height: 24px; border-radius: 6px; }
    .dialog .head .x { margin-left: auto; color: ${c.muted}; font-size: 20px; }
    iframe { display: block; width: 560px; height: 440px; border: 0; }
    .note { position: absolute; left: 50%; transform: translateX(-50%); bottom: 36px; color: ${c.muted}; font-size: 16px; }
  </style></head><body>
    <div class="caption"><img src="${icon128}">Optional: file every upload into an album</div>
    <div class="dialog">
      <div class="head"><img src="${icon128}">Upload to Google Photos <span class="x">×</span></div>
      <iframe src="http://127.0.0.1:${port}/src/options.html"></iframe>
    </div>
    <div class="note">Looked up by name, created if missing, cached after that.</div>
  </body></html>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const executablePath = process.env.CHROME_PATH || undefined;
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
fs.mkdirSync(OUT, { recursive: true });

// Stub of the chrome.* surface the toast and the options page touch.
function chromeStub() {
  const store = { albumEnabled: true, albumName: 'From the web' };
  window.chrome = {
    runtime: { onMessage: { addListener: (fn) => { window.__gpListener = fn; } }, sendMessage() {} },
    storage: { sync: { get: async (d) => ({ ...d, ...store }), set: async () => {} } },
  };
}

async function shot(name, html, { w = 1280, h = 800, dark = false, toast = null, url = null, onReady = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: dark ? 'dark' : 'light', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  if (url) {
    // Real navigation, so the init script also reaches the options iframe.
    await page.addInitScript(chromeStub);
    await page.goto(url, { waitUntil: 'networkidle' });
  } else {
    await page.setContent(html, { waitUntil: 'load' });
  }
  if (toast) {
    await page.evaluate(chromeStub);
    await page.addScriptTag({ content: toastSrc });
    for (const message of toast) await page.evaluate((m) => window.__gpListener(m), message);
    await page.waitForTimeout(500);
  }
  if (onReady) await onReady(page);
  await page.screenshot({ path: path.join(OUT, name) });
  await ctx.close();
  console.log('wrote store/' + name);
}

const labels = STRINGS.toast;

await shot('screenshot-1-context-menu.png', browserMock({
  caption: 'Right-click any image → Upload to Google Photos',
  body: article + contextMenu(640, 380),
}));

await shot('screenshot-2-uploading.png', browserMock({
  caption: 'Watch it upload, right on the page',
  badge: '…', badgeColor: '#1a73e8',
  body: article,
}), { toast: [{ type: 'GP_TOAST', uploadId: 'a', state: 'uploading', thumbnail: photoUrl, labels }] });

await shot('screenshot-3-success-dark.png', browserMock({
  dark: true,
  caption: 'Done. One click opens it in Google Photos.',
  badge: '✓',
  body: article,
}), {
  dark: true,
  toast: [
    { type: 'GP_TOAST', uploadId: 'a', state: 'uploading', thumbnail: photoUrl, labels },
    { type: 'GP_TOAST', uploadId: 'a', state: 'success', url: 'https://photos.google.com', labels },
  ],
});

// The options mock needs its port baked in, so register the page after listen.
const extraPages = {};
const { server, port } = await serveRepo(extraPages);
extraPages['/__options-mock.html'] = optionsMock(false, port);
await shot('screenshot-4-options.png', null, {
  url: `http://127.0.0.1:${port}/__options-mock.html`,
  onReady: async (page) => { await page.waitForTimeout(600); },
});
server.close();

await shot('promo-small-440x280.png', promoTile({ w: 440, h: 280, titleSize: 30, tagSize: 16, iconSize: 96, showToast: false }), { w: 440, h: 280 });
await shot('promo-marquee-1400x560.png', promoTile({ w: 1400, h: 560, titleSize: 64, tagSize: 28, iconSize: 220, showToast: true }), { w: 1400, h: 560 });

await browser.close();

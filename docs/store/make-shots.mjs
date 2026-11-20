// Renders the Chrome Web Store images into docs/store/:
//   screenshot-1.png … screenshot-5.png   1280x800, from shots.html?n=1 … 5
//   promo-small.png                       440x280, from promo.html
//   app-1.png … app-5.png                 the product alone (no headline), at 2x,
//                                         for the website
// The screenshots run the real popup on sample data (tests/ui/demo.html), so
// re-run this after a UI change:  node docs/store/make-shots.mjs
//
// Driven over the DevTools protocol rather than --screenshot, because headless
// Chrome's page is shorter than its window and the images came out with an
// empty strip; here the page size is set exactly.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const pw = join(homedir(), '.cache/ms-playwright');
const chrome = process.env.CHROME || [
  ...(existsSync(pw) ? readdirSync(pw).filter((d) => d.startsWith('chromium-')).map((d) => join(pw, d, 'chrome-linux64/chrome')) : []),
  '/usr/bin/chromium', '/usr/bin/google-chrome'
].find(existsSync);
if (!chrome) { console.error('No Chrome found; set CHROME=/path/to/chrome'); process.exit(1); }

const profile = mkdtempSync(join(tmpdir(), 'desksync-shots-'));
const port = 9400 + Math.floor(Math.random() * 400);
const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--user-data-dir=${profile}`, '--allow-file-access-from-files', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 80 && !target; i++) {
  await sleep(150);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let n = 0; const pending = new Map();
ws.addEventListener('message', (m) => { const x = JSON.parse(m.data); if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++n; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');

async function shoot(url, width, height, out, bare = null) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: bare ? 2 : 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(3500);                     // the popup inside boots and settles
  let clip = { x: 0, y: 0, width, height, scale: 1 };
  if (bare) {
    // Just the product: the frame beside the headline.
    const r = await send('Runtime.evaluate', { expression: `JSON.stringify(document.querySelector('${bare}').getBoundingClientRect())`, returnByValue: true });
    const b = JSON.parse(r.result.result.value);
    clip = { x: b.x, y: b.y, width: b.width, height: b.height, scale: 1 };
  }
  const r = await send('Page.captureScreenshot', { format: 'png', clip });
  writeFileSync(out, Buffer.from(r.result.data, 'base64'));
  console.log('  ' + out);
}

try {
  for (let i = 1; i <= 5; i++) await shoot(`file://${here}/shots.html?n=${i}`, 1280, 800, join(here, `screenshot-${i}.png`));
  await shoot(`file://${here}/promo.html`, 440, 280, join(here, 'promo-small.png'));
  for (let i = 1; i <= 5; i++) await shoot(`file://${here}/shots.html?n=${i}`, 1280, 800, join(here, `app-${i}.png`), '.frame');
} finally {
  ws.close(); proc.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}

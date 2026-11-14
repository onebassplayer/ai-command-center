// Browser check for the "Download prompt (.txt)" button (app.mjs download handler).
// Run: node --test tests/browser/
// Needs Playwright with Chromium. Skips cleanly when Playwright is not installed,
// so the dependency-free suite (node --test tests/*.test.mjs) is unaffected.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, join, normalize} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const root = fileURLToPath(new URL('../../', import.meta.url));
const types = {'.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.md': 'text/markdown', '.svg': 'image/svg+xml', '.png': 'image/png'};

let chromium = null;
try { ({chromium} = createRequire(import.meta.url)('playwright')); } catch { /* skipped below */ }
const skip = chromium ? false : 'Playwright is not installed';

function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    const file = join(root, path || 'index.html');
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try { res.writeHead(200, {'content-type': types[extname(file)] ?? 'application/octet-stream'}).end(await readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function openApp(t, initScript) {
  const server = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); server.close(); });
  const context = await browser.newContext({acceptDownloads: true});
  // Keep the check offline: block anything not served by the local server.
  await context.route(url => !url.href.startsWith(`http://127.0.0.1:${server.address().port}/`), route => route.abort());
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
  await page.waitForSelector('#workspace:not([hidden])');
  return {page, errors};
}

test('download is disabled until the prompt is valid', {skip}, async t => {
  const {page, errors} = await openApp(t);
  assert.equal(await page.isDisabled('#download'), true);
  assert.equal(await page.inputValue('#preview'), '');
  assert.deepEqual(errors, []);
});

test('downloaded .txt is byte-for-byte the full preview and the URL is not revoked early', {skip}, async t => {
  const {page, errors} = await openApp(t, () => {
    window.__revoked = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = u => { window.__revoked.push(u); revoke(u); };
  });
  await page.click('#try-example');
  // Non-ASCII material must survive the UTF-8 Blob unchanged.
  await page.fill('#material', 'Café rollout plan — “quoted” text, emoji 🚀, and <tags> & ampersands.');
  assert.equal(await page.isDisabled('#download'), false);
  const preview = await page.inputValue('#preview');
  assert.ok(preview.includes('Café rollout plan'));
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  assert.equal(download.suggestedFilename(), 'jigbench-prompt.txt');
  const saved = await readFile(await download.path(), 'utf8');
  assert.equal(saved, preview);
  assert.match(await page.textContent('#copy-status'), /Download requested: jigbench-prompt\.txt/);
  assert.equal(await page.evaluate(() => document.querySelectorAll('a[download]').length), 0, 'temporary link is removed');
  assert.deepEqual(await page.evaluate(() => window.__revoked), [], 'object URL must outlive the click');
  assert.deepEqual(errors, []);
});

test('a failed download shows a recoverable error instead of throwing', {skip}, async t => {
  const {page, errors} = await openApp(t, () => { URL.createObjectURL = () => { throw new Error('blocked'); }; });
  await page.click('#try-example');
  await page.click('#download');
  assert.match(await page.textContent('#copy-status'), /Download could not start/);
  assert.equal(await page.evaluate(() => document.getElementById('copy-status').classList.contains('error')), true);
  assert.equal(await page.evaluate(() => document.querySelectorAll('a[download]').length), 0);
  assert.deepEqual(errors, []);
});

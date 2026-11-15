// Browser check for the "Remove hidden workflows" control (app.mjs).
// Run: node --test tests/browser/*.test.mjs
// Needs Playwright with Chromium. Skips cleanly when Playwright is not installed.
// Lives in tests/browser/ so a dependency-free tests/*.test.mjs glob never picks it up.
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
  const context = await browser.newContext();
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

const KEY = 'ai-command-center.workflows.v1';
const seed = stored => `if (!sessionStorage.getItem('seeded')) { localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(stored))}); sessionStorage.setItem('seeded', '1'); }`;
async function currentVersion(id) {
  const commands = JSON.parse(await readFile(join(root, 'commands.json'), 'utf8'));
  const list = Array.isArray(commands) ? commands : commands.commands;
  return list.find(c => c.id === id).version;
}

test('button is hidden when every saved workflow loads', {skip}, async t => {
  const good = {name: 'Good', steps: [{id: 'eli10', version: await currentVersion('eli10')}]};
  const {page, errors} = await openApp(t, seed([good]));
  assert.equal(await page.isVisible('#remove-hidden-workflows'), false);
  assert.deepEqual(errors, []);
});

test('cancel keeps storage; confirm removes only hidden workflows and survives reload', {skip}, async t => {
  const good = {name: 'Good', notes: {task: 'keep me'}, steps: [{id: 'eli10', version: await currentVersion('eli10')}]};
  const stale = {name: 'Stale', steps: [{id: 'eli10', version: '0.0.0-old'}]};
  const gone = {name: 'Gone', steps: [{id: 'no-such-command', version: '1.0.0'}]};
  const {page, errors} = await openApp(t, seed([good, stale, gone]));
  assert.equal(await page.isVisible('#remove-hidden-workflows'), true);
  assert.match(await page.textContent('#workflow-status'), /2 saved workflows could not be loaded/);
  const before = await page.evaluate(k => localStorage.getItem(k), KEY);

  page.once('dialog', d => { assert.match(d.message(), /2 hidden saved workflows/); d.dismiss(); });
  await page.click('#remove-hidden-workflows');
  assert.equal(await page.evaluate(k => localStorage.getItem(k), KEY), before, 'cancel changes nothing');
  assert.equal(await page.isVisible('#remove-hidden-workflows'), true);

  page.once('dialog', d => d.accept());
  await page.click('#remove-hidden-workflows');
  const stored = JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY));
  assert.deepEqual(stored.map(r => r.name), ['Good']);
  assert.equal(stored[0].notes.task, 'keep me');
  assert.equal(await page.isVisible('#remove-hidden-workflows'), false);
  assert.match(await page.textContent('#workflow-status'), /Removed 2 hidden workflows/);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'saved-workflows', 'focus is not dropped to the page body');
  assert.deepEqual(await page.$$eval('#saved-workflows option', o => o.map(x => x.textContent)), ['Choose a workflow', 'Good']);

  await page.reload();
  await page.waitForSelector('#workspace:not([hidden])');
  assert.equal(await page.isVisible('#remove-hidden-workflows'), false);
  assert.doesNotMatch(await page.textContent('#workflow-status'), /could not be loaded/);
  assert.deepEqual(errors, []);
});

test('after removal, a name used only by a hidden workflow can be saved again', {skip}, async t => {
  const stale = {name: 'Reuse me', steps: [{id: 'eli10', version: '0.0.0-old'}]};
  const {page, errors} = await openApp(t, seed([stale]));
  page.on('dialog', d => d.accept());
  await page.click('#remove-hidden-workflows');
  await page.click('#try-example');
  await page.fill('#workflow-name', 'Reuse me');
  await page.click('#save-workflow');
  assert.match(await page.textContent('#workflow-status'), /Saved “Reuse me”/);
  const stored = JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY));
  assert.deepEqual(stored.map(r => r.name), ['Reuse me']);
  assert.notEqual(stored[0].steps[0].version, '0.0.0-old');
  assert.deepEqual(errors, []);
});

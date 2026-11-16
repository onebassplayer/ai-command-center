// Browser check: two tabs editing saved workflows do not overwrite each other (app.mjs).
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

// Two tabs in one browser context share localStorage, like two tabs of jigbench.com.
async function openTabs(t, initScript, {staleA = false} = {}) {
  const server = await serve();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); server.close(); });
  const context = await browser.newContext();
  // Keep the check offline: block anything not served by the local server.
  await context.route(url => !url.href.startsWith(`http://127.0.0.1:${server.address().port}/`), route => route.abort());
  if (initScript) await context.addInitScript(initScript);
  const errors = [];
  const open = async (stale = false) => {
    const page = await context.newPage();
    // A stale tab never hears storage events, as can happen with a slow or suspended background tab.
    if (stale) await page.addInitScript(() => { const add = window.addEventListener; window.addEventListener = function (type, ...rest) { if (type !== 'storage') return add.call(this, type, ...rest); }; });
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`);
    await page.waitForSelector('#workspace:not([hidden])');
    return page;
  };
  const a = await open(staleA);
  const b = await open();
  return {a, b, errors};
}

const KEY = 'ai-command-center.workflows.v1';
// Seed once per context (not per tab), so the second tab does not reset storage.
const seed = stored => `if (!localStorage.getItem('seeded')) { localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(stored))}); localStorage.setItem('seeded', '1'); }`;
const names = async page => JSON.parse(await page.evaluate(k => localStorage.getItem(k), KEY) ?? '[]').map(r => r.name);
const options = page => page.$$eval('#saved-workflows option', o => o.slice(1).map(x => x.textContent));
async function save(page, name) {
  await page.click('#try-example');
  await page.fill('#workflow-name', name);
  await page.click('#save-workflow');
}
async function remove(page, name) {
  const value = await page.$$eval('#saved-workflows option', (o, n) => o.find(x => x.textContent === n)?.value, name);
  await page.selectOption('#saved-workflows', value);
  await page.click('#delete-workflow');
}
async function currentVersion(id) {
  const commands = JSON.parse(await readFile(join(root, 'commands.json'), 'utf8'));
  const list = Array.isArray(commands) ? commands : commands.commands;
  return list.find(c => c.id === id).version;
}


test('saves in two tabs keep both workflows', {skip}, async t => {
  const {a, b, errors} = await openTabs(t, null, {staleA: true});
  await save(b, 'Beta');
  await save(a, 'Alpha');
  assert.deepEqual((await names(a)).sort(), ['Alpha', 'Beta'], 'tab A must not drop the workflow tab B saved');
  assert.match(await a.textContent('#workflow-status'), /Saved “Alpha”/);
  assert.deepEqual(errors, []);
});

test('the other tab list updates when a workflow is saved elsewhere', {skip}, async t => {
  const {a, b, errors} = await openTabs(t);
  await save(b, 'Beta');
  await a.waitForFunction(() => [...document.querySelectorAll('#saved-workflows option')].some(o => o.textContent === 'Beta'));
  assert.deepEqual(await options(a), ['Beta']);
  assert.deepEqual(errors, []);
});

test('delete in one tab keeps a workflow the other tab just saved', {skip}, async t => {
  const v = await currentVersion('eli10');
  const {a, b, errors} = await openTabs(t, seed([{name: 'Old', steps: [{id: 'eli10', version: v}]}]), {staleA: true});
  await save(b, 'Beta');
  assert.deepEqual(await options(a), ['Old'], 'tab A still shows the stale list');
  await remove(a, 'Old');
  assert.deepEqual(await names(a), ['Beta']);
  assert.match(await a.textContent('#workflow-status'), /Workflow deleted/);
  assert.deepEqual(errors, []);
});

test('deleting a workflow already deleted in another tab changes nothing', {skip}, async t => {
  const v = await currentVersion('eli10');
  const {a, b, errors} = await openTabs(t, seed([{name: 'Gone', steps: [{id: 'eli10', version: v}]}, {name: 'Keep', steps: [{id: 'eli10', version: v}]}]), {staleA: true});
  await remove(b, 'Gone');
  const before = await b.evaluate(k => localStorage.getItem(k), KEY);
  await remove(a, 'Gone');
  assert.equal(await a.evaluate(k => localStorage.getItem(k), KEY), before);
  assert.match(await a.textContent('#workflow-status'), /already deleted in another tab/);
  assert.deepEqual(await options(a), ['Keep']);
  assert.deepEqual(errors, []);
});

test('remove hidden keeps a workflow another tab saved meanwhile', {skip}, async t => {
  const stale = {name: 'Stale', steps: [{id: 'eli10', version: '0.0.0-old'}]};
  const {a, b, errors} = await openTabs(t, seed([stale]), {staleA: true});
  await save(b, 'Beta');
  // "Stale" blocks only its own name, so Beta saves fine in tab B.
  assert.deepEqual((await names(b)).sort(), ['Beta', 'Stale']);
  await a.click('#remove-hidden-workflows');
  assert.deepEqual(await names(a), ['Beta']);
  assert.match(await a.textContent('#workflow-status'), /Removed 1 hidden workflow/);
  assert.deepEqual(errors, []);
});

test('corrupt storage written by another tab blocks the write instead of overwriting it', {skip}, async t => {
  const {a, errors} = await openTabs(t, null, {staleA: true});
  await a.evaluate(k => localStorage.setItem(k, '{not json'), KEY);
  await save(a, 'Alpha');
  assert.equal(await a.evaluate(k => localStorage.getItem(k), KEY), '{not json');
  assert.match(await a.textContent('#workflow-status'), /changed in another tab and could not be read/);
  assert.deepEqual(errors, []);
});

test('delete removes only the exact name when older data has names differing by case', {skip}, async t => {
  const v = await currentVersion('eli10');
  const {a, errors} = await openTabs(t, seed([{name: 'Plan', steps: [{id: 'eli10', version: v}]}, {name: 'plan', steps: [{id: 'eli10', version: v}]}]));
  await remove(a, 'plan');
  assert.deepEqual(await names(a), ['Plan']);
  assert.deepEqual(errors, []);
});

test('remove hidden after another tab already removed them writes nothing', {skip}, async t => {
  const stale = {name: 'Stale', steps: [{id: 'eli10', version: '0.0.0-old'}]};
  const {a, b, errors} = await openTabs(t, seed([stale]), {staleA: true});
  await b.click('#remove-hidden-workflows');
  const before = await b.evaluate(k => localStorage.getItem(k), KEY);
  await a.click('#remove-hidden-workflows');
  assert.equal(await a.evaluate(k => localStorage.getItem(k), KEY), before);
  assert.match(await a.textContent('#workflow-status'), /already removed in another tab/);
  assert.equal(await a.isVisible('#remove-hidden-workflows'), false);
  assert.deepEqual(errors, []);
});

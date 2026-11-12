// Google Analytics must not load until the visitor accepts, and only on the public homepage.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../analytics.js', import.meta.url), 'utf8');

function run({hostname = 'jigbench.com', pathname = '/', saved} = {}) {
  const appended = [];
  const listeners = {};
  const el = id => ({id, hidden: true, focus() {}, addEventListener: (t, fn) => { listeners[id] = fn; }});
  const nodes = Object.fromEntries(['analytics-choice', 'analytics-manage', 'analytics-accept', 'analytics-decline'].map(id => [id, el(id)]));
  const store = new Map(saved ? [['moonshot-traffic-consent-v1', JSON.stringify(saved)]] : []);
  const window = {};
  const context = {
    window, URL, URLSearchParams, Date, JSON,
    location: {hostname, pathname, search: '?utm_source=x&email=a@b.c'},
    localStorage: {getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v)},
    document: {
      referrer: '', cookie: '',
      getElementById: id => nodes[id],
      createElement: () => ({}),
      head: {append: s => appended.push(s)}
    }
  };
  vm.runInNewContext(source, context);
  return {appended, nodes, listeners, window, store};
}

test('no gtag script before a choice; the panel is shown', () => {
  const r = run();
  assert.equal(r.appended.length, 0);
  assert.equal(r.nodes['analytics-choice'].hidden, false);
});

test('accepting loads gtag once, with a sanitised page URL', () => {
  const r = run();
  r.listeners['analytics-accept']();
  r.listeners['analytics-accept']();
  assert.equal(r.appended.length, 1);
  assert.match(r.appended[0].src, /googletagmanager\.com\/gtag\/js\?id=G-/);
  const config = r.window.dataLayer.find(args => args[0] === 'config');
  assert.equal(config[2].page_location, 'https://jigbench.com/?utm_source=x');
});

test('declining or a saved decline never loads gtag', () => {
  const r = run();
  r.listeners['analytics-decline']();
  assert.equal(r.appended.length, 0);
  const saved = run({saved: {value: 'declined', expires: Date.now() + 1e6}});
  assert.equal(saved.appended.length, 0);
  assert.equal(saved.nodes['analytics-choice'].hidden, true);
});

test('expired consent asks again instead of loading', () => {
  const r = run({saved: {value: 'accepted', expires: Date.now() - 1}});
  assert.equal(r.appended.length, 0);
  assert.equal(r.nodes['analytics-choice'].hidden, false);
});

test('other hosts and paths never load analytics', () => {
  for (const opts of [{hostname: 'localhost'}, {pathname: '/tests/'}]) {
    const r = run({...opts, saved: {value: 'accepted', expires: Date.now() + 1e6}});
    assert.equal(r.appended.length, 0);
  }
});

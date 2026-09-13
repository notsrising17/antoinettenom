/* Loads the app's script out of index.html and runs it in a context with just
   enough browser to exercise the storage layer. Shared by the test files. */
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1].split('\ninitStore()')[0];

function fakeStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  let fail = false;
  return {
    api: {
      get length() { return map.size; },
      key: i => [...map.keys()][i] ?? null,
      getItem: k => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { if (fail) throw new Error('quota'); map.set(k, String(v)); },
      removeItem: k => { map.delete(k); },
    },
    map,
    fail: v => { fail = v; },
  };
}

/* querySelector returns a distinct stub per selector, the way a real document
   does — so a painter writing to one element cannot mask another. */
function fakeDocument(elements) {
  return {
    visibilityState: 'visible',
    body: {style: {}},
    addEventListener() {},
    querySelectorAll: () => [],
    querySelector: sel => (elements[sel] = elements[sel] || {hidden: true, innerHTML: '', textContent: '', className: ''}),
  };
}

function app(options) {
  const opts = options || {};
  const storage = fakeStorage(opts.storage);
  const elements = {};
  const listeners = {};
  const ctx = vm.createContext({
    console,
    window: {},
    setTimeout: opts.realTimers ? setTimeout : () => 1,
    clearTimeout: opts.realTimers ? clearTimeout : () => {},
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    document: fakeDocument(elements),
    localStorage: storage.api,
  });
  vm.runInContext(source, ctx);
  return {
    ctx,
    run: code => vm.runInContext(code, ctx),
    el: sel => ctx.document.querySelector(sel),
    stored: () => JSON.parse(storage.api.getItem('nominators-ledger-v1')),
    raw: k => storage.api.getItem(k),
    keys: () => [...storage.map.keys()],
    fail: v => storage.fail(v),
    fire: type => (listeners[type] || []).forEach(fn => fn()),
  };
}

module.exports = {app, source};

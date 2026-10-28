// navigation-origin safety and scroll restoration regressions.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(relative, requireForTest, globals = {}) {
  const file = path.resolve(__dirname, '../src', relative);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('require', 'exports', ...Object.keys(globals), js)(requireForTest, exports, ...Object.values(globals));
  return exports;
}
const navigation = load('navigationState.ts', () => {});

test('company returns to its originating map, saved list or agency page', () => {
  for (const [path, label] of [['/company-map', 'Back to map'], ['/saved-lists', 'Back to saved companies'], ['/agency-awards', 'Back to agency awards']]) {
    assert.deepEqual(navigation.companyReturnTarget({ companyOrigin: { path, key: 'origin' } }), { path, label, scrollKey: 'origin' });
  }
});

test('direct detail visits and untrusted return destinations fall back to Companies', () => {
  for (const state of [null, {}, { companyOrigin: { path: 'https://example.com' } }, { companyOrigin: { path: '//example.com' } }]) {
    assert.deepEqual(navigation.companyReturnTarget(state), { path: '/companies', label: 'Back to companies', scrollKey: undefined });
  }
});

test('new navigation starts at the top; POP and explicit return use the correct history entry', () => {
  assert.equal(navigation.scrollRestoreKey('PUSH', 'new', null), undefined);
  assert.equal(navigation.scrollRestoreKey('POP', 'old', null), 'old');
  assert.equal(navigation.scrollRestoreKey('PUSH', 'new', { restoreScrollKey: 'old' }), 'old');
  assert.equal(navigation.scrollRestoreKey('PUSH', 'new', { restoreScrollKey: 123 }), undefined);
});

function scrollHarness() {
  let location, kind, effectIndex, refIndex;
  const effects = [], refs = [], listeners = new Map(), observers = [];
  const win = {
    history: { scrollRestoration: 'auto' }, scrollX: 0, scrollY: 0, maximum: 1000,
    scrollTo({ left, top }) { this.scrollX = left; this.scrollY = Math.min(top, this.maximum); },
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
  };
  const react = {
    useRef(value) { const index = refIndex++; return refs[index] ??= { current: value }; },
    useLayoutEffect(effect, deps) {
      const index = effectIndex++, previous = effects[index];
      if (previous && deps.every((value, i) => value === previous.deps[i])) return;
      previous?.cleanup?.(); effects[index] = { deps, cleanup: effect() };
    },
  };
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  }
  const component = load('components/RouteScroll.tsx', name => {
    if (name === 'react') return react;
    if (name === 'react-router-dom') return { useLocation: () => location, useNavigationType: () => kind };
    if (name === '../navigationState') return navigation;
    throw new Error(name);
  }, { window: win, document: { body: {} }, ResizeObserver: Observer, requestAnimationFrame: fn => { fn(); return 1; }, cancelAnimationFrame() {} }).default;
  const event = type => { for (const callback of [...(listeners.get(type) ?? [])]) callback(); };
  return {
    win, event,
    render(key, navigationKind = 'PUSH', state = null) { location = { key, state }; kind = navigationKind; effectIndex = refIndex = 0; component(); },
    scroll(top) { win.scrollY = top; event('scroll'); },
    resize() { for (const observer of observers) if (observer.active) observer.callback(); },
  };
}

test('scroll manager resets a new section but restores browser Back and a return link', () => {
  const h = scrollHarness();
  h.render('list'); h.scroll(500);
  h.render('detail'); assert.equal(h.win.scrollY, 0);
  h.render('list', 'POP'); assert.equal(h.win.scrollY, 500);
  h.render('another-detail'); assert.equal(h.win.scrollY, 0);
  h.render('return', 'PUSH', { restoreScrollKey: 'list' }); assert.equal(h.win.scrollY, 500);
  h.render('suppliers'); assert.equal(h.win.scrollY, 0);
});

test('Back waits for asynchronous content height instead of losing the saved scroll position', () => {
  const h = scrollHarness();
  h.render('list'); h.scroll(500); h.render('detail');
  h.win.maximum = 50; h.render('list', 'POP'); assert.equal(h.win.scrollY, 50);
  h.win.maximum = 1000; h.resize(); assert.equal(h.win.scrollY, 500);
});

test('user scrolling cancels delayed restoration so the page does not fight the mouse', () => {
  const h = scrollHarness();
  h.render('list'); h.scroll(500); h.render('detail');
  h.win.maximum = 50; h.render('list', 'POP');
  h.event('wheel'); h.scroll(20);
  h.win.maximum = 1000; h.resize(); assert.equal(h.win.scrollY, 20);
});

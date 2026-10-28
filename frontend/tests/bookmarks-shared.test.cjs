// shared bookmark migration, mirroring and offline recovery regression tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = path.resolve(__dirname, '../src/api/bookmarkStore.ts');
const js = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exported = {};
new Function('require', 'exports', js)(() => ({ API_ROUTES: { savedLists: '/lists', savedListDetail: id => `/lists/${id}` } }), exported);
const entry = uen => ({ company_uen: uen, company_name: `Company ${uen}`, company_status: 'Live', review_status: 'to_check' });
function fixture(initial = {}) {
  const values = new Map();
  const lists = { mariadb: new Map(), mongodb: new Map() };
  const offline = new Set();
  const missing = new Set();
  let sequence = 0;
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  for (const [db, uens] of Object.entries(initial)) {
    lists[db].set('old', uens.map(entry)); storage.setItem(`bta:bookmarks:${db}`, 'old');
  }
  async function request(url, database, query = {}, options = {}) {
    if (offline.has(database)) throw new Error('Offline');
    const ok = body => ({ state: 'success', database, body });
    const fail = status => ({ state: 'error', database, status, message: 'Unavailable' });
    const parts = url.split('/').filter(Boolean);
    if (parts.length === 1 && options.method === 'POST') {
      const id = `new${++sequence}`; lists[database].set(id, []); return ok({ id });
    }
    const id = parts[1];
    const rows = lists[database].get(id);
    if (!rows) return fail(404);
    if (!options.method) {
      const offset = query.offset ?? 0;
      return { ...ok({ entries: rows.slice(offset, offset + 100) }), meta: { pagination: { has_more: offset + 100 < rows.length } } };
    }
    if (options.method === 'POST') {
      const uen = options.body.company_uen;
      if (missing.has(`${database}:${uen}`)) return fail(404);
      if (!rows.some(x => x.company_uen === uen)) rows.push(entry(uen));
      return ok(entry(uen));
    }
    if (options.method === 'DELETE') {
      lists[database].set(id, rows.filter(x => x.company_uen !== decodeURIComponent(parts[3])));
      return ok(undefined);
    }
    throw new Error('Unexpected request');
  }
  const make = () => new exported.BookmarkStore(storage, request);
  const remote = db => [...lists[db].values()].flat().map(x => x.company_uen).sort();
  return { store: make(), make, storage, lists, offline, missing, remote };
}
const noop = () => {};

test('combines old lists without duplicates and mirrors both databases', async () => {
  const f = fixture({ mariadb: ['A', 'B'], mongodb: ['B', 'C'] });
  assert.equal(await f.store.refresh('mariadb', noop), '');
  assert.deepEqual(f.store.entries.map(x => x.company_uen).sort(), ['A', 'B', 'C']);
  assert.deepEqual(f.remote('mariadb'), ['A', 'B', 'C']);
  assert.deepEqual(f.remote('mongodb'), ['A', 'B', 'C']);
});

test('save, switch, reload and remove keep one consistent membership', async () => {
  const f = fixture();
  await f.store.refresh('mariadb', noop);
  await f.store.change('A', false, noop);
  await f.store.refresh('mongodb', noop);
  assert.deepEqual(f.remote('mariadb'), ['A']);
  assert.deepEqual(f.remote('mongodb'), ['A']);
  const reloaded = f.make();
  assert.equal(reloaded.entries[0].company_uen, 'A');
  await reloaded.change('A', true, noop);
  await reloaded.refresh('mongodb', noop);
  assert.deepEqual(f.remote('mariadb'), []);
  assert.deepEqual(f.remote('mongodb'), []);
});

test('offline mirror retains saves and retries successfully', async () => {
  const f = fixture();
  await f.store.refresh('mariadb', noop);
  f.offline.add('mongodb');
  await f.store.change('A', false, noop);
  assert.match(await f.store.refresh('mariadb', noop), /MongoDB/);
  assert.equal(f.make().entries[0].company_uen, 'A');
  f.offline.clear();
  assert.equal(await f.store.refresh('mongodb', noop), '');
  assert.deepEqual(f.remote('mongodb'), ['A']);
});

test('offline removal cannot be resurrected by a delayed legacy import', async () => {
  const f = fixture({ mariadb: ['A'], mongodb: ['A', 'B'] });
  f.offline.add('mongodb');
  await f.store.refresh('mariadb', noop);
  await f.store.change('A', true, noop);
  f.offline.clear();
  await f.store.refresh('mongodb', noop);
  assert.deepEqual(f.store.entries.map(x => x.company_uen), ['B']);
  assert.deepEqual(f.remote('mongodb'), ['B']);
});

test('migration reads all pages, not only the first 100 saved companies', async () => {
  const uens = Array.from({ length: 103 }, (_, i) => String(i));
  const f = fixture({ mariadb: uens });
  await f.store.refresh('mongodb', noop);
  assert.equal(f.store.entries.length, 103);
  assert.equal(f.remote('mongodb').length, 103);
});

test('company absent from one database stays saved with an honest sync notice', async () => {
  const f = fixture();
  await f.store.refresh('mariadb', noop);
  f.missing.add('mongodb:A');
  await f.store.change('A', false, noop);
  assert.match(await f.store.refresh('mongodb', noop), /incomplete/);
  assert.equal(f.store.entries[0].company_uen, 'A');
  assert.deepEqual(f.remote('mongodb'), []);
});

test('queued repeated saves do not duplicate bookmarks and undo restores removal', async () => {
  const f = fixture();
  await f.store.refresh('mariadb', noop);
  await Promise.all([f.store.change('A', false, noop), f.store.change('A', false, noop)]);
  assert.equal(f.store.entries.length, 1);
  await f.store.change('A', true, noop);
  await f.store.change('A', false, noop);
  await f.store.refresh('mongodb', noop);
  assert.deepEqual(f.remote('mongodb'), ['A']);
});


test('one missing company does not block the remaining bookmarks from syncing', async () => {
  const f = fixture({ mariadb: ['A', 'B'] });
  f.missing.add('mongodb:A');
  assert.match(await f.store.refresh('mongodb', noop), /incomplete/);
  assert.deepEqual(f.remote('mongodb'), ['B']);
  assert.equal(f.store.entries.length, 2);
});


test('a stale second tab cannot erase a company saved by the first tab', async () => {
  const f = fixture();
  await f.store.refresh('mariadb', noop);
  await f.store.change('A', false, noop);
  await f.store.refresh('mariadb', noop);
  const secondTab = f.make();
  await f.store.change('B', false, noop);
  await f.store.refresh('mariadb', noop);
  await secondTab.change('A', true, noop);
  await secondTab.refresh('mongodb', noop);
  assert.deepEqual(f.remote('mariadb'), ['B']);
  assert.deepEqual(f.remote('mongodb'), ['B']);
});

test('corrupt browser cache recovers existing bookmarks from database lists', async () => {
  const f = fixture({ mariadb: ['A'] });
  f.storage.setItem('bta:bookmarks:shared:v1', 'broken json');
  const recovered = f.make();
  await recovered.refresh('mariadb', noop);
  assert.deepEqual(recovered.entries.map(x => x.company_uen), ['A']);
});


test('browser lock serializes simultaneous bookmark changes from two tabs', async () => {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
  let queue = Promise.resolve();
  let calls = 0;
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: (_name, action) => {
      calls++;
      const run = queue.then(action);
      queue = run.catch(() => {});
      return run;
    },
  } });
  try {
    const f = fixture();
    await f.store.refresh('mariadb', noop);
    const secondTab = f.make();
    await Promise.all([f.store.change('A', false, noop), secondTab.change('B', false, noop)]);
    await f.store.refresh('mongodb', noop);
    assert.deepEqual(f.remote('mariadb'), ['A', 'B']);
    assert.deepEqual(f.remote('mongodb'), ['A', 'B']);
    assert.ok(calls >= 4);
  } finally {
    if (previous) Object.defineProperty(navigator, 'locks', previous);
    else delete navigator.locks;
  }
});

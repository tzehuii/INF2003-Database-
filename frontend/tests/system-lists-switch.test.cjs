// verify retained list data never enables actions against the wrong database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '../src/pages');
function functionText(file, name) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(tree).replace(/^export /, '');
}
function loadFunction(source, name, bindings) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(bindings), js + `; return ${name};`)(...Object.values(bindings));
}

test('tender and award rows persist on a switch and report failures after loading', () => {
  let database = 'mariadb';
  const previous = { current: null };
  const stable = loadFunction(functionText('tendersAwards/TendersAwardsPage.tsx', 'useStableResults'), 'useStableResults', {
    useDatabase: () => ({ database }), useRef: () => previous,
  });
  const old = { items: [{ tender_no: 'TEST' }], total: 1 };
  const result = { state: 'success', database, body: old };
  assert.equal(stable({ result, isLoading: false }).data, old);
  database = 'mongodb';
  const switching = stable({ result, isLoading: false });
  assert.equal(switching.data, old);
  assert.equal(switching.refreshing, true);
  const next = { items: [], total: 0 };
  assert.equal(stable({ result: { state: 'success', database, body: next }, isLoading: false }).data, next);
  const failed = stable({ result: { state: 'error', database, message: 'Unavailable' }, isLoading: false });
  assert.equal(failed.failure, 'Unavailable');
  assert.equal(failed.data, null);
});

test('agency and status choices remain available during the replacement request', () => {
  const result = { state: 'success', database: 'mariadb', body: { agencies: ['Agency A'], statuses: ['Awarded'] } };
  const options = loadFunction(functionText('tendersAwards/shared.tsx', 'useTenderOptions'), 'useTenderOptions', {
    API: { options: '/options' }, useApiResource: (...args) => {
      assert.equal(args[4], true);
      return { result, isLoading: true, reload() {} };
    },
  });
  assert.deepEqual(options().agencies, ['Agency A']);
  assert.deepEqual(options().statuses, ['Awarded']);
});

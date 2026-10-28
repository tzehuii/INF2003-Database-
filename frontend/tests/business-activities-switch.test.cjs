// regression checks for keeping activity rows visible during database switches.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const source = path.resolve(__dirname, '../src/pages/businessActivities/CataloguePage.tsx');
const req = createRequire(source);
const React = req('react');
const { renderToStaticMarkup } = req('react-dom/server');
const ts = req('typescript');
let resource;
const wrapper = ({ children }) => React.createElement('div', null, children);
const js = ts.transpileModule(fs.readFileSync(source, 'utf8') + '\nexport { TreeLevel, SearchResults };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const loaded = {};
new Function('require', 'exports', js)((name) => {
  if (name === 'react-router-dom') return { Link: ({ children, to }) => React.createElement('a', { href: to }, children) };
  if (name === '../../api/useApiResource') return { useApiResource: (...args) => {
    assert.equal(args[4], true, 'catalogue requests must retain previous rows');
    return resource;
  }};
  if (name === '../../api/client') return { API_ROUTES: { activityChildren: '/children' } };
  if (name === '../../components/icons') return { Icon: () => null };
  if (name === '../../components/ui') return new Proxy({}, { get: (_, key) => key === 'SkeletonRows' ? () => React.createElement('div', null, 'SKELETON') : wrapper });
  if (name === './shared') return {
    ACTIVITIES_PATH: '/system/business-activities',
    useBrowse: () => ({ section: 'C', expanded: [], toggle() {} }),
    levelClass: () => 'section', ActivityCode: ({ code }) => code,
    HighlightMatch: ({ text }) => text,
  };
  return req(name);
}, loaded);

test('expanded catalogue keeps previous database rows while its replacement loads', () => {
  resource = { isLoading: true, reload() {}, result: { database: 'mariadb', state: 'success', body: {
    items: [{ code: 'C', title: 'Manufacturing', level: 'Section', has_children: true }],
  }}};
  const html = renderToStaticMarkup(React.createElement(loaded.TreeLevel, { parentCode: null }));
  assert.match(html, /Manufacturing/);
  assert.doesNotMatch(html, /SKELETON/);
});

test('search keeps existing matches visible until the replacement response arrives', () => {
  const html = renderToStaticMarkup(React.createElement(loaded.SearchResults, {
    query: 'Manufacturing', section: 'C', isLoading: true,
    current: { database: 'mariadb', state: 'success', body: { items: [
      { code: 'C', title: 'Manufacturing', level: 'Section', parent_path: [] },
    ] } },
  }));
  assert.match(html, /Manufacturing/);
  assert.doesNotMatch(html, /SKELETON/);
});


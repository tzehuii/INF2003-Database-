// Agency Awards must explain failed/empty agency loads without duplicate errors.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function compile(relative, request) {
  const source = path.resolve(__dirname, '../src/pages', relative);
  const js = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  new Function('require','exports',js)(request,exports);
  return exports;
}
const ResourceStatus = compile('publicShared.tsx', require).ResourceStatus;
function render(resources, memory = new Map()) {
  const calls = [];
  const component = compile('AgencyAwardsPage.tsx', name => {
    if (name === '../visitState') return { useVisitState: (key, initial) => React.useState(memory.has(key) ? memory.get(key) : initial) };
    if (name === '../api/client') return { API_ROUTES: { agencies: '/agencies', agencyAwards: '/agency-awards' }, isLiveData: result => result?.state === 'success' };
    if (name === '../api/useApiResource') return { useApiResource: (path, query) => {
      calls.push({path,query});
      return path === '/agencies' ? resources[query.offset ? 1 : 0] : { result: null, isLoading: false, reload() {} };
    } };
    if (name === '../components/ui') return new Proxy({}, { get: () => ({children}) => React.createElement('div',null,children) });
    if (name === './publicShared') return { ResourceStatus };
    if (name === './AgencyAwardsChart' || name === '../components/CompanyLink') return { default: () => null };
    if (name === '../format') return { formatMoney: String, formatPercent: String };
    return require(name);
  }).default;
  return { html: renderToStaticMarkup(React.createElement(component)), calls };
}
const failed = { result: {state:'error',message:'The selected database could not be reached.'}, isLoading:false,reload(){} };
const empty = { result: {state:'success',body:{items:[]}},isLoading:false,reload(){} };

test('two failed agency batches show one error, a truthful dropdown and a retry button', () => {
  const {html}=render([failed,failed]);
  assert.equal((html.match(/The selected database could not be reached\./g)||[]).length,1);
  assert.match(html,/Agencies unavailable/); assert.match(html,/Retry agencies/);
  assert.doesNotMatch(html,/Loading agencies/);
});

test('successful empty agencies are distinguished from loading or failure', () => {
  const {html}=render([empty,empty]);
  assert.match(html,/No agencies available/);
  assert.doesNotMatch(html,/Loading agencies|Retry agencies|could not be reached/);
});

test('an in-flight agency load still has an honest loading label', () => {
  const loading={result:null,isLoading:true,reload(){}};
  assert.match(render([loading,loading]).html,/Loading agencies/);
});

test('returning from company details reuses the submitted agency, page and page size', () => {
  const filters={agency:'Housing and Development Board',start:'',end:'',above:false};
  const memory=new Map([['agency:draft',filters],['agency:filters',filters],['agency:page-size',50],['agency:offset',100]]);
  const {calls}=render([empty,empty],memory);
  const query=calls.find(call=>call.path==='/agency-awards').query;
  assert.equal(query.agency_name,filters.agency); assert.equal(query.limit,50); assert.equal(query.offset,100);
});

// cover the actual Saved Companies rendering path, including stale visit state.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const source=path.resolve(__dirname,'../src/pages/SavedListsPage.tsx');
const js=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const entries=[
  {company_uen:'00001300E',company_name:'KIM HUIN SI CLINIC',company_status:'Terminated',review_status:'to_check'},
  {company_uen:'00001500L',company_name:'K SYED MOHAMED COMPANY',company_status:'Cancelled',review_status:'to_check'},
];
function render(items,values={}) {
  const exports={};
  new Function('require','exports',js)(name=>{
    if(name==='../visitState')return {useVisitState:(key,initial)=>React.useState(Object.hasOwn(values,key)?values[key]:initial)};
    if(name==='../api/bookmarks')return {useBookmarks:()=>({entries:items,loading:false,pending:[],save:async()=>true,remove:async()=>true,reload(){}}),BookmarkError:()=>null};
    if(name==='react-router-dom')return {Link:({children,to})=>React.createElement('a',{href:to},children)};
    if(name==='../components/CompanyLink')return {__esModule:true,default:({children,uen})=>React.createElement('a',{href:'/companies/'+uen},children)};
    if(name==='../components/ui')return {
      PageHeading:({title})=>React.createElement('h1',null,title),
      Panel:({children})=>React.createElement('section',null,children),
      EmptyState:({title,children})=>React.createElement('div',null,title,children),
      RegistryStatusBadge:({status})=>React.createElement('span',null,status),
      SearchInput:props=>React.createElement('input',props),
    };
    return require(name);
  },exports);
  return renderToStaticMarkup(React.createElement(exports.default));
}

test('saved list renders both real entries and their company links',()=>{
  const html=render(entries);assert.match(html,/KIM HUIN SI CLINIC/);assert.match(html,/K SYED MOHAMED COMPANY/);assert.match(html,/\/companies\/00001300E/);
});
test('empty bookmarks render an empty state, not a blank page',()=>assert.match(render([]),/No saved companies yet/));
test('stale non-string visit state cannot crash the saved list',()=>{
  const html=render(entries,{'saved:query':{old:true},'saved:sort':null});assert.match(html,/KIM HUIN SI CLINIC/);
});
test('remembered saved-list search filters the entries on return',()=>{
  const html=render(entries,{'saved:query':'KIM','saved:sort':'name'});assert.match(html,/KIM HUIN SI CLINIC/);assert.doesNotMatch(html,/K SYED MOHAMED COMPANY/);
});

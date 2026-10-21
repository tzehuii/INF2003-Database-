// Regression tests for source addresses; run: pnpm --dir frontend exec node --test tests/address-map.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRequire}=require('node:module');
const source=path.resolve(__dirname,'../src/components/AddressMap.tsx');
const req=createRequire(source); const ts=req('typescript');
const js=ts.transpileModule(fs.readFileSync(source,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const exportsForTest={}; new Function('require','exports',js)(req,exportsForTest);
const base={type:'LOCAL',block:null,street_name:null,level_no:null,unit_no:null,building_name:null,postal_code:null,other_address_line1:null,other_address_line2:null};
const query=changes=>exportsForTest.addressMapQuery({...base,...changes});
test('legacy code alone must not map the whole country',()=>assert.equal(query({postal_code:'0718'}),null));
test('legacy complete address uses street, not old postal code',()=>assert.equal(query({block:'259',street_name:'VICTORIA STREET',postal_code:'0718'}),'259 VICTORIA STREET, Singapore'));
test('six digit leading zero is preserved',()=>assert.equal(query({postal_code:'018971'}),'Singapore, 018971'));
test('incomplete road and old code cannot identify a building',()=>assert.equal(query({street_name:'VICTORIA STREET',postal_code:'0718'}),null));
test('placeholder values are not mapped',()=>assert.equal(query({building_name:'NIL',postal_code:'na'}),null));
test('foreign full address is not forced into Singapore',()=>assert.equal(query({type:'FOREIGN',other_address_line1:'1 Infinite Loop, Cupertino',postal_code:'CA 95014'}),'1 Infinite Loop, Cupertino, CA 95014'));

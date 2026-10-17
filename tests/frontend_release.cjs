// Regression coverage for misleading fare displays and shared preference validation.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),ts=req('typescript');
function load(file){const out={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports:out,Intl,require:n=>n==='./i18n'?{getLocale:()=> 'pt-BR',t:(key,args=[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[i]))}:n==='./ui'?{}:n==='./format'?load('format.ts'):req(n)});return out;}
const {priceChangeLabel}=load('pricePresentation.ts');
assert.equal(priceChangeLabel(111100,111100,'BRL'),'Preço mantido');
assert.ok(priceChangeLabel(176300,176100,'BRL').includes('0,11%'));
assert.ok(!priceChangeLabel(100000000,99999999,'BRL').includes('0%'));
assert.equal(priceChangeLabel(null,10000,'BRL'),'');
assert.equal(priceChangeLabel(100,101,'BRL'),'Preço subiu');
const {validTimeZone}=load('TimeZoneField.tsx');
for(const zone of ['UTC','America/Araguaina','America/Sao_Paulo']) assert.equal(validTimeZone(zone),true);
for(const zone of ['','Not/AZone']) assert.equal(validTimeZone(zone),false);
console.log('Release regressions: unchanged fares, small savings, no false zero-percent discounts and shared time zone validation passed.');

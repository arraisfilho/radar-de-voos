// Browser preference inference without geolocation or an external service.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('../frontend/node_modules/typescript');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../frontend/src/currency.ts'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
for(const [language,zone,expected] of [['en-US','America/New_York','USD'],['pt-BR','America/Araguaina','BRL'],['es-CO','America/Bogota','COP'],['fr-FR','Europe/Paris','EUR'],['en-GB','Europe/London','GBP'],['de-CH','Europe/Zurich','CHF'],['en','America/Bogota','COP'],['en','Asia/Tokyo','JPY']]) {
 const exports={};
 vm.runInNewContext(code,{exports,require:name=>name==='./i18n'?{getLocale:()=> 'pt-BR'}:JSON.parse(fs.readFileSync(path.join(__dirname,'../config/currencies.json'),'utf8')),navigator:{languages:[language],language},Intl:{Locale:Intl.Locale,DisplayNames:Intl.DisplayNames,DateTimeFormat:()=>({resolvedOptions:()=>({timeZone:zone})})}});
 assert.equal(exports.suggestCurrency(),expected,`${language} / ${zone}`);
}
console.log('8 browser currency scenarios passed; no network/geolocation.');

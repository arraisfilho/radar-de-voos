const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ts=require('../frontend/node_modules/typescript');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../frontend/src/messages.json'),'utf8'));
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src/i18n.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
for(const [device,expected] of [['pt-BR','pt'],['pt-PT','pt'],['es-CO','es'],['en-US','en'],['fr-FR','en'],['ja-JP','en']]) {
 const exports={};const store=new Map();vm.runInNewContext(code,{exports,require:name=>name==='react'?{useEffect:()=>{},useSyncExternalStore:()=>{}}:catalog,navigator:{language:device},localStorage:{getItem:key=>store.get(key),setItem:(key,val)=>store.set(key,val)}});
 assert.equal(exports.getLanguage(),expected);exports.setLanguage('en');assert.equal(exports.t('Nova busca'),'New search');exports.setLanguage('es');assert.equal(exports.t('Nova busca'),'Nueva búsqueda');assert.equal(exports.t('Versão {0}',[2]),'Versión 2');exports.setLanguage('pt');assert.equal(exports.t('Sair da conta'),'Sair da conta');
}
for(const [key,translations] of Object.entries(catalog)) {
 for(const language of ['en','es']) {
  assert.ok(translations[language],`${key} lacks ${language}`);
  assert.deepEqual([...key.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),[...translations[language].matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),`${key} placeholders in ${language}`);
 }
}
for(const file of fs.readdirSync(path.join(__dirname,'../frontend/src')).filter(f=>/\.tsx?$/.test(f))) {
 const source=ts.createSourceFile(file,fs.readFileSync(path.join(__dirname,'../frontend/src',file),'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='t'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))assert.ok(catalog[node.arguments[0].text],`${file} missing ${node.arguments[0].text}`);ts.forEachChild(node,visit);}visit(source);
}
console.log('Language detection, switching, interpolation and complete UI catalogs passed.');

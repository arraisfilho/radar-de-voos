const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const ts=require('../frontend/node_modules/typescript');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../frontend/src/messages.json'),'utf8'));
const transpile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
// The real plugin of vite.config.ts builds virtual:messages/en and /es: every key of messages.json, in that language only.
const config={};vm.runInNewContext(transpile(fs.readFileSync(path.join(__dirname,'../frontend/vite.config.ts'),'utf8')),{exports:config,require:name=>({vite:{defineConfig:c=>c},'@vitejs/plugin-react':()=>({name:'react'}),'./src/messages.json':catalog})[name]});
const plugin=config.default.plugins.find(p=>p.name==='radar-message-catalogs'),generated={};
assert.equal(plugin.resolveId('virtual:messages/fr'),undefined);assert.equal(plugin.resolveId('./i18n'),undefined);assert.equal(plugin.load('/src/i18n.ts'),undefined);
for(const language of ['en','es']) {
 const id=plugin.resolveId(`virtual:messages/${language}`),emitted=plugin.load(id),out={};assert.equal(id,`\0virtual:messages/${language}`);assert.match(emitted,/^export default JSON\.parse\(".*"\);$/s);
 vm.runInNewContext(transpile(emitted),{exports:out});generated[language]=out.default;
 assert.deepEqual(Object.entries(generated[language]),Object.entries(catalog).map(([key,translations])=>[key,translations[language]]),`virtual:messages/${language}`);
}
for(const [key,translations] of Object.entries(catalog)) {
 for(const language of ['en','es']) {
  assert.ok(translations[language],`${key} lacks ${language}`);
  assert.deepEqual([...key.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),[...translations[language].matchAll(/\{\d+\}/g)].map(m=>m[0]).sort(),`${key} placeholders in ${language}`);
 }
}
const catalogImports=[];
for(const file of fs.readdirSync(path.join(__dirname,'../frontend/src')).filter(f=>/\.tsx?$/.test(f))) {
 const source=ts.createSourceFile(file,fs.readFileSync(path.join(__dirname,'../frontend/src',file),'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='t'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))assert.ok(catalog[node.arguments[0].text],`${file} missing ${node.arguments[0].text}`);
  // plural(count, one, other): both forms are catalog keys as well.
  if(ts.isCallExpression(node)&&node.expression.getText(source)==='plural')for(const form of node.arguments.slice(1,3))if(ts.isStringLiteral(form))assert.ok(catalog[form.text],`${file} missing plural form ${form.text}`);
  // An error kept untranslated until shown, setError("…"), is a catalog key too.
  if(ts.isCallExpression(node)&&node.expression.getText(source)==='setError'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text)assert.ok(catalog[node.arguments[0].text],`${file} missing ${node.arguments[0].text}`);
  // Placeholders are text too: only an IANA time zone name may stay a fixed literal.
  if(ts.isJsxAttribute(node)&&node.name.getText(source)==='placeholder'&&node.initializer&&ts.isStringLiteral(node.initializer))assert.match(node.initializer.text,/^[A-Z][a-z]+\/[A-Za-z_]+$/,`${file}: placeholder "${node.initializer.text}" outside t()`);
  // messages.json reaches the browser only through the build plugin: no static import in src.
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)&&/messages\.json$/.test(node.moduleSpecifier.text))assert.fail(`${file} imports messages.json`);
  if(file==='i18n.ts'&&ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword)catalogImports.push(ts.isStringLiteral(node.arguments[0])?node.arguments[0].text:node.arguments[0].getText(source));
  ts.forEachChild(node,visit);}visit(source);
}
// i18n.ts loads the catalogs only with literal import("virtual:messages/…"), one chunk per language.
assert.deepEqual(catalogImports,['virtual:messages/en','virtual:messages/es']);
// i18n.ts as a fresh visit runs it. import() adopts a thenable module, so each catalog download waits for
// the test to settle it: ok, fail, or reload (main.tsx prevented the preload error; the import resolves undefined).
const code=transpile(fs.readFileSync(path.join(__dirname,'../frontend/src/i18n.ts'),'utf8'));
function boot({saved,device='pt-BR',auto=false}={}) {
 const exports={},store=new Map(saved?[['radar-language',saved]]:[]),downloads=[],document={documentElement:{}},react={useSyncExternalStore:(subscribe,get)=>(react.subscribe=subscribe,get())};
 vm.runInNewContext(code,{exports,document,navigator:{language:device},localStorage:{getItem:key=>store.get(key),setItem:(key,val)=>store.set(key,val)},require:name=>{if(name==='react')return react;const language=name.match(/^virtual:messages\/(en|es)$/)[1];
  return {__esModule:true,then(resolve,reject){const download={language,ok:()=>resolve({default:generated[language]}),fail:()=>reject(Error('offline')),reload:()=>resolve(undefined)};if(auto)download.ok();else downloads.push(download);}};}});
 // Each notification is recorded as [language, pending, ready], as the hooks read them.
 exports.useLanguage();const heard=[];react.subscribe(()=>heard.push([exports.getLanguage(),exports.usePendingLanguage(),exports.useLanguageReady()]));
 return {...exports,store,downloads,document,heard,download:language=>downloads.find(d=>d.language===language)};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
// Exit 1 unless every check ran: a promise that never settles must not pass silently.
process.exitCode=1;
(async()=>{
for(const [device,expected] of [['pt-BR','pt'],['pt-PT','pt'],['es-CO','es'],['en-US','en'],['fr-FR','en'],['ja-JP','en']]) {
 const app=boot({device,auto:true});
 assert.equal(app.getLanguage(),expected);await app.setLanguage('en');assert.equal(app.t('Nova busca'),'New search');await app.setLanguage('es');assert.equal(app.t('Nova busca'),'Nueva búsqueda');assert.equal(app.t('Versão {0}',[2]),'Versión 2');await app.setLanguage('pt');assert.equal(app.t('Sair da conta'),'Sair da conta');
}
// Portuguese downloads no catalog and is ready at once.
let app=boot({saved:'pt'}),settled;await flush();assert.equal(app.downloads.length,0);assert.equal(app.useLanguageReady(),true);
// English or Spanish applies at once (server, drafts); the gate waits for the catalog, and <html lang> follows the texts shown.
for(const language of ['en','es']) {
 app=boot({saved:language});await flush();assert.deepEqual(app.downloads.map(d=>d.language),[language]);assert.equal(app.useLanguageReady(),false);assert.equal(app.getLanguage(),language);assert.equal(app.document.documentElement.lang,'pt-BR');assert.equal(app.t('Nova busca'),'Nova busca');
 app.download(language).ok();await flush();assert.deepEqual(app.heard,[[language,null,true]]);assert.equal(app.document.documentElement.lang,language);assert.equal(app.t('Nova busca'),generated[language]['Nova busca']);
}
// pt to en: Portuguese stays, with en pending, until the catalog arrives; listeners hear both steps.
app=boot({saved:'pt'});settled=app.setLanguage('en');
assert.equal(app.getLanguage(),'pt');assert.equal(app.usePendingLanguage(),'en');assert.equal(app.store.get('radar-language'),'en');await flush();assert.equal(app.t('Nova busca'),'Nova busca');assert.equal(app.document.documentElement.lang,'pt-BR');
app.download('en').ok();await settled;assert.equal(app.t('Nova busca'),'New search');assert.equal(app.document.documentElement.lang,'en');assert.deepEqual(app.heard,[['pt','en',true],['en',null,true]]);
// A catalog at hand applies at once, without a new download.
app.setLanguage('pt');app.setLanguage('en');assert.equal(app.getLanguage(),'en');await flush();assert.equal(app.downloads.length,1);
// The newest request wins: an older download that arrives first is ignored, and so is one that arrives last.
app=boot({saved:'pt'});let toEn=app.setLanguage('en'),toEs=app.setLanguage('es');await flush();app.download('en').ok();await toEn;assert.equal(app.getLanguage(),'pt');assert.equal(app.usePendingLanguage(),'es');app.download('es').ok();await toEs;assert.equal(app.getLanguage(),'es');
app=boot({saved:'pt'});toEn=app.setLanguage('en');toEs=app.setLanguage('es');await flush();app.download('es').ok();await toEs;assert.equal(app.getLanguage(),'es');app.download('en').ok();await toEn;assert.equal(app.getLanguage(),'es');assert.equal(app.usePendingLanguage(),null);assert.equal(app.store.get('radar-language'),'es');
// Back to Portuguese while en downloads: pt applies at once and en is ignored when it arrives.
app=boot({saved:'pt'});settled=app.setLanguage('en');app.setLanguage('pt');assert.equal(app.getLanguage(),'pt');assert.equal(app.usePendingLanguage(),null);await flush();app.download('en').ok();await settled;assert.equal(app.getLanguage(),'pt');assert.equal(app.store.get('radar-language'),'pt');
// A failed switch keeps the current language and restores the saved one.
app=boot({saved:'es'});await flush();app.download('es').ok();await flush();settled=app.setLanguage('en');await flush();app.download('en').fail();await settled;
assert.deepEqual(app.heard,[['es',null,true],['es','en',true],['es',null,true]]);assert.equal(app.store.get('radar-language'),'es');assert.equal(app.t('Nova busca'),'Nueva búsqueda');assert.equal(app.document.documentElement.lang,'es');
// An older download that fails does not cancel the newest request.
app=boot({saved:'pt'});toEn=app.setLanguage('en');toEs=app.setLanguage('es');await flush();app.download('en').fail();await toEn;assert.equal(app.usePendingLanguage(),'es');assert.equal(app.store.get('radar-language'),'es');app.download('es').ok();await toEs;assert.equal(app.getLanguage(),'es');
// A failed first catalog keeps the language (the server, drafts and locale get it); this visit shows the Portuguese texts, as <html lang> says.
app=boot({saved:'en'});await flush();app.download('en').fail();await flush();assert.deepEqual(app.heard,[['en',null,true]]);assert.equal(app.t('Nova busca'),'Nova busca');assert.equal(app.getLocale(),'en-US');assert.equal(app.document.documentElement.lang,'pt-BR');
// A failed chunk makes main.tsx reload the page (the import resolves undefined): the choice stays saved for the next load and
// the spinner stops, in case beforeunload cancels the reload; a later failure does not save the current language over it.
app=boot({saved:'pt'});settled=app.setLanguage('en');await flush();app.download('en').reload();await settled;assert.deepEqual(app.heard,[['pt','en',true],['pt',null,true]]);assert.equal(app.store.get('radar-language'),'en');
settled=app.setLanguage('es');await flush();app.download('es').fail();await settled;assert.equal(app.getLanguage(),'pt');assert.equal(app.usePendingLanguage(),null);assert.equal(app.store.get('radar-language'),'es');
// A discarded request can still start the reload: the newest request keeps waiting, and its failure keeps its choice saved.
app=boot({saved:'pt'});toEn=app.setLanguage('en');toEs=app.setLanguage('es');await flush();app.download('en').reload();await toEn;assert.equal(app.usePendingLanguage(),'es');app.download('es').fail();await toEs;assert.equal(app.usePendingLanguage(),null);assert.equal(app.store.get('radar-language'),'es');
app=boot({saved:'en'});await flush();app.download('en').reload();await flush();assert.equal(app.useLanguageReady(),false);assert.deepEqual(app.heard,[]);
console.log('Language detection, switching, interpolation, generated catalogs, on-demand loading and complete UI catalogs passed.');
process.exitCode=0;
})().catch(error=>{console.error(error);process.exitCode=1;});

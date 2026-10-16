// Channel chips and expandable accessible details from synthetic transport counts.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),React=req('react'),ts=req('typescript'),{renderToStaticMarkup}=req('react-dom/server');
const output={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src/DeliveryChannels.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports:output,require:n=>n==='./i18n'?{t:(k,args=[])=>k.replace(/\{(\d+)\}/g,(_,i)=>String(args[i]))}:req(n)});
const {DeliveryChannels,channelState}=output;
assert.equal(channelState({sent:2}),'sent');assert.equal(channelState({sent:1,failed:1}),'partial');assert.equal(channelState({sent:1,pending:1}),'queued');assert.equal(channelState({uncertain:1}),'uncertain');assert.equal(channelState({failed:1}),'failed');
function render(event){return renderToStaticMarkup(React.createElement(DeliveryChannels,{event}));}
const html=render({status:'partial',channels:[{channel:'whatsapp',counts:{sent:1}},{channel:'email',counts:{failed:1}}]});
assert.ok(html.indexOf('E-mail')<html.indexOf('WhatsApp'));assert.ok(html.includes('channel-failed'));assert.ok(html.includes('channel-sent'));assert.ok(html.includes('Falhou'));assert.ok(html.includes('Aceito'));assert.equal((html.match(/<details/g)||[]).length,2);assert.ok(html.includes('não confirma entrega ou leitura'));assert.ok(!html.includes('Telegram'));assert.ok(!html.includes('Aceito por parte dos destinos'));
const multi=render({status:'partial',channels:[{channel:'whatsapp',counts:{sent:1,failed:1}}]});assert.ok(multi.includes('Envio parcial'));assert.ok(multi.includes('1/2'));assert.ok(multi.includes('1 de 2 envios aceitos'));assert.ok(multi.includes('Falhou: 1'));
assert.ok(render({status:'partial',channels:[{channel:'whatsapp',counts:{sent:1}}]}).includes('registros incompletos'));
const future=render({status:'sent',channels:[{channel:'telegram',counts:{sent:1}}]});assert.ok(future.includes('Telegram'));assert.ok(future.includes('<svg'));assert.ok(render({status:'in_app'}).includes('Somente no painel'));assert.ok(render({status:'partial',channels:[]}).includes('Envio parcial'));
console.log('Channel statuses: icons, explicit labels, per-channel counts, partial/pending, unavailable history and Telegram-ready rendering passed.');

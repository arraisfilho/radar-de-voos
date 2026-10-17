// Delivery chips from synthetic transport counts: six short labels in four colors, the detail only in the accessible name.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),React=req('react'),ts=req('typescript'),{renderToStaticMarkup}=req('react-dom/server');
const output={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src/DeliveryChannels.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports:output,require:n=>n==='./i18n'?{getLocale:()=> 'pt-BR',t:(k,args=[])=>k.replace(/\{(\d+)\}/g,(_,i)=>String(args[i]))}:req(n)});
const {DeliveryChannels,channelState,deliveryStatus}=output;
// Every state the queue and the receipts report, mapped to the label and color people see (UX audit 8.2).
const mapping={
  pending:['Enviando','gray'],queued:['Enviando','gray'],sending:['Enviando','gray'],waiting_smtp:['Falha','red'],
  sent:['Enviado','green'],confirmed_sent:['Enviado','green'],delivered:['Entregue','green'],read:['Lido','green'],
  failed:['Falha','red'],expired:['Falha','red'],delivery_failed:['Falha','red'],waiting_contact:['Falha','red'],waiting_service:['Falha','red'],
  uncertain:['Verificar','amber'],partial:['Verificar','amber'],delivery_partial:['Verificar','amber'],
  quiet:['Silenciado','gray'],held:['Silenciado','gray'],cancelled:['Cancelado','gray'],
};
for(const [state,[label,tone]] of Object.entries(mapping))assert.deepEqual({...deliveryStatus(state)},{label,tone},state);
for(const state of ['in_app','unknown','anything'])assert.equal(deliveryStatus(state),null,`${state}: no chip`);
assert.equal(new Set(Object.values(mapping).map(([label])=>label)).size,8,'Six labels, Enviado turning into Entregue or Lido');
// The states the backend writes, read from its constants: a new one fails here until it gets a chip or a decided null.
const backend=file=>fs.readFileSync(path.join(__dirname,'../backend',file),'utf8');
const tuple=(source,name)=>{const m=source.match(new RegExp(name+'\\s*=\\s*[({]([^)}]*)[)}]'));assert.ok(m,name);return [...m[1].matchAll(/'([a-z_]+)'/g)].map(x=>x[1]);};
const notifications=backend('notifications.py');
const outboxStates=[...tuple(notifications,'OUTBOX_STATES'),...tuple(notifications,'DERIVED_STATES')],alertStates=tuple(notifications,'ALERT_STATES'),receiptStates=tuple(backend('whatsapp_receipts.py'),'STATES');
const nothing=['in_app','unknown'];
for(const state of [...outboxStates,...alertStates])assert.ok(state in mapping||nothing.includes(state),`${state}: no chip decided`);
for(const state of nothing)assert.equal(deliveryStatus(state),null);
// Receipts: 'pending' is ignored by the backend; the others become the chip states below.
const receiptChip={sent:'confirmed_sent',delivered:'delivered',read:'read',failed:'delivery_failed'};
for(const state of receiptStates)assert.ok(state==='pending'||state in receiptChip,`receipt ${state}: no chip decided`);
for(const state of Object.values(receiptChip))assert.ok(state in mapping);
// States the frontend makes from counts and receipts: partial, queued, delivery_partial, confirmed_sent and unknown.
for(const state of ['partial','queued','delivery_partial','confirmed_sent'])assert.ok(state in mapping);
assert.ok(outboxStates.length>=10&&alertStates.length>=12&&receiptStates.length===5,'Constants read from the backend');
console.log('Delivery states: every queue, alert, receipt and aggregate state from the backend constants to one of six labels in four colors; in_app and unknown show nothing passed.');
assert.equal(channelState({sent:2}),'sent');assert.equal(channelState({sent:1,failed:1}),'partial');assert.equal(channelState({sent:1,pending:1}),'queued');assert.equal(channelState({uncertain:1}),'uncertain');assert.equal(channelState({failed:1}),'failed');
assert.equal(channelState({waiting_contact:1,cancelled:2}),'waiting_contact','A mix without a sent message shows its problem, not nothing');
function render(event){return renderToStaticMarkup(React.createElement(DeliveryChannels,{event}));}
const chips=html=>[...html.matchAll(/<span class="status-chip tone-(\w+)" title="([^"]*)">(<svg[\s\S]*?<\/svg>)?<span aria-hidden="true">([^<]*)<\/span><span class="sr-only">([^<]*)<\/span><\/span>/g)].map(m=>({tone:m[1],title:m[2],icon:!!m[3],label:m[4],name:m[5]}));
let html=render({status:'partial',channels:[{channel:'email',counts:{failed:1}},{channel:'whatsapp',counts:{sent:1}}]});
let list=chips(html);
assert.deepEqual(list.map(c=>[c.label,c.tone]),[['Enviado','green'],['Falha','red']],'WhatsApp first; short label and color');
assert.ok(list.every(c=>c.icon&&c.title===c.name),'Channel icon on screen; the same detail in the tooltip and the accessible name');
assert.equal(list[1].name,'E-mail: Falha · Falha no envio');
for(const phrase of ['Aceito','não confirma entrega','registros incompletos','<details','Telegram'])assert.ok(!html.includes(phrase),`No "${phrase}" for the person`);
list=chips(render({status:'partial',channels:[{channel:'whatsapp',counts:{sent:1,failed:1}}]}));
assert.deepEqual([list[0].label,list[0].tone,list[0].name],['Verificar','amber','WhatsApp: Verificar · Envio parcial · 1 de 2 destinatários']);
list=chips(render({status:'waiting_contact',channels:[{channel:'whatsapp',counts:{waiting_contact:1}}]}));
assert.deepEqual([list[0].label,list[0].tone,list[0].name],['Falha','red','WhatsApp: Falha · Sem destinatário']);
console.log('Channel chips: icon and short colored label, WhatsApp first, the technical state and counts only in the name and tooltip passed.');
// WhatsApp receipts turn Enviado into Entregue or Lido; partial or failed delivery has its own state.
const receipt=(counts,receipts,channel='whatsapp')=>chips(render({status:'sent',channels:[{channel,counts,receipts}]}))[0];
assert.deepEqual([receipt({sent:1},{read:1}).label,receipt({sent:1},{read:1}).tone],['Lido','green']);
assert.equal(receipt({sent:1},{read:1}).name,'WhatsApp: Lido · Entregues: 1/1 · Lidas: 1');
assert.deepEqual([receipt({sent:2},{delivered:2}).label,receipt({sent:2},{delivered:2}).tone],['Entregue','green']);
assert.equal(receipt({sent:3},{read:1,delivered:1,sent:1}).label,'Enviado');
assert.deepEqual([receipt({sent:2},{read:1,failed:1}).label,receipt({sent:2},{read:1,failed:1}).tone],['Verificar','amber']);
assert.ok(receipt({sent:2},{read:1,failed:1}).name.includes('Falhas de entrega: 1'));
assert.deepEqual([receipt({sent:1},{failed:1}).label,receipt({sent:1},{failed:1}).tone],['Falha','red']);
assert.equal(receipt({sent:1},{read:1},'email').label,'Enviado','E-mail has no receipts');
console.log('Receipts: Entregue and Lido in green, partial delivery to Verificar, failed delivery to Falha, e-mail unaffected passed.');
// Kept in the app or without records: no chip. Old alerts without channel records keep one chip for their state.
assert.equal(render({status:'in_app'}),'');assert.equal(render({status:'unknown',channels:[]}),'');assert.equal(render({status:'in_app',channels:[{channel:'email',counts:{in_app:1}}]}),'');
list=chips(render({status:'quiet'}));assert.deepEqual([list[0].label,list[0].tone],['Silenciado','gray']);
list=chips(render({status:'sent',channels:[{channel:'telegram',counts:{sent:1}}]}));assert.deepEqual([list[0].label,list[0].name],['Enviado','Telegram: Enviado']);
console.log('No chip for the app only or unknown states; older records and future channels keep theirs passed.');
// Held by quiet hours: Silenciado in gray (never "Enviando" for hours), the time it goes out in its name.
const morning=new Date(2090,0,2,7,0).getTime()/1000;
list=chips(render({status:'queued',channels:[{channel:'whatsapp',counts:{held:1},held_until:morning}]}));
assert.deepEqual([list[0].label,list[0].tone,list[0].name],['Silenciado','gray','WhatsApp: Silenciado · sai às 07:00']);
// On the account's clock: 10:00 UTC reads 07:00 for an account in São Paulo, whatever the device.
list=chips(render({status:'queued',channels:[{channel:'whatsapp',counts:{held:1},held_until:Date.UTC(2090,0,2,10,0)/1000,held_zone:'America/Sao_Paulo'}]}));
assert.equal(list[0].name,'WhatsApp: Silenciado · sai às 07:00');
assert.equal(channelState({held:1,sent:1}),'held');assert.equal(channelState({held:1,pending:1}),'queued');
console.log('Held deliveries: Silenciado in gray with the time they go out passed.');

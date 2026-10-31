// Isolated source/fixture rendering, not inspection of the blocked browser origin.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fromFrontend=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json'));
const React=fromFrontend('react'),{renderToStaticMarkup}=fromFrontend('react-dom/server'),ts=fromFrontend('typescript'),cache=new Map();
function load(file){if(cache.has(file))return cache.get(file);const out={};cache.set(file,out);const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src/',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;vm.runInNewContext(code,{exports:out,require:name=>{
 if(name.endsWith('.css'))return {};
 if(name==='./tripSummary')return {legDates:leg=>leg.start};
    if(name==='./i18n')return {useLanguage:()=> 'pt',getLocale:()=> 'pt-BR',t:(key,args=[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[Number(i)]))};
 if(name==='./currency')return {currencies:['BRL'],currencyLabel:()=> 'BRL'};
 if(name==='./DatePicker')return {DatePicker:()=>null};
 if(name==='./AirportPicker')return {AirportPicker:()=>null};
 if(name==='./ui')return {Button:({children,variant,...props})=>React.createElement('button',props,children)};
 if(name==='./passengers')return load('passengers.ts');
 if(name==='./searchJourney')return load('searchJourney.ts');
 if(name==='./AirlinePicker')return load('AirlinePicker.tsx');
 if(name==='./format')return load('format.ts');
 if(name==='./combobox')return load('combobox.ts');
 if(name==='./plural')return load('plural.ts');
 if(name==='./navigation')return {routePath:()=> '/perfil',plainClick:()=>false};
 if(name==='./RouteSummary')return {RouteCodes:()=>null,RoutePlaces:()=>null};
 if(name==='./AlertChannels')return load('AlertChannels.tsx');
 if(name==='./InfoTip')return load('InfoTip.tsx');
 return fromFrontend(name);
 }});return out;}
const leg={start:'2090-11-05T22:00',end:'2090-11-06T06:00',arrival_before:null,stops:[0,1,2],max_duration:1440,max_layover:null,airlines:[]};
const config={origins:['THE'],destinations:['GRU'],outbound:leg,inbound:null,checked_bags:1,currency:'BRL',adults:1,cabin:'economy',interval:300,min_drop_cents:5000,target_cents:null,notify_email:false,name:'Fixture',language:'pt'};
const {SearchForm}=load('SearchForm.tsx');
const html=renderToStaticMarkup(React.createElement(SearchForm,{config,setConfig:()=>{},airports:[],onSave:()=>{},saving:false,general:true,editing:true}));
assert.ok(html.includes('role="combobox"'));assert.ok(html.includes('Nome ou sigla: LATAM, LA…'));assert.ok(html.includes('Sem seleção, todas as companhias.'));
assert.ok(!html.includes('Ex.: LA, BA, AA'));assert.ok(!html.includes('Códigos IATA de dois caracteres'));
assert.ok(!html.includes('Trecho a configurar'),'One-way preferences do not waste a row on the only direction');
assert.ok(html.includes('Duração máxima da viagem: horas'));assert.ok(html.includes('Duração máxima da viagem: minutos'));
assert.ok(html.includes('Taxas estimadas nos dois trechos'));assert.ok(html.includes('Chegada e conexões'));
assert.ok(/<details class="advanced-options">/.test(html),'Advanced arrival and connection controls start collapsed');
const {AirlinePicker}=load('AirlinePicker.tsx');const selected=renderToStaticMarkup(React.createElement(AirlinePicker,{values:['LA','BA'],onChange:()=>{}}));
assert.ok(selected.includes('Remover companhia LA'));assert.ok(selected.includes('Remover companhia BA'));assert.ok(selected.includes('A busca usará somente as companhias selecionadas.'));
console.log('Compact preferences: airline combobox, selected tokens, one-way, duration units, baggage and collapsed advanced fields passed.');
const trip=renderToStaticMarkup(React.createElement(SearchForm,{config:{...config,children:1,infants_in_seat:0,infants_on_lap:0},setConfig:()=>{},airports:[],onSave:()=>{},saving:false,general:true}));
assert.ok(trip.indexOf('Adultos') < trip.indexOf('Crianças'));assert.ok(trip.includes('Intervalo de saída da ida'));assert.ok(!trip.includes('Agora escolha a janela'));assert.ok(/<details class="infant-options">/.test(trip));assert.ok(trip.includes('trip-options-row'));assert.ok(trip.includes('Crianças'));assert.ok(trip.includes('Bebês com assento'));assert.ok(trip.includes('Cabine'));assert.ok(!trip.includes('Nome e cabine'));assert.ok(!trip.includes('Nome da viagem (opcional)'));
assert.ok(/<span id="([^"]+)">Crianças<\/span><span class="counter-hint" id="\1-hint">2 a 11 anos<\/span>/.test(trip),'Children show the source age range');assert.equal((trip.match(/<span class="counter-hint" id="[^"]+">Menores de 2 anos<\/span>/g)||[]).length,2,'Both infant rows show the age limit');assert.ok(/role="group" aria-labelledby="([^"]+)" aria-describedby="\1-hint"/.test(trip),'The age range describes its counter');assert.ok(!/Adultos<\/span><span class="counter-hint"/.test(trip),'Adults have no hint');
const quick=renderToStaticMarkup(React.createElement(SearchForm,{config,setConfig:()=>{},airports:[],onSave:()=>{},saving:false}));
assert.ok(quick.includes('compact-filters'));assert.ok(quick.includes('Horários e conexões'));assert.ok(quick.includes('flight-more-options'));assert.ok(quick.includes('monitor-filters'));assert.ok(!quick.includes('Enviar alertas'));assert.ok(!quick.includes('Moeda da pesquisa'));assert.equal((quick.match(/<legend>Bagagem despachada<\/legend>/g)||[]).length,1);
const alerts=renderToStaticMarkup(React.createElement(SearchForm,{config:{...config,notify_email:true,adults:2,children:1},setConfig:()=>{},airports:[],emailRecipients:['fixture@example.org'],onSave:()=>{},saving:false,alertsOnly:true}));
assert.ok(alerts.includes('alert-settings-form'));assert.ok(alerts.includes('Enviar alertas'));assert.ok(alerts.includes('Salvar alertas'));assert.ok(alerts.includes('fixture@example.org'));assert.ok(alerts.includes('3 passageiros'));assert.ok(!alerts.includes('Escalas permitidas'));assert.ok(!alerts.includes('Janela de saída'));assert.ok(!alerts.includes('monitor-filters'));assert.ok(alerts.includes("Altere a moeda na etapa Viagem")); assert.ok(!alerts.includes("currency-explanation")); assert.ok(trip.includes("Ao trocar a moeda"));
console.log('Quick filters and alert settings are isolated; party pricing and saved recipients remain visible.');

const wa=renderToStaticMarkup(React.createElement(SearchForm,{config:{...config,notify_email:false,notify_whatsapp:true},setConfig:()=>{},airports:[],onSave:()=>{},saving:false,alertsOnly:true,whatsappAvailable:true,whatsappRecipients:['+12025550123','+12025550123','+442079460018']}));
assert.equal((wa.match(/\+1 20· ··· 0123<\/span>/g)||[]).length,2,'Each number once in the row, the first in the line');assert.equal((wa.match(/\+44 20 ···· 0018<\/span>/g)||[]).length,1);assert.ok(wa.includes('terminado em 0018')&&wa.includes('e mais 1'),'Formatted, masked, read as its last digits');assert.ok(wa.includes('Você será avisado por:'));assert.ok(wa.includes('Sobre os canais de alerta'),'The help sits behind an info button');assert.ok(!wa.includes('Telegram'));assert.ok(!wa.includes('Adicione até quatro e-mails'));assert.ok(wa.includes('type="checkbox"'));assert.ok(!wa.includes('type="radio"'));

const unlimited=renderToStaticMarkup(React.createElement(SearchForm,{config:{...config,outbound:{...leg,max_duration:null}},setConfig:()=>{},airports:[],onSave:()=>{},saving:false,general:true,editing:true}));
assert.ok(unlimited.includes('Sem limite de duração, incluindo conexões.'));assert.ok(!unlimited.includes('Duração máxima da viagem: horas'));

const review=renderToStaticMarkup(React.createElement(SearchForm,{config:{...config,currency:'USD'},savedCurrency:'BRL',setConfig:()=>{},airports:[],onSave:()=>{},saving:false,general:true,editing:true,journey:{step:2,direction:'outbound',onChange:()=>{}}}));
assert.ok(review.includes('Revisei os valores de alerta na nova moeda.'), 'Reopened currency draft requires reviewing values');
assert.ok(/type="checkbox" required=""/.test(review), 'Review is required in the values stage');

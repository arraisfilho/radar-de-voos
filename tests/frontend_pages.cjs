// Complete page rendering with owned fixtures. No browser origin, account or transport is accessed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),React=req('react'),ts=req('typescript'),{renderToStaticMarkup}=req('react-dom/server');
let route={view:'home'},stateIndex=0,role='admin',profileEdit=false;
const leg={start:'2090-11-05T00:00',end:'2090-11-05T23:59',arrival_before:null,stops:[0,1,2],max_duration:null,max_layover:null,airlines:[]};
const config={name:'Trip fixture',origins:['THE'],destinations:['GRU'],outbound:leg,inbound:{...leg,start:'2090-11-09T00:00',end:'2090-11-10T23:59'},adults:1,children:0,infants_in_seat:0,infants_on_lap:0,cabin:'economy',currency:'BRL',language:'pt',interval:300,checked_bags:0,target_cents:null,min_drop_cents:5000,notify_email:false,notify_whatsapp:false};
const search={id:'monitor-10',active:1,version:1,ends_at:4000000000,state:'scheduled',config,last_finished:1,last_success:1,next_due:300,summary:{outbound:{price:110800}}};
const user={id:'customer-1',name:'User fixture',phone:'+12025550123',country:'US',role:'admin',emails:['fixture@example.org'],search_limit:5,whatsapp_use_login:true,whatsapp_country:'US',whatsapp_phone:'+12025550123',telegram_username:'',additional_phones:[],timezone:'UTC',quiet_hours:false,quiet_start:'22:00',quiet_end:'08:00'};
const data={searches:[search],archived:[],selected:search,airports:[],token:'fixture',user,server_time:10,smtp:null,google_mail:null,whatsapp_available:false,email_available:false,flights:[],routes:[],history:[],alerts:[],deliveries:[],cycles:[],alert_total:0};
const modules=new Map();
function load(file){if(modules.has(file))return modules.get(file);const out={};modules.set(file,out);const source=fs.readFileSync(path.join(__dirname,'../frontend/src',file),'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
vm.runInNewContext(code,{exports:out,URLSearchParams,Intl,structuredClone,Date,Map,Set,navigator:{language:'pt-BR'},require:n=>{
if(n.endsWith('.css'))return {};
if(n.endsWith('.json'))return req(path.resolve(__dirname,'../frontend/src',n));
if(n==='react')return {...React,useEffect(){},useState:initial=>{const i=stateIndex++;let value=i===0||i===6?structuredClone(config):typeof initial==='function'?initial():initial;if(profileEdit&&value&&typeof value==='object'&&'whatsapp_use_login' in value)value={...value,name:'Edited fixture'};return [value,()=>{}]}};
if(n==='./navigation')return {...load('navigation.ts'),useNavigation:()=>({route,navigate(){},restoreScroll(){}})};
if(n==='./navigationGuard')return {useUnsavedChanges(){},afterSave:cb=>cb()};
if(n==='./i18n')return {useLanguage:()=> 'pt',usePendingLanguage:()=>null,useLanguageReady:()=>true,getLanguage:()=> 'pt',getLocale:()=> 'pt-BR',t:(key,args=[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[i]??''))};
if(n==='@tanstack/react-query')return {useQueryClient:()=>({}),useQuery:({queryKey})=>({data:queryKey[0]==='radar'?{...data,user:{...user,role},selected:route.view==='home'?null:search}:queryKey[0]==='trend'?{points:[{id:1,collected:10,price:110800,direction:'outbound',currency:'BRL'},{id:2,collected:20,price:110800,direction:'outbound',currency:'BRL'}],versions:[1]}:queryKey[0]==='admin-delivery'?{id:'message-1',subject:'Fixture message',channel:'whatsapp',kind:'alert',status:'sent',created:1,completed:1,recipients:['+12025550123'],body:'Fixture body',attempts:1}:queryKey[0]==='audit'?{items:[],total:0,page_size:25,days:45,max_records:20000}:{items:[],total:0,page_size:15,totals:{}},dataUpdatedAt:1,isError:false,isLoading:false})};
if(n.startsWith('./'))return load(n.slice(2)+(n.endsWith('.ts')||n.endsWith('.tsx')?'':fs.existsSync(path.join(__dirname,'../frontend/src',n.slice(2)+'.tsx'))?'.tsx':'.ts'));
if(n==='../package.json')return {version:'0.23.0'};
return req(n);
}});return out;}
const App=load('App.tsx').default;
function render(next){route=next;stateIndex=0;return renderToStaticMarkup(React.createElement(App,{onLogout:async()=>{}}));}
(async()=>{
let html=render({view:'home'});const mobile=html.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)[0];assert.equal((mobile.match(/<a /g)||[]).length,4,'Four mobile destinations as real links');assert.ok(!mobile.includes('<button'));assert.ok(!mobile.includes('Administração'));assert.ok(html.includes('Nova viagem'));
// The page draft differs from the saved trip: pending changes, or the previous trip's draft until the draft effect runs.
const withChangedTrip=fn=>{const saved=search.config;search.config={...config,outbound:{...leg,stops:[0]}};try{return fn();}finally{search.config=saved;}};
// Before the form's code is in, no change can be pending: that draft is a previous trip's and loads nothing.
html=withChangedTrip(()=>render({view:'searches',searchId:search.id}));assert.ok(html.includes('<div class="quick-filters-body"></div>'),'A draft left from another trip does not download the form');
// The card owns its filters: TripFlights alone, called as a function, with a state that keeps its value.
function isolated(file){let state;const out={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports:out,require:n=>n==='react'?{...React,useState:initial=>[state===undefined?(state=initial):state,next=>{state=next;}]}:n==='./i18n'?{t:(key,args=[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[i]??''))}:n.startsWith('./')?load(n.slice(2)+(fs.existsSync(path.join(__dirname,'../frontend/src',n.slice(2)+'.tsx'))?'.tsx':'.ts')):req(n)});return out;}
const {TripFlights}=isolated('TripFlights.tsx'),findType=(node,type)=>{if(Array.isArray(node)){for(const child of node){const found=findType(child,type);if(found)return found;}return null;}return !node||typeof node!=='object'?null:node.type===type?node:findType(node.props?.children,type);};
const tripProps={search,config,user,flights:[],direction:'outbound',onDirection(){},visibleCount:40,onShowMore(){},previewing:false,previewCompatible:true,serverNow:10,pendingFilters:false,filters:React.createElement('form',{id:'monitor-filters'}),onConfigureAlerts(){},onShowAlerts(){},onManageContacts(){}};
const cardBody=tree=>renderToStaticMarkup(tree).match(/<div class="quick-filters-body">(.*?)<\/div><\/details>/)[1];
let card=TripFlights(tripProps);assert.equal(cardBody(card),'','The closed card has no form');
assert.ok(!renderToStaticMarkup(card).includes('filters-count'),'No filter on: no count');
assert.ok(/class="filters-count">2<span class="sr-only"> filtros ativos/.test(renderToStaticMarkup(TripFlights({...tripProps,config:{...config,outbound:{...leg,stops:[0],airlines:['LA']}}}))),'Two filters on: 2');
findType(card,'details').props.onToggle({currentTarget:{open:true}});card=TripFlights(tripProps);assert.equal(cardBody(card),'<form id="monitor-filters"></form>','Opening the card mounts the filters');
findType(card,'details').props.onToggle({currentTarget:{open:false}});card=TripFlights(tripProps);assert.equal(cardBody(card),'<form id="monitor-filters"></form>','Closing it keeps them, and their state');
// The app's card, open before the form's code is in: the compact skeleton stays in the card body, inside a boundary of its own.
// (React's development build also calls the component without props, to describe component stacks.)
const tripModule=modules.get('TripFlights.tsx'),appTripFlights=tripModule.TripFlights;let cardProps;tripModule.TripFlights=props=>{if(props)cardProps=props;return TripFlights(props);};
try{html=render({view:'searches',searchId:search.id});}finally{tripModule.TripFlights=appTripFlights;}
assert.ok(html.includes('<div class="quick-filters-body"><div class="form-skeleton" role="status"><span class="sr-only">Carregando…</span><span class="skeleton skeleton-field" aria-hidden="true"></span>'),'The open card shows the compact skeleton while the form loads');
const {ErrorBoundary}=load('ErrorBoundary.tsx');assert.equal(cardProps.filters.type,ErrorBoundary);assert.equal(cardProps.filters.props.scope,'section','A form that cannot load fails inside the card');assert.equal(cardProps.filters.props.resetKey,search.id+':'+search.version,'A new trip version clears the card error');
const failed=new ErrorBoundary({scope:'section',children:null});failed.state=ErrorBoundary.getDerivedStateFromError(Error('chunk'));
assert.ok(/^<div class="section-error" role="alert">[\s\S]*Não foi possível carregar[\s\S]*Recarregue para tentar de novo\.[\s\S]*<button[^>]*>[\s\S]*Recarregar<\/button><\/div>$/.test(renderToStaticMarkup(failed.render())),'The card shows the error and Recarregar');
// The trip form loads on demand: the editor title is there at once, with the form skeleton inside <main>, then the form.
// The skeleton checks above and below hold only until the form's code resolves: no await before the one that ends them.
html=render({view:'home',editor:'new',step:0,leg:'outbound'});const editorMain=html.slice(html.indexOf('<main'),html.indexOf('</main>'));
assert.ok(editorMain.includes('<div class="search-page-body"><div class="form-skeleton" role="status">'),'The form skeleton stays in the editor body, inside <main>');assert.ok(editorMain.includes('<h1 id="editor-title" tabindex="-1">Nova viagem</h1>'),'The editor title is on screen before the form');assert.ok(!html.includes('search-wizard'));
// The alert settings open on their fields: their skeleton has no steps.
html=render({view:'searches',searchId:search.id,editor:'alerts'});assert.ok(html.includes('<div class="search-page-body"><div class="form-skeleton" role="status">'));assert.ok(!html.includes('form-skeleton-steps'),'The alerts skeleton has no steps');await new Promise(resolve=>setImmediate(resolve));
for(const stage of [{step:0,leg:'outbound'},{step:1,leg:'inbound'},{step:2,leg:'outbound'}]){html=render({view:'home',editor:'new',...stage});assert.ok(html.includes('class="search-page"'));assert.ok(!html.includes('dialog-overlay'));assert.ok(!html.includes('role="dialog"'));assert.ok(!html.includes('home-grid'));if(stage.step===1)assert.ok(html.includes('Usar as preferências da ida'));if(stage.step===2){assert.ok(html.includes('Nome da viagem'));assert.ok(html.includes('Enviar alertas'));}}
html=render({view:'searches',searchId:search.id,editor:'edit',step:0,leg:'outbound'});assert.ok(html.includes('Editar viagem'));assert.ok(!html.includes('route-card'));assert.ok(!html.includes('role="dialog"'));
html=render({view:'searches',searchId:search.id,editor:'alerts'});assert.ok(html.includes('Salvar alertas'));assert.ok(!html.includes('Escalas permitidas'));
html=render({view:'searches',searchId:search.id,panel:'alerts'});assert.ok(html.includes('Nenhum alerta para esta viagem.'));assert.ok(!html.includes('Melhores opções'));
html=render({view:'history',searchId:search.id});assert.ok(html.includes('Preço estável neste período'));assert.ok(!html.includes('history-direction'),'A one-direction series has no redundant direction selector');
// Administration loads on demand: the first render shows the skeleton inside <main>, then the panel.
html=render({view:'admin',section:'deliveries',deliveryId:'message-1'});assert.ok(html.includes('view-skeleton'));assert.ok(html.includes('class="sidebar"'),'The shell stays mounted while a view loads');await new Promise(resolve=>setImmediate(resolve));
html=render({view:'admin',section:'deliveries',deliveryId:'message-1'});assert.ok(html.includes('task-page delivery-detail'));assert.ok(html.includes('Fixture body'));assert.ok(!html.includes('role="dialog"'));assert.ok(!html.slice(html.indexOf('<main'),html.indexOf('</main>')).includes('Nova viagem'));
html=render({view:'searches',searchId:search.id});
// Lowest fares and the trip's alerts share one block, ahead of the filters and the flights.
const summary=(html.match(/<section class="card trip-summary[^"]*"[\s\S]*?<\/section>/)||[''])[0];
assert.ok(summary.includes('Menor ida')&&summary.includes('Alertas desta viagem')&&summary.includes('Configurar alertas'),'One block for fares and alerts');
assert.ok(!html.includes('metrics-grid')&&!html.includes('trip-alerts-card')&&!html.includes('filters-card'));
assert.ok(!summary.includes('Avisaremos')&&!summary.includes('A primeira coleta'),'Target and minimum drop are said once; no phrase after the first collection');
assert.ok(!/<\/span>\s*·\s*Sem meta/.test(summary)&&summary.includes('Sem meta de preço · Queda mínima'),'No loose dot after the channel icons');
// "Filtros" sits in the list bar and drives the panel under it.
const bar=(html.match(/<div class="results-head">[\s\S]*?<\/div><details/)||[''])[0];
assert.ok(/<button[^>]*class="[^"]*filters-button[^"]*"[^>]*aria-expanded="false"[^>]*aria-controls="trip-filters-panel"/.test(bar),'Filtros in the list bar');
const status=html.match(/<div class="route-live">[\s\S]*?<\/div>/)[0];
assert.ok(status.includes('Última atualização:'));assert.ok(!status.includes('<button'));assert.ok(!status.includes('chevron-right'));assert.ok(!html.includes('Acompanhamento ao vivo'));assert.ok(!html.includes('inline-status'));
// The trip filters mount when their card first opens: closed and without pending changes, there is no form (nor its skeleton) yet.
assert.ok(html.includes('<div class="quick-filters-body"></div>'),'A closed filters card starts empty');assert.ok(!html.includes('id="monitor-filters"'));
// Pending changes mount the form in the closed card, as the pending bar submits it and its validation opens the card.
html=withChangedTrip(()=>render({view:'searches',searchId:search.id}));
assert.ok(/<details id="trip-filters-panel" class="filters-panel"><summary>[\s\S]*?<\/summary><div class="quick-filters-body"><form id="monitor-filters"/.test(html),'Pending changes keep the form in the closed panel');assert.ok(html.includes('form="monitor-filters"'),'The pending bar submits that form');
// The profile loads on demand (phone fields): the skeleton stays inside <main> first, then the form.
html=render({view:'settings'});assert.ok(html.includes('view-skeleton'));assert.ok(html.includes('class="sidebar"'));await new Promise(resolve=>setImmediate(resolve));
html=render({view:'settings'});const profileForm=html.match(/<form class="profile-form"[\s\S]*?<\/form>/)[0];
assert.equal((profileForm.match(/<form/g)||[]).length,1);assert.ok(profileForm.includes('profile-contacts'));assert.ok(profileForm.includes('profile-preferences'));assert.ok(profileForm.includes('E-mails de alerta'));assert.ok(profileForm.includes('Outros números de WhatsApp'));assert.ok(profileForm.includes('Horário silencioso'));assert.ok(!profileForm.includes('type="submit"'),'Nothing to save before a change');assert.ok(!profileForm.includes('Sair da conta'));assert.ok(!html.includes('account-preferences card'));
assert.ok(/<a[^>]*href="\/admin\/envios"[^>]*>[\s\S]*?Administração/.test(profileForm),'Administration is a link, so it never submits the profile form');
profileEdit=true;html=render({view:'settings'});profileEdit=false;const editedForm=html.match(/<form class="profile-form"[\s\S]*?<\/form>/)[0];
assert.ok(/<section class="list-section profile-account">[\s\S]*?<button[^>]*type="submit"[^>]*>Salvar<\/button>/.test(editedForm),'The changed block carries its own Salvar');assert.ok(!/profile-contacts">[\s\S]*?type="submit"[\s\S]*?profile-preferences/.test(editedForm),'Unchanged blocks show no Salvar');assert.ok(/<button[^>]*type="submit"[^>]*form="profile-form"/.test(html),'The phone save bar submits the same form');
role='user';html=render({view:'admin',section:'users'});assert.ok(html.includes('exclusiva de administradores'));assert.ok(!html.includes('Cadastro de usuários'));
console.log('Complete pages: four mobile destinations, page-based wizard/editor/alerts, read-only messages, stable chart and admin visibility passed.');

// A trip keeps its identity, header and section position on every tab.
const tripPages=[{view:'searches',searchId:search.id},{view:'history',searchId:search.id},{view:'searches',searchId:search.id,panel:'alerts'}].map(render);
for(const page of tripPages){
 assert.equal((page.match(/class="card route-card( is-listing)?"/g)||[]).length,1);
 assert.equal((page.match(/class="monitor-sections"/g)||[]).length,1);
 assert.ok(page.indexOf('route-card') < page.indexOf('monitor-sections'));
 const mainNav=page.match(/<nav aria-label="Navegação principal">([\s\S]*?)<\/nav>/)[1];
 assert.ok(/class="selected"[^>]*>[\s\S]*?Viagens/.test(mainNav));
 assert.ok(!page.includes('history-selector'));
}
console.log('Trip headers and navigation remain shared across flights, history and alerts.');

html=render({view:'searches',searchId:search.id});assert.ok(/09\/11\s*–\s*10\/11/.test(html),'Return results show the complete date window');
html=render({view:'home',editor:'new',step:2,leg:'outbound'});
for(const label of ['Escalas permitidas','Duração máxima da viagem','Máximo por conexão','Editar viagem','Editar preferências'])assert.ok(html.includes(label),`Review includes ${label}`);

data.searches.push({...search,id:'monitor-20'});
for (const page of [{view:'searches',searchId:search.id},{view:'history',searchId:search.id},{view:'searches',searchId:search.id,panel:'alerts'}].map(render)) {
 assert.ok(page.includes('trip-switcher'), 'Every trip tab exposes the shared trip selector when multiple trips exist');
 const footer=page.match(/<footer class="page-footer">([\s\S]*?)<\/footer>/)?.[1] || '';
 assert.ok(!footer.includes('Excluir monitoramento'), 'Destructive action belongs in trip actions');
}
// The history of an ended trip keeps the trip selector, with the ended trips in a group of their own.
const following=data.searches;data.searches=[{...search,id:'monitor-20'}];data.archived=[search];
html=render({view:'history',searchId:search.id});
const switcher=(html.match(/<label class="trip-switcher">[\s\S]*?<\/label>/)||[''])[0];
assert.ok(switcher.includes('<optgroup label="Em acompanhamento">'),'Trips still monitored come first');
assert.ok(/<optgroup label="Encerradas"><option value="monitor-10" selected="">/.test(switcher),'The ended trip is listed with the ended ones, selected');
data.searches=following;data.archived=[];
console.log('Ended trip history: trip selector with the ended trips group passed.');
// The alert settings write the access phone as the server formats it (phone_display), once.
user.phone_display='+1 202-555-0123';user.additional_phones=[{country:'US',phone:'+12025550123'}];data.whatsapp_available=true;
html=render({view:'searches',searchId:search.id,editor:'alerts'});
assert.ok(html.includes('<span aria-hidden="true">+1 20· ··· 0123</span><span class="sr-only">terminado em 0123</span></small>'),'Formatted, masked, and the same number is not repeated');
delete user.phone_display;user.additional_phones=[];data.whatsapp_available=false;
console.log('Alert settings: formatted WhatsApp access phone passed.');
// The trip card points to the profile when a channel on has no contact, WhatsApp included.
config.notify_whatsapp=true;user.whatsapp_phone=null;data.whatsapp_available=true;
html=render({view:'searches',searchId:search.id});
assert.ok(html.includes('Cadastre um número de WhatsApp no perfil para receber alertas.'),'WhatsApp on without a number');
config.notify_whatsapp=false;user.whatsapp_phone='+12025550123';data.whatsapp_available=false;
html=render({view:'searches',searchId:search.id});
assert.ok(!html.includes('Cadastre um número de WhatsApp')&&!html.includes('Adicione seus e-mails'),'Nothing to fix');
console.log('Trip alerts card: the contact link for WhatsApp without a number passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});

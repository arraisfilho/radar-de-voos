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
if(n==='./i18n')return {useLanguage:()=> 'pt',getLanguage:()=> 'pt',getLocale:()=> 'pt-BR',t:(key,args=[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[i]??''))};
if(n==='@tanstack/react-query')return {useQueryClient:()=>({}),useQuery:({queryKey})=>({data:queryKey[0]==='radar'?{...data,user:{...user,role},selected:route.view==='home'?null:search}:queryKey[0]==='trend'?{points:[{id:1,collected:10,price:110800,direction:'outbound',currency:'BRL'},{id:2,collected:20,price:110800,direction:'outbound',currency:'BRL'}],versions:[1]}:queryKey[0]==='admin-delivery'?{id:'message-1',subject:'Fixture message',channel:'whatsapp',kind:'alert',status:'sent',created:1,completed:1,recipients:['+12025550123'],body:'Fixture body',attempts:1}:queryKey[0]==='audit'?{items:[],total:0,page_size:25,days:45,max_records:20000}:{items:[],total:0,page_size:15,totals:{}},dataUpdatedAt:1,isError:false,isLoading:false})};
if(n.startsWith('./'))return load(n.slice(2)+(n.endsWith('.ts')||n.endsWith('.tsx')?'':fs.existsSync(path.join(__dirname,'../frontend/src',n.slice(2)+'.tsx'))?'.tsx':'.ts'));
if(n==='../package.json')return {version:'0.23.0'};
return req(n);
}});return out;}
const App=load('App.tsx').default;
function render(next){route=next;stateIndex=0;return renderToStaticMarkup(React.createElement(App,{onLogout:async()=>{}}));}
(async()=>{
let html=render({view:'home'});const mobile=html.match(/<nav class="mobile-nav"[\s\S]*?<\/nav>/)[0];assert.equal((mobile.match(/<a /g)||[]).length,4,'Four mobile destinations as real links');assert.ok(!mobile.includes('<button'));assert.ok(!mobile.includes('Administração'));assert.ok(html.includes('Nova viagem'));
for(const stage of [{step:0,leg:'outbound'},{step:1,leg:'inbound'},{step:2,leg:'outbound'}]){html=render({view:'home',editor:'new',...stage});assert.ok(html.includes('class="search-page"'));assert.ok(!html.includes('dialog-overlay'));assert.ok(!html.includes('role="dialog"'));assert.ok(!html.includes('home-grid'));if(stage.step===1)assert.ok(html.includes('Usar as preferências da ida'));if(stage.step===2){assert.ok(html.includes('Nome da viagem'));assert.ok(html.includes('Enviar alertas'));}}
html=render({view:'searches',searchId:search.id,editor:'edit',step:0,leg:'outbound'});assert.ok(html.includes('Editar viagem'));assert.ok(!html.includes('route-card'));assert.ok(!html.includes('role="dialog"'));
html=render({view:'searches',searchId:search.id,editor:'alerts'});assert.ok(html.includes('Salvar alertas'));assert.ok(!html.includes('Escalas permitidas'));
html=render({view:'searches',searchId:search.id,panel:'alerts'});assert.ok(html.includes('Nenhum alerta para esta viagem.'));assert.ok(!html.includes('Melhores opções'));
html=render({view:'history',searchId:search.id});assert.ok(html.includes('Preço estável neste período'));assert.ok(!html.includes('history-direction'),'A one-direction series has no redundant direction selector');
// Administration loads on demand: the first render shows the skeleton inside <main>, then the panel.
html=render({view:'admin',section:'deliveries',deliveryId:'message-1'});assert.ok(html.includes('view-skeleton'));assert.ok(html.includes('class="sidebar"'),'The shell stays mounted while a view loads');await new Promise(resolve=>setImmediate(resolve));
html=render({view:'admin',section:'deliveries',deliveryId:'message-1'});assert.ok(html.includes('task-page delivery-detail'));assert.ok(html.includes('Fixture body'));assert.ok(!html.includes('role="dialog"'));assert.ok(!html.slice(html.indexOf('<main'),html.indexOf('</main>')).includes('Nova viagem'));
html=render({view:'searches',searchId:search.id});
const status=html.match(/<div class="route-live">[\s\S]*?<\/div>/)[0];
assert.ok(status.includes('Última atualização:'));assert.ok(!status.includes('<button'));assert.ok(!status.includes('chevron-right'));assert.ok(!html.includes('Acompanhamento ao vivo'));assert.ok(!html.includes('inline-status'));
// The profile loads on demand (phone fields): the skeleton stays inside <main> first, then the form.
html=render({view:'settings'});assert.ok(html.includes('view-skeleton'));assert.ok(html.includes('class="sidebar"'));await new Promise(resolve=>setImmediate(resolve));
html=render({view:'settings'});const profileForm=html.match(/<form class="profile-form"[\s\S]*?<\/form>/)[0];
assert.equal((profileForm.match(/<form/g)||[]).length,1);assert.ok(profileForm.includes('profile-contacts'));assert.ok(profileForm.includes('profile-preferences'));assert.ok(profileForm.includes('E-mails de alerta'));assert.ok(profileForm.includes('Outros telefones'));assert.ok(profileForm.includes('Horário silencioso'));assert.ok(!profileForm.includes('type="submit"'),'Nothing to save before a change');assert.ok(!profileForm.includes('Sair da conta'));assert.ok(!html.includes('account-preferences card'));
assert.ok(/<a[^>]*href="\/admin\/envios"[^>]*>[\s\S]*?Administração/.test(profileForm),'Administration is a link, so it never submits the profile form');
profileEdit=true;html=render({view:'settings'});profileEdit=false;const editedForm=html.match(/<form class="profile-form"[\s\S]*?<\/form>/)[0];
assert.ok(/<section class="list-section profile-account">[\s\S]*?<button[^>]*type="submit"[^>]*>Salvar<\/button>/.test(editedForm),'The changed block carries its own Salvar');assert.ok(!/profile-contacts">[\s\S]*?type="submit"[\s\S]*?profile-preferences/.test(editedForm),'Unchanged blocks show no Salvar');assert.ok(/<button[^>]*type="submit"[^>]*form="profile-form"/.test(html),'The phone save bar submits the same form');
role='user';html=render({view:'admin',section:'users'});assert.ok(html.includes('exclusiva de administradores'));assert.ok(!html.includes('Cadastro de usuários'));
console.log('Complete pages: four mobile destinations, page-based wizard/editor/alerts, read-only messages, stable chart and admin visibility passed.');

// A trip keeps its identity, header and section position on every tab.
const tripPages=[{view:'searches',searchId:search.id},{view:'history',searchId:search.id},{view:'searches',searchId:search.id,panel:'alerts'}].map(render);
for(const page of tripPages){
 assert.equal((page.match(/class="card route-card"/g)||[]).length,1);
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
assert.ok(html.includes('WhatsApp para: +1 202-555-0123<'),'Formatted, and the same number is not repeated');
delete user.phone_display;user.additional_phones=[];data.whatsapp_available=false;
console.log('Alert settings: formatted WhatsApp access phone passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});

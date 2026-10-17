// Server-render administrative screens with fixtures; no browser or network access.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fromFrontend=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json'));
const React=fromFrontend('react'),{renderToStaticMarkup}=fromFrontend('react-dom/server'),ts=fromFrontend('typescript');
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
let tab='deliveries',subchannel='email',fixture={items:[],total:0,page_size:15,totals:{}};
const output={};let stateCalls=0,stateOverrides={},retentionDays=90;const mockReact={...React,useState:initial=>{const n=stateCalls++;return [n===0?tab:n===1?subchannel:n in stateOverrides?stateOverrides[n]:initial,()=>{}];}};
// Shared helpers the panel imports (format, tables, navigation) load from source with the same fixtures.
const modules=new Map();
function load(name){const file=name.slice(2)+(fs.existsSync(path.join(__dirname,'../frontend/src',name.slice(2)+'.tsx'))?'.tsx':'.ts');if(modules.has(file))return modules.get(file);const out={};modules.set(file,out);vm.runInNewContext(compile(file),{URLSearchParams,Intl,exports:out,require:resolve});return out;}
function resolve(name){return name==='./navigationGuard'?{useUnsavedChanges(){},afterSave:cb=>cb()}:name==='./TaskPage'?{TaskPage:({children,title,description})=>React.createElement('section',{},React.createElement('h2',{},title),React.createElement('p',{},description),children)}:name.endsWith('.css')?{}:name==='react'?mockReact:name==='./i18n'?{getLocale:()=> 'pt-BR',t:(key,args=[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[Number(i)]))}:name==='@tanstack/react-query'?{useQueryClient:()=>({}),useQuery:({queryKey,enabled})=>enabled===false?{}:{data:queryKey[0]==='delivery-retention'?{days:retentionDays,cutoff:Date.now()/1000-retentionDays*86400,total:18,protected:2,last_cleanup:null,batch_size:2000}:fixture}}:name==='./WhatsAppPanel'?{WhatsAppPanel:()=>React.createElement('p',{},'WhatsApp integration fixture')}:name==='./AdminUsers'?{AdminUsers:()=>React.createElement('p',{},'User management fixture')}:name==='./AuditPanel'?{AuditPanel:()=>React.createElement('p',{},'Audit fixture')}:name==='./GoogleMailPanel'?{GoogleMailPanel:()=>React.createElement('p',{},'Existing mail configuration')}:name==='./SmtpSettings'?{SmtpSettings:()=>React.createElement('p',{},'SMTP settings fixture')}:name==='./ui'?{Card:({children,...props})=>React.createElement('section',props,children),Button:({children,variant,size,...props})=>React.createElement('button',props,children),Modal:({open,children})=>open?React.createElement('div',{},children):null,ConfirmDialog:({open,children})=>open?React.createElement('div',{},children):null,Notice:({children})=>React.createElement('p',{},children)}:name.startsWith('./')?load(name):fromFrontend(name);}
vm.runInNewContext(compile('AdminPanel.tsx'),{URLSearchParams,Intl,exports:output,require:resolve});
// The e-mail channel shows the Google account panel (loaded on demand) and the SMTP settings.
let mail={google:{deployment:'local',configured:true,client_id:'',client_secret_set:false,connected:false,email:'',error:null,redirect_uri:'http://127.0.0.1:8765/'},smtp:null,provider:null,testRecipient:'',defaultEmail:''};
function render(){stateCalls=0;return renderToStaticMarkup(React.createElement(output.AdminPanel,{request:()=>{},mail}));}
(async()=>{
let html=render();assert.ok(html.includes('Nenhum envio encontrado'));assert.ok(html.includes('role="tablist"'));assert.ok(html.includes('Nome ou login'));assert.ok(!html.includes('Existing mail configuration'));
fixture={items:[{id:'fixture',created:1,subject:'<script>untrusted subject</script>',status:'sent',channel:'email',kind:'alert',recipients:['fixture@example.org'],account_name:'User fixture',login:'+123'}],total:18,page_size:15,totals:{sent:16,pending:1,failed:1}};
html=render();assert.ok(html.includes('User fixture'));assert.ok(html.includes('fixture@example.org'));assert.ok(html.includes('Aceito pelo provedor'));assert.ok(html.includes('Página 1 de 2'));
assert.ok(html.includes('16 enviados · 1 enviando · 1 com problema'),'The chips\' words, each count with its singular or plural');
fixture={...fixture,totals:{sent:2}};html=render();assert.ok(html.includes('<span>2 enviados</span>'),'Zeros are left out');
assert.ok(!html.includes('delivery-blocks'),'No blocks: no banner');
fixture={...fixture,blocked:[{channel:'email',status:'waiting_service',count:20},{channel:'whatsapp',status:'waiting_contact',count:1}]};html=render();
assert.match(html,/20 bloqueados: e-mail sem serviço\s*—\s*<a href="\/admin\/canais\/email"[^>]*>Configurar<\/a>/,'Count by reason, with the way to the channel');
assert.ok(html.includes('1 bloqueado: sem destinatário')&&html.includes('Ver envios'));
mail={...mail,available:true};html=render();assert.ok(!html.includes('e-mail sem serviço'),'A channel set up since then needs no action');assert.ok(html.includes('1 bloqueado: sem destinatário'));
mail={...mail,available:false};fixture={...fixture,blocked:[],totals:{sent:16,pending:1,failed:1}};
// Above the administration: links on this computer (amber) and the 2FA reminder; nothing when all is well.
assert.ok(!html.includes('admin-notices'),'Nothing to say: no notices');
fixture={...fixture,alert_links_local:true,enabled:false};html=render();
assert.match(html,/<div class="admin-notices"><p class="banner warning" role="status">[\s\S]*?Os links dos alertas apontam para este computador\. Defina RADAR_PUBLIC_URL\./);
assert.ok(html.includes('Sua conta de administrador está sem verificação em duas etapas.')&&html.includes('Ativar no perfil')&&html.includes('Agora não'));
fixture={...fixture,alert_links_local:false,enabled:true};html=render();assert.ok(!html.includes('admin-notices'));
// A message held by quiet hours: Silenciado for the person, "Retida até HH:MM" for the administrator.
const held={...fixture.items[0],id:'held',status:'pending',next_due:Date.now()/1000+3600};
fixture={...fixture,items:[held],alert_links_local:false,enabled:undefined};html=render();
assert.match(html,/status-chip tone-gray[^>]*title="Silenciado · Retida até \d{2}:\d{2}"/);assert.match(html,/<small aria-hidden="true">Retida até \d{2}:\d{2}<\/small>/);
fixture={...fixture,items:[{...held,status:'pending',next_due:1}]};html=render();assert.ok(html.includes('tone-gray')&&html.includes('Enviando')&&!html.includes('Retida'),'Due now: Enviando');
assert.match(html,/Consulta atualizada em \d{2}\/\d{2}(\/\d{2})?,? \d{2}:\d{2}/,'The stable query names its date and time');
// Only the selected tab points at a panel, the one in the page.
assert.deepEqual([...html.matchAll(/aria-controls="([^"]+)"/g)].map(m=>m[1]),['admin-panel-deliveries']);assert.ok(html.includes('id="admin-panel-deliveries"'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'));
// Stacked rows on phones (layout in data-view.css/admin.css): the subject may take two lines, the status keeps a cell of its own and channel and date carry their names.
fixture={items:[{id:'blocked',created:Date.UTC(2026,9,17,11,55)/1000,subject:'Radar de Voos: queda de preço em GRU → LIS',status:'waiting_service',channel:'email',kind:'alert',recipients:['fixture@example.org'],account_name:'User fixture',login:'+123'}],total:1,page_size:15,totals:{waiting_service:1}};
html=render();
assert.ok(html.includes('<span class="cell-title cell-truncate cell-clamp" title="Radar de Voos: queda de preço em GRU → LIS">'),'The subject wraps instead of being cut');
// The stacked rows change the display of the table parts, so the parts carry explicit table roles.
assert.match(html,/<td role="cell" class="cell-channel cell-field"><span class="cell-label">Canal<\/span><span class="channel-name">/);
assert.match(html,/<td role="cell" class="cell-when cell-field"><span class="cell-label">Data e hora<\/span><time [^>]*>[^<]+<\/time><\/td>/);
assert.match(html,/<td role="cell" class="cell-status"><span class="delivery-state"><span class="status-chip tone-red" title="Falha · Bloqueado: canal indisponível"><span aria-hidden="true">Falha<\/span><span class="sr-only">Falha · Bloqueado: canal indisponível<\/span><\/span><small aria-hidden="true">Bloqueado: canal indisponível<\/small><\/span><\/td>/,'The person\'s chip, with the exact state visible under it');
assert.match(html,/<table role="table" class="data-table delivery-table">/);assert.match(html,/<thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader"/);assert.match(html,/<tbody role="rowgroup"><tr role="row" class="is-clickable">/);
tab='channels';render();await new Promise(resolve=>setImmediate(resolve));html=render();assert.ok(html.includes('Existing mail configuration'));assert.ok(!html.includes('User fixture'));
subchannel='whatsapp';html=render();assert.ok(html.includes('WhatsApp integration fixture'));assert.ok(!html.includes('Existing mail configuration'));subchannel='telegram';html=render();assert.ok(html.includes('WhatsApp integration fixture')&&!html.includes('Telegram')&&!html.includes('Em breve'),'No Telegram for now: an old link opens WhatsApp');subchannel='email';
// E-mail channel status from the state: "Ativo" only when a message can be sent (email_available), with the service really in use.
const channelRow=(page,name)=>(page.split('<a ').find(part=>part.includes(`channel-link-name">${name}</span>`))||'').split('</a>')[0];
const pill=part=>(part.match(/<span class="status-pill [^"]+">[^<]*<\/span>/)||[''])[0];
const smtpBlank={enabled:false,host:'',port:587,security:'starttls',username:'',sender:'',recipient:'',password_set:false};
// Nothing configured: the server still names SMTP as the provider, but nothing can be sent.
mail={...mail,smtp:smtpBlank,provider:'smtp',available:false};html=render();
assert.ok(channelRow(html,'E-mail').includes('channel-link-detail">Não configurado</span>'));
assert.equal(pill(channelRow(html,'E-mail')),'<span class="status-pill is-ended">Inativo</span>');
assert.equal(pill(channelRow(html,'E-mail')),pill(channelRow(html,'WhatsApp')),'The same neutral pill as an unconfigured WhatsApp');
assert.ok(html.includes('Nenhum serviço de e-mail ativo.'));assert.ok(!html.includes('Serviço em uso'));
// SMTP enabled, no Google account.
mail={...mail,smtp:{...smtpBlank,enabled:true,host:'smtp.example.org',sender:'radar@example.org',recipient:'admin@example.org'},available:true};html=render();
assert.ok(channelRow(html,'E-mail').includes('channel-link-detail">Servidor SMTP</span>'));
assert.equal(pill(channelRow(html,'E-mail')),'<span class="status-pill is-active">Ativo</span>');assert.ok(html.includes('Serviço em uso: servidor SMTP.'));
// Google account connected.
mail={...mail,google:{...mail.google,connected:true,email:'sender@example.org'},provider:'google',available:true};html=render();
assert.ok(channelRow(html,'E-mail').includes('Conta Google · sender@example.org'));
assert.equal(pill(channelRow(html,'E-mail')),'<span class="status-pill is-active">Ativo</span>');assert.ok(html.includes('Serviço em uso: conta Google.'));
// Authorization lost: the server keeps the account as provider and sends nothing, even with SMTP enabled.
mail={...mail,google:{...mail.google,connected:false},provider:'google',available:false};html=render();
assert.ok(channelRow(html,'E-mail').includes('Conta Google · reconexão necessária'));
assert.equal(pill(channelRow(html,'E-mail')),'<span class="status-pill is-ended">Inativo</span>');
assert.ok(html.includes('A conta Google precisa ser reconectada.'));assert.ok(!html.includes('Serviço em uso'));
// Older servers without the provider field: a connected account is the service, as on the server.
assert.equal(output.emailChannel({google:{...mail.google,connected:true},smtp:null,available:true}).detail,'Conta Google · sender@example.org');
assert.equal(output.emailChannel(undefined).active,false);
console.log('E-mail channel: status and service in use follow email_available, SMTP and the Google account passed.');
tab='retention';html=render();assert.ok(html.includes('após 90 dias'));assert.ok(html.includes('protegidos da limpeza'));assert.ok(html.includes('Consultar prévia'));assert.ok(!html.includes('Excluir 18'));
assert.match(html,/<input type="number"[^>]*max="3650"[^>]*value="90"/,'The saved period fills the field until it is edited');assert.ok(html.includes('Limpeza em lotes de até 2.000 registros.'));
// An emptied field stays empty (Retention's policyDays is the fifth state of the render) instead of snapping back to the saved period.
stateOverrides={4:''};html=render();stateOverrides={};assert.match(html,/<input type="number"[^>]*max="3650"[^>]*value=""/);
retentionDays=1;html=render();retentionDays=90;assert.ok(html.includes('após 1 dia.'),'One day reads in the singular');
tab='users';html=render();assert.ok(html.includes('User management fixture'));assert.ok(!html.includes('Existing mail configuration'));
tab='audit';html=render();assert.ok(html.includes('Audit fixture'));assert.ok(!html.includes('Existing mail configuration'));
console.log('Admin fixtures: isolated tabs, searchable paginated log, escaped content, unavailable channels and safe cleanup preview passed.');
tab='deliveries';fixture={items:[{id:'receipt-fixture',created:1,status:'sent',receipt_status:'read',channel:'whatsapp',kind:'alert',subject:'Receipt fixture',recipients:['+12025550123'],account_name:'Fixture',login:'+12025550123'}],total:1,page_size:15,totals:{sent:1}};
html=render();assert.ok(html.includes('Lido'));assert.ok(html.includes('Lido no WhatsApp'));assert.ok(html.includes('Falha de entrega no WhatsApp'));
})().catch(error=>{console.error(error);process.exitCode=1;});

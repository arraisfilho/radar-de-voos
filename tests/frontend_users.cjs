// Isolated user-management rendering with fixture data; no API or browser.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fromFrontend=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json'));
const React=fromFrontend('react'),{renderToStaticMarkup}=fromFrontend('react-dom/server'),ts=fromFrontend('typescript');
const user={client_number:7,monitoring_counts:{active:2,paused:1,ended:4,total:7},id:'fixture',role:'user',name:'Customer fixture',country:'US',phone:'+12025550123',emails:['customer@example.org'],whatsapp_use_login:false,whatsapp_country:'GB',whatsapp_phone:'+442079460018',telegram_username:'fixture_telegram',additional_phones:[{country:'BR',phone:'+5511987654321'}],language:'en',timezone:'America/New_York',quiet_hours:true,quiet_start:'22:00',quiet_end:'08:00',phone_verified:false};
function shared(file){const out={};const source=fs.readFileSync(path.join(__dirname,'../frontend/src',file+'.tsx'),'utf8');const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;vm.runInNewContext(code,{exports:out,Intl,require:n=>n.endsWith('.css')?{}:n==='./i18n'?{getLocale:()=> 'pt-BR',t:(key,args=[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[i]))}:n==='./ui'?{Button:({children,variant,...props})=>React.createElement('button',props,children)}:fromFrontend(n)});return out;}
let count=0,mode='list';const output={};
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src/AdminUsers.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const helpers=new Map();
function load(name){const file=name.slice(2)+(fs.existsSync(path.join(__dirname,'../frontend/src',name.slice(2)+'.tsx'))?'.tsx':'.ts');if(helpers.has(file))return helpers.get(file);const out={};helpers.set(file,out);vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports:out,Intl,require:resolve});return out;}
vm.runInNewContext(code,{exports:output,URLSearchParams,Intl,structuredClone,require:resolve});
function resolve(name){return name.endsWith('.css')?{}:name==='./TimeZoneField'?shared('TimeZoneField'):name==='./PasswordField'?shared('PasswordField'):name==='./navigationGuard'?{useUnsavedChanges(){},afterSave:cb=>cb()}:name==='./TaskPage'?{TaskPage:({children,title,description})=>React.createElement('section',{},React.createElement('h2',{},title),React.createElement('p',{},description),children)}:name==='react'?{...React,useState:initial=>{const n=count++;const value=mode==='edit'&&n===3?user:(mode==='create'||mode==='edit')&&n===4?{...user,password:''}:mode==='password'&&n===5?user:initial;return [value,()=>{}];}}:name==='@tanstack/react-query'?{useQueryClient:()=>({}),useQuery:()=>({data:{items:[user],total:16,page_size:15}})}:name==='./i18n'?{getLocale:()=> 'pt-BR',t:(key,args=[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[Number(i)]))}:name==='./ui'?{Card:({children,...props})=>React.createElement('section',props,children),Button:({children,variant,...props})=>React.createElement('button',props,children),Modal:({open,children,title})=>open?React.createElement('div',{},React.createElement('h2',{},title),children):null,ContextMenu:({children,summaryLabel})=>React.createElement('div',{'aria-label':summaryLabel},children),Notice:({children})=>React.createElement('p',{},children)}:name==='./AdminMonitorings'?{AdminMonitorings:()=>null}:name==='./PhoneField'?{PhoneField:({label,country,value})=>React.createElement('p',{},`${label}: ${country} ${value}`)}:name==='./EmailFields'?{EmailFields:({values})=>React.createElement('p',{},values.join(','))}:name==='./AdditionalPhones'?{AdditionalPhones:({values})=>React.createElement('p',{},values.map(p=>p.phone).join(','))}:name.startsWith('./')?load(name):fromFrontend(name);}
function render(){count=0;return renderToStaticMarkup(React.createElement(output.AdminUsers,{request:()=>{},userId:'admin'}));}
let html=render();assert.ok(html.includes('Novo usuário'));assert.ok(html.includes('Customer fixture'));assert.ok(html.includes('customer@example.org'));assert.ok(html.includes('Redefinir senha de Customer fixture'));assert.ok(!html.includes('Senha inicial'));
mode='create';html=render();assert.ok(html.includes('Senha inicial'));assert.ok(!html.includes('Conta do Telegram')); assert.ok(html.includes('Usar fuso do dispositivo')); assert.ok(html.includes('Mostrar senha')); assert.ok(html.includes('+5511987654321'));assert.ok(html.includes('Horário silencioso'));assert.ok(html.includes('Salvar cadastro'));assert.ok(html.includes('minLength="10"'));
mode='edit';html=render();assert.ok(html.includes('Editar cadastro'));assert.ok(!html.includes('Senha inicial'));assert.ok(html.includes('Alterar o telefone de acesso encerra as sessões'));
mode='password';html=render();assert.ok(html.includes('Confirmar nova senha'));assert.ok(html.includes('invalidar os links de recuperação'));assert.ok(html.includes('required=""'));
console.log('Manual accounts: list, contacts, additional international phones, preferences and separate confirmed password reset passed.');

mode='edit';html=render();assert.ok(html.includes('Limite de monitoramentos'));assert.ok(html.includes('max="100"'));assert.ok(html.includes('Buscas pausadas também contam'));

mode='list';html=render();assert.ok(html.includes('Cliente #7'));assert.ok(html.includes('Ativos: 2 · Pausados: 1 · Encerrados: 4'));assert.ok(html.includes('Monitoramentos'));assert.ok(html.includes('Ver monitoramentos de Customer fixture'));

// Searching by the phone as the list shows it: spaces, parentheses, dots and hyphens go, as the server compares E.164.
const {userSearchTerm}=output;
assert.equal(userSearchTerm(' +55 (11) 98765-4321 '),'+5511987654321');
assert.equal(userSearchTerm('(11) 98765.4321'),'11987654321');
for(const term of ['Ana Maria','ana.silva@example.org','#7','Ana-Lu'])assert.equal(userSearchTerm(term),term,`${term} is searched as typed`);
// Between 768 and 1279 px the table scrolls sideways in its frame instead of squeezing the user column.
mode='list';html=render();assert.ok(html.includes('class="table-frame user-table-frame"'));
// Stacked on phones, the phone and the role carry their names, and the table parts keep explicit roles.
assert.ok(html.includes('<td role="cell" class="cell-phone cell-field"><span class="cell-label">Telefone</span><span>+12025550123</span></td>'));
assert.ok(/<td role="cell" class="cell-role cell-field"><span class="cell-label">Papel<\/span><span class="status-pill is-ended">Cliente<\/span><\/td>/.test(html));
assert.ok(html.includes('<table role="table" class="data-table user-table">'));
// Short role names on a single line: the role column never breaks the pill inside a word.
user.role='admin';html=render();assert.ok(/<span class="status-pill is-info">Admin<\/span>/.test(html));user.role='user';
let rolePillNowrap=false;fromFrontend('postcss').parse(fs.readFileSync(path.join(__dirname,'../frontend/src/admin.css'),'utf8')).walkRules(rule=>{if(rule.parent.type==='root'&&rule.selectors.includes('.user-table .cell-role .status-pill'))rule.walkDecls('white-space',d=>{if(d.value==='nowrap')rolePillNowrap=true;});});
assert.ok(rolePillNowrap,'The role pill keeps a single line outside any media query');
console.log('User search by displayed phone and the scrolling user table frame passed.');

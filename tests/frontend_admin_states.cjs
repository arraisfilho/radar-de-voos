// Fare source wording, audit details, chosen airports and past dates from fixtures; no browser, account or network.
process.env.TZ='America/Sao_Paulo';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),React=req('react'),ts=req('typescript'),{renderToStaticMarkup}=req('react-dom/server');
const source=path.join(__dirname,'../frontend/src'),modules=new Map();
let state=[],index=0,storage=new Map();
const sessionStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value))};
const mockReact={...React,useEffect:()=>{},useId:()=> 'fixture',useRef:()=>({current:null}),useState:initial=>{const i=index++;if(!(i in state))state[i]=initial;return [state[i],value=>state[i]=value];}};
function load(file){if(modules.has(file))return modules.get(file);const out={};modules.set(file,out);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(source,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,
 {exports:out,Intl,Date,Map,Set,sessionStorage,requestAnimationFrame:cb=>cb(),require:n=>n.endsWith('.css')?{}:n==='react'?mockReact:n==='./i18n'?{getLocale:()=> 'pt-BR',useLanguage:()=> 'pt',t:(key,args=[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[Number(i)]))}:n.startsWith('./')?load(n.slice(2)+(fs.existsSync(path.join(source,n.slice(2)+'.tsx'))?'.tsx':'.ts')):req(n)});
 return out;}

// Fare source: a pause after failures of one route kind never says the source is limiting queries.
const {sourceMessage,queryFailure,sourceKindLabel}=load('LiveStatus.tsx');
const paused=kind=>sourceMessage({status:'paused',kind,consecutive_failures:3,last_success_at:null,last_failure_at:100,retry_at:200},100);
for(const kind of ['timeout','network','server','no_results','unknown',null])assert.ok(!paused(kind).text.includes('limitando'),`${kind} pauses are neutral`);
assert.ok(paused('rate_limited').text.includes('limitando'));assert.ok(paused('blocked').text.includes('bloqueou'));assert.ok(paused('timeout').text.includes('falhas seguidas'));
assert.equal(queryFailure({error_kind:'no_results',error:'A fonte não forneceu um bloco de voos interpretável'}),'Nenhum voo encontrado para essas datas nesta consulta');
assert.equal(sourceKindLabel('no_results'),'Nenhum voo encontrado para essas datas nesta consulta');
console.log('Fare source: neutral pause after route failures and friendly no-results wording passed.');

// Audit: every new event has a name; details show field names and counts, never values.
const {auditLabels,auditDetails}=load('AuditPanel.tsx');
const labels=auditLabels();
for(const event of ['admin_smtp_saved','admin_smtp_removed','admin_whatsapp_saved','admin_whatsapp_removed','admin_whatsapp_receipts_saved','admin_google_client_saved','admin_google_client_removed','admin_google_connected','admin_google_disconnected','admin_retention_changed','admin_logs_cleaned'])assert.ok(labels[event]&&labels[event]!==event,`${event} has a label`);
const text=rows=>rows.map(([label,value])=>label+': '+value).join(' | ');
assert.equal(text(auditDetails('admin_smtp_saved',{changed:['host','password'],enabled:true})),'Ativação: Habilitado | Campos alterados: Servidor SMTP, Senha');
assert.equal(text(auditDetails('admin_retention_changed',{after:30,before:90,scope:'access'})),'Registros: Auditoria de acessos | Antes: 90 dias | Depois: 30 dias');
assert.ok(text(auditDetails('admin_logs_cleaned',{before:1792216162,has_more:false,removed:120,scope:'deliveries'})).includes('Registros removidos: 120'));
assert.ok(text(auditDetails('admin_whatsapp_removed',{cancelled:2,existed:true,provider:'openwa',receipts_removed:true})).includes('Mensagens pendentes canceladas: 2'));
assert.equal(auditDetails('login_failed',null).length,0);
console.log('Audit: labels for the new events and readable details without values passed.');

// Airports picked in the assistant name the trip summary even when the state does not list them.
const {rememberAirports,placeLabel}=load('airports.ts');
assert.equal(placeLabel(['SSA'],[]),'');
rememberAirports([{code:'SSA',city:'Salvador',name:'Deputado Luís Eduardo Magalhães International Airport',label:'Dep. Luís Eduardo Magalhães',country:'BR',timezone:'America/Bahia'}]);
assert.equal(placeLabel(['SSA'],[]),'Salvador · Dep. Luís Eduardo Magalhães');
assert.ok(storage.get('radar-airports').includes('SSA'),'The record follows the draft in this tab');
console.log('Chosen airports: summary label from the picked record passed.');

// Calendar: days before the limit are disabled and a typed past date stays out, with its error in place.
const {DatePicker}=load('DatePicker.tsx');
function find(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props?.children)){const found=find(child,predicate);if(found)return found;}return null;}
let changes=[];
function picker(props){index=0;return DatePicker({id:'date-start',label:'A partir de',onChange:v=>changes.push(v),...props});}
let tree=picker({value:'2030-05-20',min:'2030-05-10'});
const calendar=find(tree,n=>n.props?.captionLayout==='dropdown');
assert.equal(calendar.props.disabled(new Date(2030,4,9,12)),true,'Days before the limit are disabled');
assert.equal(calendar.props.disabled(new Date(2030,4,10,12)),false,'The limit itself can be chosen');
let validity='';const field=find(tree,n=>n.type==='input'&&n.props.id==='date-start');
field.props.onChange({currentTarget:{value:'01052030',selectionStart:8,setSelectionRange(){},setCustomValidity:v=>validity=v}});
assert.equal(changes.length,0,'A past typed date is not applied');assert.ok(validity);assert.equal(state[4],'Escolha uma data a partir de hoje.');
state=[];tree=picker({value:'2030-05-01',min:'2030-05-10',allowed:'2030-05-01'});
assert.equal(find(tree,n=>n.props?.captionLayout==='dropdown').props.disabled(new Date(2030,4,1,12)),false,'Editing keeps the saved date available');
assert.ok(!renderToStaticMarkup(tree).includes('field-error'),'The kept date shows no error');
state=[];tree=picker({value:'2030-05-01',min:'2030-05-10'});
assert.ok(renderToStaticMarkup(tree).includes('Escolha uma data a partir de hoje.'),'A past draft date shows its error next to the field');
state=[];tree=picker({value:'2030-05-01'});assert.equal(find(tree,n=>n.props?.captionLayout==='dropdown').props.disabled,undefined,'Without a limit every day stays available');
console.log('Calendar: past days disabled, typed past date refused with its error, saved date kept while editing passed.');

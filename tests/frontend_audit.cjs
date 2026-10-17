// Access audit rows from fixtures: the period of aggregated records; no browser, account or network.
process.env.TZ='America/Sao_Paulo';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),React=req('react'),ts=req('typescript'),{renderToStaticMarkup}=req('react-dom/server');
const source=path.join(__dirname,'../frontend/src'),modules=new Map();
let page={items:[],total:0,page_size:25,days:30,max_records:20000};
function load(file){if(modules.has(file))return modules.get(file);const out={};modules.set(file,out);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(source,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,
 {exports:out,Intl,Date,URLSearchParams,require:n=>n.endsWith('.css')?{}:n==='./i18n'?{getLocale:()=> 'pt-BR',t:(key,args=[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[Number(i)]))}:n==='@tanstack/react-query'?{useQuery:()=>({data:page,isFetching:false,isError:false,isPending:false})}:n==='./ui'?{Button:({children,variant,size,...props})=>React.createElement('button',props,children),Modal:({open,children})=>open?React.createElement('div',{},children):null}:n.startsWith('./')?load(n.slice(2)+(fs.existsSync(path.join(source,n.slice(2)+'.tsx'))?'.tsx':'.ts')):req(n)});
 return out;}
const {AuditPanel,auditUntil}=load('AuditPanel.tsx');
// October 2026 in São Paulo (UTC-3, no daylight saving time).
const at=(day,hour,minute,second=0)=>Date.UTC(2026,9,day,hour+3,minute,second)/1000;

// Both ends in the same minute print the same: no "até". Same day: the time alone. Another day: date and time.
assert.equal(auditUntil(at(17,8,22,10),at(17,8,22,50)),'');
assert.equal(auditUntil(at(17,8,22),at(17,9,5)),'até 09:05');
assert.equal(auditUntil(at(17,23,50),at(18,0,10)),'até 18 de out. de 2026, 00:10');
assert.equal(auditUntil(at(17,8,22),null),'');

const base={event:'login_failed',browser:'Chrome',system:'macOS',user_agent:'Fixture agent',actor_name:null,account_name:'Fixture account',login:'+5511987654321',details:null};
page={...page,total:4,items:[
  {...base,id:1,ip:'203.0.113.1',created:at(17,8,22,10),last_seen:at(17,8,22,50),count:3},
  {...base,id:2,ip:'203.0.113.2',created:at(17,8,22),last_seen:at(17,9,5),count:2},
  {...base,id:3,ip:'203.0.113.3',event:'logout',created:at(17,23,50),last_seen:at(18,0,10),count:2},
  {...base,id:4,ip:'2001:db8:85a3::8a2e:370:7334',event:'login_success',created:at(17,8,22),last_seen:null,count:1},
]};
const html=renderToStaticMarkup(React.createElement(AuditPanel,{admin:true,expanded:true}));
const when=ip=>((html.split('<tr').find(row=>row.includes(ip))||'').match(/<td role="cell" class="cell-when">(.*?)<\/td>/)||[])[1]||'';
// Stacked on phones, the account carries its name ("Conta"), as the column header is hidden there.
assert.ok((html.split('<tr').find(row=>row.includes('203.0.113.1'))||'').includes('<td role="cell" class="cell-account"><span class="cell-label">Conta</span>'));
assert.match(when('203.0.113.1'),/^<time [^>]*>17 de out\. de 2026, 08:22<\/time>$/,'Same minute: the start only');
assert.ok(!html.includes('até 08:22'));
assert.match(when('203.0.113.2'),/^<time [^>]*>17 de out\. de 2026, 08:22<\/time><span class="cell-secondary">até 09:05<\/span>$/);
assert.match(when('203.0.113.3'),/^<time [^>]*>17 de out\. de 2026, 23:50<\/time><span class="cell-secondary">até 18 de out\. de 2026, 00:10<\/span>$/);
assert.match(when('2001:db8:85a3::8a2e:370:7334'),/^<time [^>]*>17 de out\. de 2026, 08:22<\/time>$/,'A single occurrence has no period');
assert.ok(html.includes('× 3'),'The count of an aggregated record stays');
console.log('Audit: aggregated period without a repeated minute, time alone within one day, date and time across days passed.');
// The retention note counts days and records in the singular or the plural.
assert.ok(html.includes('Retenção: 30 dias, até 20.000 registros.'));
page={...page,days:1};let note=renderToStaticMarkup(React.createElement(AuditPanel,{admin:true,expanded:true}));assert.ok(note.includes('Retenção: 1 dia, até 20.000 registros.'));
page={...page,noisy_max_records:1,admin_max_records:5000};note=renderToStaticMarkup(React.createElement(AuditPanel,{admin:true,expanded:true}));
assert.ok(note.includes('Retenção de 1 dia, com limites separados: 20.000 registros de conta, 1 tentativa recusada e 5.000 registros de administração.'));
console.log('Audit note: singular and plural counts passed.');

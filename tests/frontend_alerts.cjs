// Alert rows and day groups from synthetic alerts; no browser, account or transport is used.
process.env.TZ='America/Sao_Paulo';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),React=req('react'),ts=req('typescript'),{renderToStaticMarkup}=req('react-dom/server');
const source=path.join(__dirname,'../frontend/src'),modules=new Map();
function load(file){if(modules.has(file))return modules.get(file);const out={};modules.set(file,out);
 const code=ts.transpileModule(fs.readFileSync(path.join(source,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{exports:out,Intl,Date,Map,Set,require:n=>n.endsWith('.css')?{}:n==='./i18n'?{getLocale:()=> 'pt-BR',useLanguage:()=> 'pt',t:(key,args=[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[Number(i)]))}:n.startsWith('./')?load(n.slice(2)+(fs.existsSync(path.join(source,n.slice(2)+'.tsx'))?'.tsx':'.ts')):req(n)});
 return out;}
const {AlertRow,AlertDays}=load('AlertRow.tsx');
const now=new Date(2026,11,11,22,5).getTime()/1000;
const flight={origin:'GRU',destination:'LIS',departure:'2026-12-20T08:05',arrival:'2026-12-20T21:40',airlines:['LATAM'],currency:'BRL',price_cents:110800,search_url:'https://www.google.com/travel/flights?fixture'};
const alert=(id,created,kind,channels)=>({id,created,direction:'outbound',status:'sent',price:110800,previous:130000,version:1,search_id:'trip-1',archived:0,channels,payload:{kind,title:'',flight,previous:130000,saving_cents:19200,saving_percent:15,comparison:'',collected_at:created}});
const row=item=>renderToStaticMarkup(React.createElement(AlertRow,{item,tripName:'Férias',onOpenTrip(){},onManageContacts(){}}));
let html=row(alert('a1',now-60,'target',[{channel:'email',counts:{waiting_contact:1}}]));
assert.ok(html.includes('Meta atingida'));assert.ok(html.includes('Férias · Ida · GRU → LIS'),'Trip and leg');assert.ok(html.includes('LATAM'));assert.ok(/R\$\s1\.108</.test(html),'Price without zero cents');
assert.ok(/href="\/perfil"[^>]*>[\s\S]*?Configurar contato/.test(html),'A channel without recipient leads to the profile');assert.ok(/href="\/viagens\/trip-1"[^>]*>[\s\S]*?Abrir viagem/.test(html));
assert.ok(/Ver no Google Voos<span class="sr-only">: LATAM, saída às 08:05, R\$\s1\.108<\/span>/.test(html),'The fare link names airline, time and price');assert.ok(html.includes('(abre em nova aba)'));assert.ok(html.includes('target="_blank"'));
assert.ok(html.includes('Sem destinatário'),'Channel state in words, not only color');
const reminder=alert('a3',now-60,'target',[{channel:'whatsapp',counts:{sent:1}}]);reminder.payload.reason='reminder';
html=row(reminder);assert.ok(html.includes('Ainda dentro da meta')&&!html.includes('Meta atingida'),'A reminder is told apart from the first goal met');assert.ok(html.includes('tone-green'));
html=row(alert('a2',now-60,'lower_price',[{channel:'email',counts:{sent:1}}]));assert.ok(html.includes('Queda de preço'));assert.ok(!html.includes('Configurar contato'));assert.ok(html.includes('Economia de'));
const change={...alert('c1',now-60,'lower_price'),price:120000,previous:110000,currency:'BRL',flight};
html=renderToStaticMarkup(React.createElement(AlertRow,{item:change,observed:true}));assert.ok(html.includes('Preço subiu'));assert.ok(html.includes('Variação observada · no painel'));assert.ok(!html.includes('Ver no Google Voos'),'Observed changes are not offers');
assert.ok(!html.includes('A opção pode ter mudado'),'Observed changes carry no offer note');
// Sent alerts say the fare may have changed; a goal met without an earlier price says it is within the budget.
const disclaimer='Melhor preço encontrado para suas preferências. A opção pode ter mudado.';
html=row(alert('a3',now-60,'lower_price',[{channel:'email',counts:{sent:1}}]));assert.ok(html.includes(disclaimer));assert.ok(!html.includes('Dentro do orçamento configurado'),'A drop shows its saving instead');
html=row({...alert('a4',now-60,'target',[{channel:'email',counts:{sent:1}}]),previous:null});assert.ok(html.includes(disclaimer));assert.match(html,/<small>Dentro da meta<\/small>/);
// A goal met never reads "Preço subiu": it says how far below the target it is.
const risen={...alert('a5',now-60,'target',[{channel:'email',counts:{sent:1}}]),price:117100,previous:90400};risen.payload={...risen.payload,target_cents:120000};
html=row(risen);assert.ok(!html.includes('Preço subiu'));assert.match(html,/<small>Dentro da meta \(R\$\s1\.200\) · R\$\s29 abaixo da meta<\/small>/);
const days=renderToStaticMarkup(React.createElement(AlertDays,{items:[alert('d1',now-600,'target'),alert('d2',now-3600,'target'),alert('d3',now-86400,'target'),alert('d4',now-5*86400,'target')],now,render:item=>React.createElement('p',{},item.id)}));
const headings=[...days.matchAll(/<h2 class="list-section-title">([^<]+)<\/h2>/g)].map(m=>m[1]);
assert.deepEqual(headings,['Hoje','Ontem','Domingo, 6 de dezembro de 2026'],'Grouped by day, newest first');assert.ok(days.indexOf('d2')<days.indexOf('d3'));
console.log('Alerts: titles, trip and flight, price without zero cents, channel states, contact action, unique fare link and day groups passed.');

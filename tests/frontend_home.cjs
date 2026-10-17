// Render isolated home with fixtures, never opening or inspecting a browser session.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fromFrontend=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json'));
const React=fromFrontend('react'),{renderToStaticMarkup}=fromFrontend('react-dom/server'),ts=fromFrontend('typescript');
const source=path.join(__dirname,'../frontend/src'),modules=new Map();
// Local modules load from source (format, trip summary, navigation...); i18n and ui are fixtures.
function load(file){if(modules.has(file))return modules.get(file);const out={};modules.set(file,out);
 const code=ts.transpileModule(fs.readFileSync(path.join(source,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 vm.runInNewContext(code,{exports:out,Intl,Date,Map,Set,require:name=>name.endsWith('.css')?{}:name==='./i18n'?{getLocale:()=> 'pt-BR',t:(key,args=[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[Number(i)]))}:name==='./ui'?{Card:({children,...props})=>React.createElement('section',props,children),Button:({children,variant,size,...props})=>React.createElement('button',props,children)}:name.startsWith('./')?load(name.slice(2)+(fs.existsSync(path.join(source,name.slice(2)+'.tsx'))?'.tsx':'.ts')):fromFrontend(name)});
 return out;}
const output=load('Home.tsx');
const props={onOpen:()=>{},onNew:()=>{},serverNow:200};
const empty=renderToStaticMarkup(React.createElement(output.Home,{...props,searches:[]}));
assert.ok(empty.includes('Criar meu primeiro monitoramento'));assert.ok(empty.includes('Qual será sua próxima viagem?'));assert.ok(!empty.includes('home-monitor card'));
for(const step of ['Escolha rota e datas','Acompanhe os preços ao vivo','Receba alertas por WhatsApp ou e-mail'])assert.ok(empty.includes(step),`First access explains: ${step}`);
const trip={id:'fixture',active:1,last_finished:123,config:{name:'Minha viagem',origins:['THE'],destinations:['GRU'],adults:1,outbound:{start:'2090-11-05T22:00'},inbound:null,currency:'BRL'},summary:{outbound:{price:123400,collected:123}}};
const oneWay=renderToStaticMarkup(React.createElement(output.Home,{...props,searches:[trip]}));assert.ok(oneWay.includes('Minha viagem'));assert.ok(oneWay.includes('Menor preço agora'),'The latest snapshot, not the historical minimum');assert.ok(oneWay.includes('<dt>Ida</dt>'));assert.ok(!oneWay.includes('<dt>Volta</dt>'));assert.ok(oneWay.includes('1.234'));assert.ok(oneWay.includes('Ver voos'));
assert.ok(oneWay.includes('<article class="home-monitor card card-interactive"'),'Trip cards are articles');assert.ok(/<a class="stretched-link[^"]*" href="\/viagens\/fixture"/.test(oneWay),'One real link opens the trip');assert.ok(!/<button[^>]*>[\s\S]*?<h2/.test(oneWay),'No heading inside a button');assert.ok(!oneWay.includes('role="group"'),'A single state needs no filter');
const roundTrip={...trip,id:'second',active:0,config:{...trip.config,name:'Outra viagem',inbound:{start:'2090-11-09T06:00'}}};
const overview=renderToStaticMarkup(React.createElement(output.Home,{...props,searches:[trip,roundTrip]}));assert.equal((overview.match(/home-monitor card/g)||[]).length,1,'The filter starts on active trips');assert.ok(/aria-pressed="true"[^>]*>Ativas<span class="segment-count">1<\/span>/.test(overview));assert.ok(/aria-pressed="false"[^>]*>Pausadas<span class="segment-count">1<\/span>/.test(overview));
const paused=renderToStaticMarkup(React.createElement(output.Home,{...props,searches:[roundTrip]}));assert.ok(paused.includes('status-pill is-paused'));assert.ok(paused.includes('<dt>Volta</dt>'),'Round trips show the return fare');
console.log('Home fixture rendering: empty onboarding, trip cards, one-way summaries and paused monitoring passed.');
const ended=renderToStaticMarkup(React.createElement(output.Home,{...props,searches:[],archived:[{...trip,id:'old'}]}));assert.ok(ended.includes('href="/viagens/old/historico"'));assert.ok(ended.includes('Ver histórico'));assert.ok(!ended.includes('Criar meu primeiro monitoramento'),'Ended trips are not a first access');
const generated={...roundTrip,config:{...roundTrip.config,name:'EZE ↔ NAT · 11 de dez.',origins:['EZE'],destinations:['NAT'],outbound:{start:'2026-12-11T00:00',end:'2026-12-12T06:00'},inbound:{start:'2026-12-18T00:00',end:'2026-12-18T23:59'}}};
const generatedHtml=renderToStaticMarkup(React.createElement(output.Home,{...props,searches:[generated]}));
assert.equal((generatedHtml.match(/class="route-code">EZE</g)||[]).length,1);assert.ok(!generatedHtml.includes('EZE ↔ NAT · 11 de dez.'),'A generated name is not repeated over the route');assert.ok(!generatedHtml.includes('class="home-route"'));assert.ok(generatedHtml.includes('<strong>Ida</strong>'));assert.ok(generatedHtml.includes('<strong>Volta</strong>'));assert.ok(generatedHtml.includes('18 de dez. de 2026'));assert.ok(/11\s*–\s*12 de dez\. de 2026/.test(generatedHtml));
const named=renderToStaticMarkup(React.createElement(output.Home,{...props,searches:[{...generated,config:{...generated.config,name:'Férias da família'}}]}));assert.ok(named.includes('Férias da família'));assert.equal((named.match(/class="route-code">EZE</g)||[]).length,1);
const located=renderToStaticMarkup(React.createElement(output.Home,{...props,searches:[trip],airports:[{code:'THE',city:'Teresina',name:'Senador Petrônio Portella Airport',country:'BR',timezone:'America/Fortaleza'},{code:'GRU',city:'São Paulo',name:'Guarulhos International Airport',label:'Guarulhos',country:'BR',timezone:'America/Sao_Paulo'}]}));
assert.ok(located.includes('Teresina · Senador Petrônio Portella'),'Without a label the Airport suffix is dropped');assert.ok(located.includes('São Paulo · Guarulhos'),'The backend label names the airport');
const {fareTrend}=output;
assert.equal(fareTrend({price:100000,collected:2}),null,'No reference, no trend');
assert.equal(fareTrend({price:100500,collected:2,ref:{price:100000,collected:1}}).kind,'stable','Moves under 1% read as stable');
assert.equal(fareTrend({price:92000,collected:2,ref:{price:100000,collected:1}}).kind,'down');
assert.equal(fareTrend({price:108000,collected:2,ref:{price:100000,collected:1}}).kind,'up');
const priced={...generated,summary:{outbound:{price:100000,collected:190,ref:{price:108000,collected:190-86400,basis:'day'}},inbound:{price:50000,collected:190}}};
const pricedHtml=renderToStaticMarkup(React.createElement(output.Home,{...props,searches:[priced]}));
assert.ok(pricedHtml.includes('Total estimado ida + volta'),'Round trips show the sum of both legs');assert.ok(pricedHtml.includes('fare-trend is-down'));assert.ok(pricedHtml.includes('em 24 h'));
assert.equal((pricedHtml.match(/fare-trend/g)||[]).length,1,'A leg without reference shows no trend');
console.log('Home fare totals and trends passed.');

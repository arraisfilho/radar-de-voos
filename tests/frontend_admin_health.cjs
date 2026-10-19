// The Saúde tab of the administration rendered from fixtures of /api/admin/health; no browser or network access.
process.env.TZ='America/Sao_Paulo';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fromFrontend=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json'));
const React=fromFrontend('react'),{renderToStaticMarkup}=fromFrontend('react-dom/server'),ts=fromFrontend('typescript'),postcss=fromFrontend('postcss');
const source=path.join(__dirname,'../frontend/src');
const compile=file=>ts.transpileModule(fs.readFileSync(path.join(source,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
let tab='health',metrics=null,failed=false,options=null,requested=[];
const mockReact={...React,useState:(()=>{let n=0;const hook=initial=>{const i=n++;return [i===0?tab:i===1?'whatsapp':initial,()=>{}];};hook.reset=()=>{n=0;};return hook;})()};
const query=({queryKey,enabled})=>{
 if(enabled===false)return {};
 if(queryKey[0]==='admin-health-metrics')return {data:metrics??undefined,isError:failed,error:new Error('Fixture error'),isFetching:false,refetch(){}};
 if(queryKey[0]==='admin-health')return {data:metrics?{source:metrics.source}:undefined};
 if(queryKey[0]==='two-factor')return {data:{enabled:true}};
 return {data:{items:[],total:0,page_size:15,totals:{}}};
};
const modules=new Map();
function load(name){const file=name.slice(2)+(fs.existsSync(path.join(source,name.slice(2)+'.tsx'))?'.tsx':'.ts');if(modules.has(file))return modules.get(file);const out={};modules.set(file,out);vm.runInNewContext(compile(file),{URLSearchParams,Intl,exports:out,require:resolve});return out;}
function resolve(name){
 if(name.endsWith('.css'))return {};
 if(name==='react')return mockReact;
 if(name==='./navigationGuard')return {useUnsavedChanges(){},afterSave:cb=>cb(),confirmNavigation:cb=>cb(),hasUnsavedChanges:()=>false};
 if(name==='./i18n')return {getLocale:()=>'pt-BR',t:(key,args=[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[Number(i)]))};
 if(name==='@tanstack/react-query')return {keepPreviousData:null,useQueryClient:()=>({}),useQuery:o=>{if(o.queryKey[0]==='admin-health-metrics')options=o;return query(o);}};
 const stubs={'./WhatsAppPanel':'WhatsAppPanel','./AdminUsers':'AdminUsers','./AuditPanel':'AuditPanel','./GoogleMailPanel':'GoogleMailPanel','./SmtpSettings':'SmtpSettings','./TaskPage':'TaskPage'};
 if(stubs[name])return {[stubs[name]]:()=>React.createElement('p',{},stubs[name]+' fixture')};
 if(name==='./ui')return {Button:({children,variant,size,...props})=>React.createElement('button',props,children),Notice:({children})=>React.createElement('p',{},children),ConfirmDialog:()=>null,Modal:()=>null};
 return name.startsWith('./')?load(name):fromFrontend(name);
}
const output={};
vm.runInNewContext(compile('AdminPanel.tsx'),{URLSearchParams,Intl,exports:output,require:resolve,fetch:async(url)=>{requested.push(url);return {ok:true,json:async()=>({})};}});
let calls=[];const request=async(...args)=>{calls.push(args);return {};};
// The panel's own handlers, reached through the rendered elements (no DOM): the switch and the Reconhecer buttons.
const handlers={switches:[]};const mockJsx=(type,props)=>{if(props&&props.role==='switch')handlers.switches.push(props.onChange);if(props&&typeof props['aria-label']==='string'&&props['aria-label'].startsWith('Reconhecer: '))handlers[props['aria-label']]=props.onClick;return null;};
const render=()=>{mockReact.useState.reset();return renderToStaticMarkup(React.createElement(output.AdminPanel,{request,userId:'admin',navigate(){}}));};
const now=1792425600+1800;
const bucket=(i,values={})=>({hour_start:1792425600-3600*(23-i),ok:0,empty:0,error:0,blocked:0,p50_ms:null,...values});
const trip={id:'trip-1',title:'Lisboa em maio',route:'GRU → LIS',owner_id:'owner-1'};
const route=(values)=>({route_key:'outbound|GRU|LIS|2090-05-10',direction:'outbound',origin:'GRU',destination:'LIS',date:'2090-05-10',trip,queries:12,p50_ms:4100,p95_ms:9000,failures:0,blocked:0,kind:null,last_failure_at:null,...values});
const full={
 generated_at:now,status:{level:'warning',reasons:['queue_delay','stale_trip']},
 trips:{active:4,paused:1,ended:7,accounts:2},
 queries:{hour:{total:31,ok:25,empty:5,error:1,blocked:0,success_rate:.968,p50_ms:4100,p95_ms:8200},day:{total:813,ok:731,empty:69,error:12,blocked:1,success_rate:.984,p50_ms:3900,p95_ms:9100}},
 series:Array.from({length:24},(_,i)=>bucket(i,i===5?{}:{ok:20+i,empty:3,error:i%4===0?2:0,blocked:i===10?1:0,p50_ms:i===7?null:3000+i*100})),
 cycles:{count:280,avg_s:132},
 freshness:{active:4,fresh:3,stalest:{...trip,age_s:7200,last_at:now-7200}},
 queue:{due:2,max_delay_s:1500},
 source:{status:'ok',kind:null,consecutive_failures:0,last_success_at:now-60,last_failure_at:null,retry_at:null,paused_since:null},
 workers:{collector:{alive:true,age_s:.4,limit_s:120,late:false},email_sender:{alive:true,age_s:400,limit_s:300,late:true},whatsapp_sender:{alive:false,age_s:12,limit_s:300,late:true}},
 slow_routes:[route({}),route({route_key:'inbound|LIS|GRU|2090-05-20',direction:'inbound',origin:'LIS',destination:'GRU',date:'2090-05-20',trip:null,p50_ms:850,p95_ms:1200,queries:1})],
 failing_routes:[route({failures:2,queries:5,kind:'timeout',last_failure_at:now-100})],
 empty_trips:[{...trip,id:'trip-2',title:'Recife',route:'GRU → REC',cycles:3,since:now-86400}],
};
metrics=full;
let html=render();
// The tab and its panel: the selected tab only points at the panel in the page.
// Saúde is the first tab.
assert.match(html,/role="tablist" aria-label="Seções da administração"><button id="admin-tab-health" type="button" role="tab" aria-selected="true" aria-controls="admin-panel-health" tabindex="0">Saúde<\/button><button id="admin-tab-deliveries"/);
assert.deepEqual([...html.matchAll(/aria-controls="([^"]+)"/g)].map(m=>m[1]),['admin-panel-health']);
assert.ok(!/NaN|undefined|\[object/.test(html),'No broken values');
// Refreshed every 30 seconds, only while the tab is open (the query lives in the panel), from the admin endpoint.
assert.equal(options.refetchInterval,30000);assert.equal(options.refetchIntervalInBackground,false);
(async()=>{
await options.queryFn({signal:undefined});assert.deepEqual(requested,['/api/admin/health']);
// Banner: the level in words and each reason with its numbers.
assert.match(html,/<div class="health-banner is-warning">[\s\S]*?<div class="health-banner-text" role="status"><p class="health-banner-title">Atenção<\/p><ul><li>Uma viagem espera na fila de coletas há 25 min\.<\/li><li>“Lisboa em maio” está sem coleta há 2 h\.<\/li><\/ul>/);
assert.match(html,/Atualizado às 13:30 · atualização automática a cada 30 segundos\./);
// Tiles: trips, queries, success rate, p95, fresh trips and queue delay; the tiles behind a reason are marked.
const tile=label=>(html.match(new RegExp(`<div(?: class="[^"]*")?><dt>${label.replace(/[()]/g,'\\$&')}</dt><dd>(.*?)</dd></div>`))||[])[1];
assert.equal(tile('Viagens ativas'),'4<small>em 2 contas · 1 em pausa</small>');
// The 24 h count is the chart's: the same 24 clock-hour buckets.
assert.equal(tile('Consultas em 1 h'),'31<small>813 em 24 h</small>');
assert.equal(tile('Taxa de sucesso'),'96,8%<small>24 h: 98,4%</small>');
assert.equal(tile('Resposta (p95)'),'8,2 s<small>mediana 4,1 s na última hora</small>');
assert.equal(tile('Viagens atualizadas'),'3 de 4<small>nos últimos 10 min · mais antiga há 2 h</small>');
assert.equal(tile('Atraso da fila'),'25 min<small>2 viagens aguardando coleta</small>');
assert.match(html,/<div class="is-warning"><dt>Viagens atualizadas<\/dt>/);assert.match(html,/<div class="is-warning"><dt>Atraso da fila<\/dt>/);assert.match(html,/<div><dt>Taxa de sucesso<\/dt>/);
// Chart: an image with a text summary, stacked bars (one rect per non-empty part) and the median line broken where an hour has none.
const svg=html.match(/<svg class="health-chart-plot"[^>]*>[\s\S]*?<\/svg>/)[0];
const totals=full.series.reduce((s,b)=>({ok:s.ok+b.ok,empty:s.empty+b.empty,error:s.error+b.error,blocked:s.blocked+b.blocked}),{ok:0,empty:0,error:0,blocked:0});
const all=totals.ok+totals.empty+totals.error+totals.blocked,peak=Math.max(...full.series.map(b=>b.ok+b.empty+b.error+b.blocked));
assert.ok(svg.includes('role="img"'));
assert.ok(svg.includes(`aria-label="Consultas por hora nas últimas 24 horas: ${all.toLocaleString('pt-BR')} no total, ${totals.ok} com resultado, ${totals.empty} sem resultado, ${totals.error} com erro e ${totals.blocked} bloqueadas. Pico de ${peak} por hora; mediana de resposta de até 5,3 s."`),svg.slice(0,400));
const parts=full.series.reduce((n,b)=>n+['ok','empty','error','blocked'].filter(k=>b[k]).length,0);
assert.equal((svg.match(/<rect /g)||[]).length,parts);
for(const key of ['ok','empty','error','blocked'])assert.ok(svg.includes(`class="health-bar is-${key}"`));
assert.equal((svg.match(/class="health-latency"/g)||[]).length,3,'Gaps at 05:00 and 07:00 split the line in three');
assert.equal((svg.match(/class="health-latency-halo"/g)||[]).length,3);
assert.match(html,/<li><span class="health-swatch is-ok" aria-hidden="true"><\/span>Com resultado <strong>\d+<\/strong><\/li>/);
assert.ok(html.includes('Mediana de resposta <strong>máx. 5,3 s</strong>'));
assert.match(html,/<div class="health-chart-axis" aria-hidden="true"><span>14:00<\/span><span>02:00<\/span><span>13:00<\/span><\/div>/);
// Source panel (shared with Envios) and services: alive, late or stopped, in words and pills.
assert.ok(html.includes('id="source-card-title">Fonte de tarifas</h2>'));
assert.match(html,/Coletor de tarifas<\/span><span class="health-row-detail">Último sinal há 0 s<\/span><\/span><span class="status-pill is-active">Ativo<\/span>/);
assert.match(html,/Envio de e-mail<\/span><span class="health-row-detail">Último sinal há 7 min<\/span><\/span><span class="status-pill is-warning">Atrasado<\/span>/);
assert.match(html,/Envio de WhatsApp<\/span>[\s\S]*?<span class="status-pill is-danger">Parado<\/span>/);
assert.ok(html.includes('280 ciclos de coleta em 24 h · duração média 2 min'));
// Route lists link to the trip's read-only monitoring page; a deleted trip has no link.
assert.match(html,/<a class="list-row health-row" href="\/admin\/usuarios\/owner-1\/monitoramentos\/trip-1"><span class="health-row-text"><span class="health-row-title">GRU → LIS · 10 de mai\.<\/span><span class="health-row-detail">Lisboa em maio<\/span><\/span><span class="health-row-value">mediana 4,1 s<small>p95 9 s · 12 consultas<\/small><\/span><\/a>/);
assert.match(html,/<div class="list-row health-row"><span class="health-row-text"><span class="health-row-title">LIS → GRU · 20 de mai\. · volta<\/span><span class="health-row-detail">Viagem excluída<\/span><\/span><span class="health-row-value">mediana 850 ms<small>p95 1,2 s · 1 consulta<\/small><\/span><\/div>/);
assert.match(html,/id="health-failing-title">Rotas com falhas<\/h2><div class="list-group"><a [^>]*><span class="health-row-text">[\s\S]*?<span class="health-row-value">2 de 5<small>Tempo esgotado<\/small><\/span><\/a>/);
assert.match(html,/href="\/admin\/usuarios\/owner-1\/monitoramentos\/trip-2"><span class="health-row-text"><span class="health-row-title">Recife<\/span><span class="health-row-detail">GRU → REC<\/span><\/span><span class="health-row-value">3 ciclos sem preço<small>desde [^<]+<\/small>/);
// No incident yet: the empty sentences of both lists, and the notices switch on.
assert.ok(html.includes('<p class="list-group health-list-empty">Nenhum incidente aberto.</p>')&&html.includes('<p class="list-group health-list-empty">Nenhum incidente resolvido ainda.</p>'));
assert.match(html,/<label class="switch-row health-switch"><span><strong>Avisos de saúde<\/strong><small>Os administradores recebem os incidentes no WhatsApp e no e-mail do perfil\.<\/small><\/span><input type="checkbox" role="switch" class="switch" checked=""\/><\/label>/);
// Open incidents with level, time, notices and Reconhecer; the history, compact.
const incident=(values)=>({id:1,code:'source_paused',level:'critical',opened_at:now-1500,updated_at:now,resolved_at:null,acknowledged_at:null,acknowledged_by:null,acknowledged_name:null,last_notified_at:now-1440,notified_count:2,notice:'sent',details:{},...values});
metrics={...full,settings:{notices:true},incidents:[incident({}),incident({id:2,code:'whatsapp_failing',level:'warning',notified_count:0,notice:'not_notified',last_notified_at:null}),
 incident({id:3,code:'queue_delay',level:'warning',notified_count:1,notice:'held',last_notified_at:null,held_until:now+5400}),incident({id:4,code:'stale_trip',level:'warning',acknowledged_at:now-300,acknowledged_by:'admin',acknowledged_name:'Ana'}),
 incident({id:5,code:'email_late',resolved_at:now-7200,opened_at:now-9720,notified_count:3}),incident({id:6,code:'error_rate',level:'warning',resolved_at:now-90000,opened_at:now-90600,notified_count:0,notice:'disabled'})]};
html=render();
const open=html.split('id="health-open-title"')[1].split('</section>')[0],history=html.split('id="health-history-title"')[1].split('</section>')[0];
assert.match(open,/<div class="list-row health-row health-incident"><span class="status-pill is-danger">Crítico<\/span><span class="health-row-text"><span class="health-row-title">Fonte de tarifas pausada<\/span><span class="health-row-detail">Desde [^<]+ · há 25 min<\/span><span class="health-row-detail">2 avisos enviados<\/span><\/span><button [^>]*aria-label="Reconhecer: Fonte de tarifas pausada"[^>]*>Reconhecer<\/button><\/div>/);
assert.ok(open.includes('Falhas no envio de WhatsApp')&&open.includes('Não notificado: nenhum canal disponível'),'The channel that is down never carried it');
assert.ok(open.includes('1 aviso enviado · o próximo sai às 15:00, depois do horário silencioso'));
assert.match(open,/Viagem sem coleta[\s\S]*?<span class="health-row-value">Reconhecido<small>por Ana às 13:25<\/small><\/span>/);
assert.equal((open.match(/>Reconhecer<\/button>/g)||[]).length,3);assert.ok(!open.includes('Envio de e-mail sem sinal'),'Resolved ones are in the history only');
assert.match(history,/<span class="health-row-title">Envio de e-mail sem sinal<\/span><span class="health-row-detail">Resolvido em [^<]+ · durou 42 min<\/span><\/span><span class="health-row-value">Crítico<small>3 avisos<\/small><\/span>/);
assert.ok(history.includes('Falhas nas consultas à fonte')&&history.includes('0 avisos')&&history.includes('durou 10 min'));
// Reconhecer posts to the incident; the switch saves the setting; both refresh the panel.
const jsx=fromFrontend('react/jsx-runtime');const {jsx:realJsx,jsxs:realJsxs}=jsx;
jsx.jsx=(t,p,k)=>{mockJsx(t,p);return realJsx(t,p,k);};jsx.jsxs=(t,p,k)=>{mockJsx(t,p);return realJsxs(t,p,k);};
html=render();jsx.jsx=realJsx;jsx.jsxs=realJsxs;
await handlers['Reconhecer: Fonte de tarifas pausada']();await handlers.switches[0]({target:{checked:false}});await handlers.switches[1]({target:{checked:true}});
assert.equal(JSON.stringify(calls),JSON.stringify([['/admin/health/incidents/1/ack',{},'POST'],['/admin/health/settings',{notices:false},'PUT'],['/admin/health/settings',{digest:true},'PUT']]));
// While saving, the controls stay focusable (aria-busy, never disabled).
assert.ok(!/<input type="checkbox" role="switch"[^>]*disabled/.test(html)&&!/disabled=""[^>]*>Reconhecer/.test(html));
// Off: the switch says the incidents are still recorded.
metrics={...metrics,settings:{notices:false}};html=render();
assert.match(html,/<small>Desligados: os incidentes continuam registrados aqui, sem avisos\.<\/small><\/span><input type="checkbox" role="switch" class="switch"\/>/);
// The new reason codes are worded with their numbers.
metrics={...full,status:{level:'critical',reasons:['whatsapp_late','email_late','whatsapp_failing','email_failing']},workers:{...full.workers,whatsapp_sender:{alive:false,age_s:null,limit_s:300,late:true},email_sender:{alive:true,age_s:400,limit_s:300,late:true}},
 channels:{whatsapp:{available:true,failed_streak:3,last_failure_at:now},email:{available:true,failed_streak:4,last_failure_at:now}}};html=render();
assert.ok(html.includes('<li>O envio de WhatsApp parou.</li><li>O envio de e-mail está sem sinal há 7 min (limite: 5 min).</li><li>As últimas 3 mensagens de WhatsApp falharam.</li><li>Os últimos 4 e-mails falharam.</li>'));
// Rota de controle: last result and time, 24 h mean latency and success rate, and the dots with their text.
const result=(status,at,ms=3000)=>({at,status,kind:status==='error'?'timeout':null,duration_ms:ms});
metrics={...full,canary:{enabled:true,origin:'GRU',destination:'REC',failed_streak:1,next_at:now+1200,
  history:[result('ok',now-5400),result('empty',now-3600),result('blocked',now-1800),result('error',now-600)],last:result('error',now-600),day:{total:46,success_rate:.9565,mean_ms:3900}},
 pace:{per_min:11.8,limit_per_min:12,p50_ms:1500,p95_ms:1900,interval_s:420,target_s:300},settings:{notices:true,digest:false,canary:{enabled:true,origin:'GRU',destination:'REC'}}};
html=render();
const card=html.split('id="canary-title"')[1].split('</section>')[0];
assert.ok(card.includes('GRU → REC · a cada 30 minutos')&&card.includes('<span class="status-pill is-warning">Erro</span>'));
assert.match(card,/<dt>Último resultado<\/dt><dd>Erro<small>[^<]+<\/small><\/dd>/);
assert.ok(card.includes('<dt>Latência média (24 h)</dt><dd>3,9 s</dd>')&&card.includes('<dt>Sucesso (24 h)</dt><dd>95,7%<small>46 consultas</small></dd>'));
assert.match(card,/<div class="canary-dots" role="img" aria-label="Últimos 4 resultados, do mais antigo ao mais recente: com resultado, sem resultado, bloqueio, erro\.">(<span class="canary-dot is-(ok|empty|blocked|error)" title="[^"]+"><\/span>){4}<\/div>/);
assert.ok(card.includes('value="GRU"')&&card.includes('value="REC"')&&card.includes('Salvar rota'));
// Ritmo: measured lines, the bar of queries per minute against the limit, and the plain-language help. No capacity estimate anywhere.
const paceCard=html.split('id="pace-title"')[1].split('</section>')[0];
assert.ok(paceCard.includes('<p class="pace-line"><strong>11,8 / 12</strong> consultas por minuto</p>'));
assert.ok(paceCard.includes('<div class="pace-bar" aria-hidden="true"><span style="width:98%"></span></div>'));
assert.ok(paceCard.includes('<p class="pace-line">Resposta <strong>1,5 s</strong> · p95 1,9 s</p>'));
assert.match(paceCard,/<p class="pace-line is-warning"><svg[^>]*>[\s\S]*?<\/svg>Viagens atualizadas a cada <strong>7 min<\/strong> \(meta: 5 min\)<span class=\"sr-only\"> · acima da meta<\/span><\/p>/,'420 s is above 1.2 × 300: the warning tone');
assert.ok(paceCard.includes('aria-label="Sobre o ritmo"'));
assert.ok(!/[Cc]apacidade/.test(html),'The capacity card and its alert are gone');
// Up to 1.2 × the target (360 s), no warning; without data, dashes and a sentence.
metrics={...metrics,pace:{...metrics.pace,interval_s:360}};html=render();assert.ok(html.includes('<p class="pace-line">Viagens atualizadas a cada <strong>6 min</strong> (meta: 5 min)</p>'));
metrics={...metrics,pace:{per_min:null,limit_per_min:12,p50_ms:null,p95_ms:null,interval_s:null,target_s:300}};html=render();
assert.ok(html.includes('<strong>— / 12</strong> consultas por minuto')&&html.includes('<span style="width:0%"></span>')&&html.includes('Resposta <strong>—</strong> · p95 —'));
assert.ok(html.includes('<p class="pace-line">Intervalo das viagens: ainda sem dois ciclos de uma mesma viagem na última hora.</p>'));
metrics={...metrics,status:{level:'warning',reasons:['source_canary']},canary:{...metrics.canary,failed_streak:3}};html=render();
assert.ok(html.includes('<li>A rota de controle GRU → REC falhou nas últimas 3 consultas.</li></ul>'));
metrics={...metrics,canary:{...metrics.canary,enabled:false}};html=render();assert.ok(html.includes('Desligada: a fonte é medida só pelas viagens.'));
// The summary switch, off by default.
assert.match(html,/<strong>Resumo diário<\/strong><small>Às 08:00 no fuso de cada administrador: [^<]+<\/small><\/span><input type="checkbox" role="switch" class="switch"\/>/);
// Critical: the source paused for long and the collector without a heartbeat, critical reasons first.
metrics={...full,status:{level:'critical',reasons:['source_paused','collector_late','error_rate']},source:{...full.source,status:'paused',kind:'blocked',retry_at:now+300,paused_since:now-1320},
 workers:{...full.workers,collector:{alive:true,age_s:300,limit_s:120,late:true}},queries:{...full.queries,hour:{...full.queries.hour,total:20,error:5,blocked:3}}};
html=render();
assert.match(html,/<div class="health-banner is-critical"><svg[^>]*>[\s\S]*?<\/svg><div class="health-banner-text" role="status"><p class="health-banner-title">Crítico<\/p><ul><li>A fonte de tarifas está pausada há 22 min\.<\/li><li>O coletor de tarifas está sem sinal há 5 min \(limite: 2 min\)\.<\/li><li>40% das consultas da última hora falharam \(8 de 20\)\.<\/li><\/ul>/);
assert.match(html,/<div class="is-warning"><dt>Taxa de sucesso<\/dt>/);
assert.ok(html.includes('status-pill is-danger">Pausada</span>'),'The source panel says paused');
metrics={...metrics,workers:{...metrics.workers,collector:{alive:false,age_s:null,limit_s:120,late:true}}};html=render();
assert.ok(html.includes('<li>O coletor de tarifas parou.</li>'));assert.match(html,/Coletor de tarifas<\/span><span class="health-row-detail">Sem sinal ainda<\/span><\/span><span class="status-pill is-danger">Parado<\/span>/);
// Healthy and idle: no queries, nothing waiting, empty lists with their own sentence.
metrics={...full,status:{level:'ok',reasons:[]},queries:{hour:{total:0,ok:0,empty:0,error:0,blocked:0,success_rate:null,p50_ms:null,p95_ms:null},day:{total:0,ok:0,empty:0,error:0,blocked:0,success_rate:null,p50_ms:null,p95_ms:null}},
 series:Array.from({length:24},(_,i)=>bucket(i)),cycles:{count:1,avg_s:null},freshness:{active:0,fresh:0,stalest:null},queue:{due:0,max_delay_s:null},slow_routes:[],failing_routes:[],empty_trips:[],trips:{active:0,paused:0,ended:0,accounts:0}};
html=render();
assert.match(html,/<div class="health-banner is-ok">[\s\S]*?<div class="health-banner-text" role="status"><p class="health-banner-title">Saudável<\/p><p>Consultas, fila e serviços dentro dos limites\.<\/p>/);
assert.ok(html.includes('Nenhuma consulta à fonte nas últimas 24 horas.')&&!html.includes('<svg class="health-chart-plot"'));
assert.equal(tile('Taxa de sucesso'),'—<small>Sem consultas na última hora</small>');assert.equal(tile('Atraso da fila'),'Sem atraso<small>0 viagens aguardando coleta</small>');
assert.equal(tile('Viagens atualizadas'),'0 de 0<small>nos últimos 10 min</small>');assert.equal(tile('Viagens ativas'),'0<small>em 0 contas · 0 em pausa</small>');
for(const text of ['Nenhuma consulta nas últimas 24 horas.','Nenhuma falha nas últimas 24 horas.','Todas as viagens consultadas têm preço.'])assert.ok(html.includes(`<p class="list-group health-list-empty">${text}</p>`),text);
assert.ok(html.includes('1 ciclo de coleta em 24 h</p>'),'No average without a finished cycle');
assert.ok(!/NaN|undefined/.test(html));
// Loading, then a failure without data: a skeleton, then the load error with a retry.
metrics=null;html=render();assert.ok(!html.includes('health-banner'));assert.ok(html.includes('admin-panel-health'));
failed=true;html=render();assert.match(html,/<h2>Não foi possível carregar<\/h2><p>Fixture error<\/p>/);
// A failed refresh keeps the last data and says from when.
metrics=full;html=render();assert.ok(html.includes('Não foi possível atualizar agora. Os dados mostrados são das 13:30.')&&html.includes('health-banner'));failed=false;
// /admin/saude opens the tab and is where it links to.
const navigation=load('./navigation');
assert.deepEqual({...navigation.parseRoute('/admin/saude')},{view:'admin',section:'health'});
// /admin opens on Saúde.
assert.deepEqual({...navigation.parseRoute('/admin')},{view:'admin',section:'health'});assert.equal(navigation.routePath({view:'admin'}),'/admin/saude');
assert.equal(navigation.routePath({view:'admin',section:'health'}),'/admin/saude');
// Colors: the banner and the bars use the status tokens, the line the chart token.
const sheet=postcss.parse(fs.readFileSync(path.join(source,'admin.css'),'utf8')),rule=selector=>{const found={};sheet.walkRules(r=>{if(r.selectors.includes(selector))r.walkDecls(d=>{found[d.prop]=d.value;});});return found;};
assert.deepEqual(rule('.health-banner.is-critical'),{background:'var(--status-red-bg)',color:'var(--status-red-text)'});
assert.deepEqual(rule('.health-banner.is-warning'),{background:'var(--status-amber-bg)',color:'var(--status-amber-text)'});
for(const [key,tone] of [['ok','green'],['empty','gray'],['error','amber'],['blocked','red']])assert.equal(rule('.health-bar.is-'+key).fill,`var(--status-${tone}-text)`);
assert.equal(rule('.health-latency').stroke,'var(--chart-out)');
assert.match(rule('.health-tiles')['grid-template-columns'],/minmax\(min\(100%, 140px\), 1fr\)/,'Two tiles side by side at 375 px');
console.log('Admin health: first tab and default route, notices and summary switches (aria-busy), control route card and dots, the measured pace (Ritmo), open incidents with Reconhecer and notice counts, history, banner levels and reasons, tiles, accessible 24 h chart, source and services, linked route lists, empty, loading and error states passed.');
})().catch(error=>{console.error(error);process.exit(1);});

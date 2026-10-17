// Exercise the search state transitions without browser automation or tariff queries.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fromFrontend=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),React=fromFrontend('react'),ts=fromFrontend('typescript'),modules=new Map();
let states=[],stateIndex=0,refIndex=0,focus=0,saved=null,config;const refs=[{current:false},{current:{reportValidity:()=>true,querySelector:()=>({focus:()=>focus++,closest:()=>null}),closest:()=>null}},{current:{focus:()=>focus++}}];
const mockReact={...React,useId:()=> 'fixture',useState:initial=>{const i=stateIndex++;if(!(i in states))states[i]=initial;return [states[i],value=>states[i]=typeof value==='function'?value(states[i]):value];},useRef:initial=>{const i=refIndex++;return refs[i]||(refs[i]={current:initial});}};
function load(file){if(modules.has(file))return modules.get(file);const out={};modules.set(file,out);const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;vm.runInNewContext(code,{exports:out,requestAnimationFrame:cb=>cb(),require:name=>name.endsWith('.css')?{}:name==='react'?mockReact:name==='./i18n'?{getLocale:()=> 'pt-BR',t:(key,args=[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(args[Number(i)]))}:name==='./DatePicker'?{DatePicker:()=>null}:name==='./passengers'?load('passengers.ts'):name==='./tripSummary'?load('tripSummary.ts'):name==='./format'?load('format.ts'):name==='./searchJourney'?load('searchJourney.ts'):name==='./currency'?{currencies:['BRL'],currencyLabel:()=> 'BRL'}:['./AirportPicker','./AirlinePicker'].includes(name)?{[name.slice(2)]:()=>null}:name==='./RouteSummary'?{RouteCodes:()=>null,RoutePlaces:()=>null}:name==='./navigation'?{routePath:()=> '/perfil',plainClick:()=>false}:name==='./ui'?{Button:()=>null}:name==='./AlertChannels'?load('AlertChannels.tsx'):name==='./InfoTip'?load('InfoTip.tsx'):fromFrontend(name)});return out;}
const leg={start:'2090-11-05T22:00',end:'2090-11-06T06:00',arrival_before:null,stops:[0,1,2],max_duration:1440,max_layover:null,airlines:[]};
const base={name:'',origins:['THE'],destinations:['GRU'],outbound:leg,inbound:null,adults:1,children:0,infants_in_seat:0,infants_on_lap:0,cabin:'economy',checked_bags:0,currency:'BRL',language:'pt',min_drop_cents:5000,notify_email:false};
const {SearchForm}=load('SearchForm.tsx'),{canPreview}=load('preview.ts');
function reset(value){states=[];config=structuredClone(value);saved=null;focus=0;refs[0].current=false;refs.splice(3);}
function render(overrides={}){stateIndex=0;refIndex=0;return SearchForm({config,setConfig:v=>config=v,airports:[],onSave:v=>saved=v,saving:false,general:true,editing:false,...overrides});}
function submit(){render().props.onSubmit({preventDefault(){}});}
reset({...base,inbound:{...leg,start:'2090-11-01T00:00',end:'2090-11-01T23:59'}});submit();assert.equal(states[0],'inbound');assert.equal(states[1],0);assert.equal(saved,null);assert.ok(config.inbound.start>config.outbound.end);assert.ok(focus>0);submit();assert.equal(states[1],1);assert.equal(states[0],'outbound');submit();assert.equal(states[1],1);assert.equal(states[0],'inbound');assert.equal(saved,null);submit();assert.equal(states[1],2);submit();assert.ok(saved.name.includes('THE ↔ GRU'));assert.ok(saved.name.length<=70);
reset(base);submit();assert.equal(states[1],1);assert.equal(states[0],'outbound');submit();submit();assert.ok(saved.name.includes('THE → GRU'));
// An untouched return that starts inside the outbound window moves after it (H-12).
reset({...base,outbound:{...leg,end:'2090-11-11T06:00'},inbound:{...leg,start:'2090-11-08T00:00',end:'2090-11-08T23:59'}});submit();assert.equal(states[0],'inbound');assert.ok(config.inbound.start.slice(0,10)>'2090-11-11','The return starts after the last outbound day');
reset({...base,name:'Family holiday'});states=['outbound',2,''];submit();assert.equal(saved.name,'Family holiday');
reset({...base,inbound:{...leg},adults:1,infants_on_lap:2});submit();assert.equal(states[1],0);assert.ok(states[2].includes('bebê'));assert.equal(saved,null);
reset({...base,destinations:[]});submit();assert.equal(states[1],0);assert.ok(states[2].includes('destino'));
for(const key of ['children','infants_in_seat','infants_on_lap'])assert.equal(canPreview(base,{...base,[key]:1}),false,`${key} must require a fresh query`);
assert.equal(canPreview(base,{...base,name:'Another name'}),true);
const {partyLabel}=load('passengers.ts');assert.equal(partyLabel({...base,adults:2,children:1}),'3 passageiros');assert.equal(partyLabel(base),'1 adulto');
console.log('Search journey: outbound to return, stale defaults, one-way, generated/custom names, passenger validation and preview isolation passed.');

reset({...base,name:"Saved trip",notify_email:true});render({alertsOnly:true,general:false,emailRecipients:["fixture@example.org"]}).props.onSubmit({preventDefault(){}});assert.equal(saved.notify_email,true);assert.equal(saved.name,"Saved trip");assert.equal(states[1],0);

function find(node,predicate){if(!node||typeof node!=="object")return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props?.children)){const found=find(child,predicate);if(found)return found;}return null;}
function departure(overrides){return find(render(overrides),n=>n.type?.name==='DepartureWindow');}
reset({...base,inbound:{...leg,start:'2090-11-01T00:00',end:'2090-11-01T23:59'}});
const completed={...config.outbound,end:'2090-11-06T07:15'};
assert.equal(typeof departure().props.onComplete,'function');
departure().props.onComplete(completed);
assert.equal(states[0],'inbound');assert.equal(states[1],0);assert.equal(config.outbound.end,completed.end);assert.ok(config.inbound.start>completed.end);assert.equal(saved,null);
states[0]='outbound';assert.equal(departure().props.onComplete,undefined,'Returning to edit outbound must not force another switch');
reset(base);assert.equal(departure().props.onComplete,undefined,'One-way must not switch');
reset({...base,inbound:{...leg},destinations:[]});departure().props.onComplete(leg);assert.equal(states[0],'outbound');assert.ok(states[2].includes('destino'));
reset({...base,inbound:{...leg}});states=['outbound',0,''];assert.equal(departure({editing:true}).props.onComplete,undefined,'Existing searches stay on the selected leg');
// Each direction keeps its own preferences and must be visited before completion.
reset({...base,outbound:{...leg,max_duration:480},inbound:{...leg,max_duration:960}});states=['outbound',1,''];
let range=find(render(),n=>n.type?.name==='NumberRange'&&n.props.label==='Duração máxima da viagem');range.props.onChange(360);submit();assert.equal(states[0],'inbound');assert.equal(states[1],1);
range=find(render(),n=>n.type?.name==='NumberRange'&&n.props.label==='Duração máxima da viagem');assert.equal(range.props.value,960);range.props.onChange(600);submit();assert.equal(states[1],2);submit();assert.equal(saved.outbound.max_duration,360);assert.equal(saved.inbound.max_duration,600);
reset({...base,outbound:{...leg,max_duration:null}});states=['outbound',1,''];
const toggle=find(render(),n=>String(n.props?.className).includes('duration-toggle'));find(toggle,n=>n.type==='input').props.onChange({target:{checked:true}});assert.equal(config.outbound.max_duration,2880);find(find(render(),n=>String(n.props?.className).includes('duration-toggle')),n=>n.type==='input').props.onChange({target:{checked:false}});assert.equal(config.outbound.max_duration,null);
// Exercise actual date/time and Radix handlers, including changes committed before rerender.
reset({...base,inbound:{...leg}});const Departure=departure().type;
function windowFixture(){states=[];stateIndex=0;refIndex=0;refs.length=0;const updates=[],completed=[];const tree=Departure({leg:{...leg},onChange:v=>updates.push(v),onComplete:v=>completed.push(v)});return {tree,updates,completed};}
let fixture=windowFixture();let endTime=find(fixture.tree,n=>n.type==='input'&&n.props.type==='time'&&n.props['aria-label']==='Horário limite de saída');
endTime.props.onBlur();assert.equal(fixture.completed.length,0,'Untouched defaults must not advance');
endTime.props.onChange({target:{value:'07:30'}});assert.equal(fixture.completed.length,0,'Typing must not advance');endTime.props.onBlur();assert.equal(fixture.completed[0].end,'2090-11-06T07:30');
fixture=windowFixture();const slider=find(fixture.tree,n=>n.props?.onValueCommit);slider.props.onValueChange([60,1560]);assert.equal(fixture.completed.length,0);slider.props.onValueCommit([60,1560]);assert.equal(fixture.completed.length,1);assert.equal(fixture.completed[0].start,'2090-11-05T01:00');assert.equal(fixture.completed[0].end,'2090-11-06T02:00');
fixture=windowFixture();endTime=find(fixture.tree,n=>n.type==='input'&&n.props.type==='time'&&n.props['aria-label']==='Horário limite de saída');endTime.props.onChange({target:{value:'07:00'}});let prevented=false;endTime.props.onKeyDown({key:'Enter',preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(fixture.completed.length,1);
console.log('Automatic return: completion, latest range, untouched defaults, no advance during typing, one-way/edit guards and deliberate revisits passed.');
// Page-based wizard keeps each direction's inputs while browser history owns the stage.
reset({...base,inbound:{...leg,start:'2090-11-09T00:00',end:'2090-11-09T23:59'}});
refs[1]={current:{reportValidity:()=>true,querySelector:()=>({focus:()=>{},closest:()=>null}),scrollIntoView:()=>{}}};refs[2]={current:{focus:()=>{}}};
let stage={step:0,direction:'outbound'};
function page(){return render({journey:{...stage,onChange:(step,direction)=>stage={step,direction}}});}
page().props.onSubmit({preventDefault(){}});assert.deepEqual(stage,{step:0,direction:'inbound'});
page().props.onSubmit({preventDefault(){}});assert.deepEqual(stage,{step:1,direction:'outbound'});
page().props.onSubmit({preventDefault(){}});assert.deepEqual(stage,{step:1,direction:'inbound'});
const copy=find(page(),n=>n.props?.className==='copy-preferences');assert.ok(copy);copy.props.onClick();assert.equal(config.inbound.start,'2090-11-09T00:00');assert.deepEqual(Array.from(config.inbound.stops),Array.from(config.outbound.stops));
page().props.onSubmit({preventDefault(){}});assert.equal(stage.step,2);
stage={step:0,direction:'outbound'};assert.ok(find(page(),n=>n.type?.name==='DepartureWindow'));assert.equal(config.inbound.start,'2090-11-09T00:00');
console.log('Page wizard: controlled stages, return preferences and copying preferences without copying dates passed.');

// Channel validation prevents a search from claiming email notifications without a recipient.
reset({...base,name:'Missing recipient',notify_email:true});
render({alertsOnly:true,general:false}).props.onSubmit({preventDefault(){}});
assert.equal(saved,null);assert.ok(states[2].includes('destinatário'));
reset({...base,name:'Unavailable service',notify_email:true});
render({alertsOnly:true,general:false,emailRecipients:['fixture@example.org'],emailAvailable:false}).props.onSubmit({preventDefault(){}});
assert.equal(saved,null);assert.ok(states[2].includes('canal disponível'));
// Revisiting a completed stage must not force another tour of both legs.
reset({...base,inbound:{...leg,start:'2090-11-09T00:00',end:'2090-11-09T23:59'}});
let revisited={step:0,direction:'outbound'};
render({journey:{...revisited,maxStep:2,onChange:(step,direction)=>revisited={step,direction}}}).props.onSubmit({preventDefault(){}});
assert.equal(revisited.step,1);
console.log('Missing recipients, unavailable channels and completed-stage revisits passed.');

// Trip filters: an error in a folded section (the collapsed filters card, "Horários e conexões") opens it before the field takes the focus.
reset({...base,outbound:{...leg,stops:[]}});
const filtersCard={open:false,parentElement:null},moreOptions={open:false,parentElement:{closest:selector=>selector==='details'?filtersCard:null}};
const stopsControl={focus:()=>focus++,closest:selector=>selector==='details'?moreOptions:null};
refs[1]={current:{reportValidity:()=>true,querySelector:()=>stopsControl,closest:()=>null}};
render({general:false}).props.onSubmit({preventDefault(){}});
assert.equal(saved,null);assert.ok(moreOptions.open&&filtersCard.open,'Every folded section around the field opens');assert.ok(focus>0,'The field takes the focus');
console.log('Folded filter errors: the enclosing disclosures open before the focus moves passed.');

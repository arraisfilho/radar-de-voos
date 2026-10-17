// Isolated component and calendar-date checks; no browser or network required.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json'));
const React=req('react'),ts=req('typescript'),{renderToStaticMarkup}=req('react-dom/server');
let locale='pt-BR',state=[],index=0,changes=[];
const mockReact={...React,useEffect:()=>{},useId:()=> 'manual-date',useRef:()=>({current:null}),useState:initial=>{const i=index++;if(!(i in state))state[i]=initial;return [state[i],v=>state[i]=v];}};
const cache={};
function load(name){if(cache[name])return cache[name];const exports={};cache[name]=exports;vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src',name),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports,requestAnimationFrame:cb=>cb(),require:n=>n.endsWith('.css')?{}:n==='react'?mockReact:n==='./calendarDate'?load('calendarDate.ts'):n==='./i18n'?{getLocale:()=>locale,t:k=>k}:req(n)});return exports;}
const {calendarDate,calendarValue,typedDate,displayDate}=load('calendarDate.ts');
for(const tz of ['UTC','America/Sao_Paulo','America/Los_Angeles','Pacific/Kiritimati']){process.env.TZ=tz;for(const day of ['2026-12-21','2028-02-29','2027-01-01'])assert.equal(calendarValue(calendarDate(day)),day,tz);}
assert.equal(calendarDate('2026-02-29'),undefined);assert.equal(calendarDate('2026-13-01'),undefined);assert.equal(typedDate('31/02/2026','pt-BR'),undefined);
for(const [language,text] of [['pt-BR','21/12/2026'],['es-ES','21/12/2026'],['en-US','12/21/2026']]){assert.equal(typedDate(text,language),'2026-12-21');assert.equal(displayDate('2026-12-21',language),text);}
assert.equal(typedDate('1/2/26','pt-BR'),undefined);
const {DatePicker}=load('DatePicker.tsx');
function render(){index=0;return DatePicker({id:'date-start',value:'2026-12-21',label:'A partir de',onChange:v=>changes.push(v)});}
function find(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of React.Children.toArray(node.props?.children)){const value=find(child,predicate);if(value)return value;}return null;}
let tree=render();assert.equal(tree.props.open,false);tree.props.onOpenChange(true);assert.equal(state[1],'21/12/2026');tree=render();
const calendar=find(tree,n=>n.props?.captionLayout==='dropdown');assert.equal(calendar.props.mode,'single');assert.equal(calendar.props.fixedWeeks,true);calendar.props.onSelect(calendarDate('2027-01-03'));assert.equal(changes.at(-1),'2027-01-03');assert.equal(state[0],false);
tree=render();tree.props.onOpenChange(true);tree=render();let input=find(tree,n=>n.type==='input'&&n.props.id==='manual-date');input.props.onChange({currentTarget:{value:'31/02/2026',selectionStart:10,setSelectionRange(){}}});tree=render();input=find(tree,n=>n.type==='input'&&n.props.id==='manual-date');input.props.onKeyDown({key:'Enter',currentTarget:{selectionStart:0,selectionEnd:0,value:''},preventDefault(){}});assert.equal(changes.length,1);assert.equal(state[0],true);assert.ok(state[2]);
input.props.onChange({currentTarget:{value:'05/01/2027',selectionStart:10,setSelectionRange(){}}});tree=render();input=find(tree,n=>n.type==='input'&&n.props.id==='manual-date');input.props.onKeyDown({key:'Enter',currentTarget:{selectionStart:0,selectionEnd:0,value:''},preventDefault(){}});assert.equal(changes.at(-1),'2027-01-05');assert.equal(state[0],false);
locale='en-US';tree=render();tree.props.onOpenChange(true);assert.equal(state[1],'12/21/2026');
const {DayPicker}=req('react-day-picker');const markup=renderToStaticMarkup(React.createElement(DayPicker,{mode:'single',selected:calendarDate('2026-12-21'),defaultMonth:calendarDate('2026-12-21'),fixedWeeks:true,showOutsideDays:true,captionLayout:'dropdown'}));assert.equal((markup.match(/role="gridcell"/g)||[]).length,42);assert.ok(markup.includes('aria-selected="true"'));
console.log('Calendar: local dates in four time zones, leap days, PT/EN/ES manual input, invalid dates, selection, close and fixed six-week layout passed.');

const {maskDateInput}=load('calendarDate.ts');
for(const [raw,expected] of [['2','2'],['21','21/'],['211','21/1'],['2112','21/12/'],['21122026','21/12/2026'],['12/21/2026','12/21/2026']])assert.equal(maskDateInput(raw).text,expected);
assert.equal(maskDateInput('21122026',3).caret,4);
locale='pt-BR';state=[];changes=[];tree=render();let main=find(tree,n=>n.type==='input'&&n.props.id==='date-start');
let validity='';main.props.onChange({currentTarget:{value:'22122026',selectionStart:8,setSelectionRange(){},setCustomValidity:v=>validity=v}});assert.equal(changes.at(-1),'2026-12-22');assert.equal(validity,'');
main.props.onChange({currentTarget:{value:'3112202',selectionStart:7,setSelectionRange(){},setCustomValidity:v=>validity=v}});assert.ok(validity);assert.equal(changes.length,1);
let prevented=false;tree=render();main=find(tree,n=>n.type==='input'&&n.props.id==='date-start');main.props.onKeyDown({key:'Backspace',preventDefault(){prevented=true;},currentTarget:{value:'21/',selectionStart:3,selectionEnd:3,setSelectionRange(){},setCustomValidity(){}}});assert.equal(prevented,true);tree=render();main=find(tree,n=>n.type==='input'&&n.props.id==='date-start');assert.equal(main.props.value,'2');
console.log('Date entry: direct masked input, separators, caret, deletion and invalid/incomplete form blocking passed.');

// Little room above and below the field: the title row and "Digitar data" stay pinned while the month grid scrolls inside.
const postcss=req('postcss'),sheet=postcss.parse(fs.readFileSync(path.join(__dirname,'../frontend/src/date-picker.css'),'utf8'));
const css=selector=>{const found={};sheet.walkRules(r=>{if(r.parent.type!=='atrule'&&r.selectors.includes(selector))r.walkDecls(d=>{found[d.prop]=d.value;});});return found;};
assert.equal(css('.calendar-manual').position,'sticky');assert.equal(css('.calendar-manual').bottom,'0');
assert.equal(css('.calendar-top').position,'sticky');assert.equal(css('.calendar-top').top,'0');
assert.match(css('.calendar-popover').padding,/^0 /,'The vertical padding lives in the pinned blocks');
assert.equal(css('.calendar-popover')['max-height'],'var(--radix-popover-content-available-height)');assert.equal(css('.calendar-popover').overflow,'auto');
// A window too short for the popover opens the calendar as the dialog, which scrolls inside.
const shortWindow={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src/DatePicker.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports:shortWindow,requestAnimationFrame:cb=>cb(),window:{matchMedia:query=>({matches:/max-height: 560px/.test(query),addEventListener(){},removeEventListener(){}})},require:n=>n.endsWith('.css')?{}:n==='react'?mockReact:n==='./calendarDate'?load('calendarDate.ts'):n==='./i18n'?{getLocale:()=>locale,t:k=>k}:req(n)});
index=0;state=[];
assert.equal(shortWindow.DatePicker({id:'date-short',value:'2026-12-21',label:'A partir de',onChange(){}}).type,req('@radix-ui/react-dialog').Root,'Short windows get the dialog');
console.log('Calendar on little room: pinned title and typed date, dialog on short windows passed.');

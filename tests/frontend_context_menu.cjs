// ContextMenu dismissal with a synthetic document, no browser access.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),ts=req('typescript');
class Node {constructor(parent=null){this.parent=parent;}contains(other){for(let n=other;n;n=n.parent)if(n===this)return true;return false;}}
const listeners=new Map(),document={addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:()=>{}};
const panel=new Node(),details=new Node(panel),item=new Node(details),elsewhere=new Node(panel);details.open=true;
const source=fs.readFileSync(path.join(__dirname,'../frontend/src/ui.tsx'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
const out={};
vm.runInNewContext(code,{exports:out,document,Node,require:n=>n==='react'?{useEffect:fn=>fn(),useRef:()=>({current:details})}:n==='react/jsx-runtime'?{jsx:()=>null,jsxs:()=>null,Fragment:'f'}:n==='clsx'?{clsx:()=>''}:{}});
out.ContextMenu({label:'Actions',children:null});
const send=(type,target)=>listeners.get(type)({type,target});
// Safari moves the focus of a tapped item to the panel around the menu: the menu stays open for the click.
send('pointerdown',item);send('focusin',panel);assert.equal(details.open,true,'Focus on an ancestor keeps the menu open');
send('focusin',item);assert.equal(details.open,true);
send('focusin',elsewhere);assert.equal(details.open,false,'Focus outside the menu closes it');
details.open=true;send('pointerdown',elsewhere);assert.equal(details.open,false,'A press outside the menu closes it');
details.open=true;send('pointerdown',panel);assert.equal(details.open,false,'A press on the panel around it closes it');
console.log('frontend context menu ok');

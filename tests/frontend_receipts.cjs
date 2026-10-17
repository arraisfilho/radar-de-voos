// Receipt settings: isolated component fixtures, no network or saved credentials.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),React=req('react'),ts=req('typescript'),{renderToStaticMarkup}=req('react-dom/server');
let fixture={enabled:false,secret_set:false,active:false,identity_matches:false,callback_url:null,callback_path:'/api/webhooks/whatsapp/openwa'},states=[],index=0,calls=[];
const output={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src/WhatsAppReceipts.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports:output,require:n=>n==='react'?{...React,useState:initial=>{let i=index++;return[states[i]??initial,v=>states[i]=v]}}:n==='@tanstack/react-query'?{useQuery:()=>({data:fixture}),useQueryClient:()=>({invalidateQueries:async()=>{}})}:n==='./i18n'?{t:key=>key}:n==='./ui'?{Button:({children,...props})=>React.createElement('button',props,children)}:req(n)});
function render(){index=0;return output.WhatsAppReceipts({request:async(...args)=>{calls.push(args)}})}
function find(node,predicate){if(!React.isValidElement(node))return[];return[predicate(node)?node:null,...React.Children.toArray(node.props.children).flatMap(x=>find(x,predicate))].filter(Boolean)}
(async()=>{
let html=renderToStaticMarkup(render());assert.ok(html.includes('eventos simulados'));assert.ok(html.includes('message.ack e message.failed'));assert.ok(html.includes('type="password"'));assert.ok(!html.includes('https://'));
fixture={...fixture,enabled:true,secret_set:true,active:true,identity_matches:true,callback_url:'https://fixture.example.org/api/webhooks/whatsapp/openwa'};
let tree=render();let secret=find(tree,e=>e.type==='input'&&e.props.type==='password')[0];assert.equal(secret.props.required,false);assert.ok(renderToStaticMarkup(tree).includes(fixture.callback_url));assert.ok(!renderToStaticMarkup(tree).includes('eventos simulados'));
secret.props.onChange({target:{value:'fixture-signing-secret-with-32-characters'}});tree=render();await find(tree,e=>e.type==='form')[0].props.onSubmit({preventDefault(){}});
assert.equal(calls.length,1);assert.equal(calls[0][0],'/admin/whatsapp/receipts');assert.equal(calls[0][2],'PUT');assert.equal(states[1],'');assert.ok(!renderToStaticMarkup(render()).includes('fixture-signing-secret'));
fixture.identity_matches=false;tree=render();assert.equal(find(tree,e=>e.type==='input'&&e.props.type==='password')[0].props.required,true);
console.log('Receipt settings: local/HTTPS callback, secret masking, identity changes, explicit save and secret clearing passed.');
})().catch(e=>{console.error(e);process.exitCode=1});

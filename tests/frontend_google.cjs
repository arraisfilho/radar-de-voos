// Administrator setup interactions without opening a browser or sending email.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),React=req('react'),ts=req('typescript'),{renderToStaticMarkup}=req('react-dom/server');
const states=[];let index=0,guarded=null;const output={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src/GoogleMailPanel.tsx'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports:output,URL,require:n=>n==='react'?{...React,useEffect(){},useRef:()=>({current:null}),useState:initial=>{const i=index++;if(!(i in states))states[i]=typeof initial==='function'?initial():initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value}];}}:n==='./navigationGuard'?{useUnsavedChanges:value=>{guarded=value}}:n==='./i18n'?{t:k=>k}:n==='./ui'?{Button:({children,variant,...props})=>React.createElement('button',props,children),Card:({children,...props})=>React.createElement('section',props,children),ConfirmDialog:({open,children})=>open?React.createElement('div',{role:'dialog'},children):null,Notice:({children})=>React.createElement('p',{},children)}:req(n)});
let requests=[],changed=0;
const status={deployment:'public',configured:false,client_id:'',client_secret_set:false,connected:false,email:'',error:null,redirect_uri:'https://radar.example.com/api/google/callback'};
function render(){index=0;return output.GoogleMailPanel({status,request:async(...args)=>{requests.push(args)},onChanged:async()=>{changed++}})}
function find(node,predicate){if(!React.isValidElement(node))return[];return[predicate(node)?node:null,...React.Children.toArray(node.props.children).flatMap(child=>find(child,predicate))].filter(Boolean)}
(async()=>{
let tree=render();let setup=find(tree,n=>n.type==='details')[0];assert.ok(setup.props.open);assert.equal(guarded,false,'Nothing typed: nothing to protect');
assert.ok(renderToStaticMarkup(tree).includes(status.redirect_uri));
let inputs=find(setup,n=>n.type==='input');assert.ok(inputs[0].props.readOnly);assert.equal(inputs[2].props.type,'password');assert.ok(inputs[2].props.required);
inputs[1].props.onChange({target:{value:'fixture.apps.googleusercontent.com'}});inputs[2].props.onChange({target:{value:'fixture-secret-not-real'}});
tree=render();assert.equal(guarded,true,'A typed OAuth client asks before the channel or tab changes');setup=find(tree,n=>n.type==='details')[0];await find(setup,n=>n.type==='form')[0].props.onSubmit({preventDefault(){}});
assert.equal(requests[0][0],'/google/client');assert.equal(requests[0][2],'PUT');assert.equal(requests[0][1].client_type,'web');assert.equal(requests[0][1].client_secret,'fixture-secret-not-real');assert.equal(changed,1);
tree=render();setup=find(tree,n=>n.type==='details')[0];assert.equal(find(setup,n=>n.type==='input')[2].props.value,'');assert.equal(setup.props.open,false);assert.equal(guarded,false,'Saved: no longer a draft');
status.deployment='local';tree=render();assert.equal(find(tree,n=>n.type==='details').length,0);
console.log('Google Web setup: callback, password secret, PUT configuration, secret clearing and local isolation passed.');
})().catch(error=>{console.error(error);process.exitCode=1});

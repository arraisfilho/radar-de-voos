// Deployment login fixture: public mode hides self-registration without invoking a browser.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),React=req('react'),ts=req('typescript'),{renderToStaticMarkup}=req('react-dom/server');
let index=0,registration=true,session=null;
function load(file){const output={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,{exports:output,URLSearchParams,location:{hash:''},require:n=>n==='react'?{...React,useEffect(){},useState:initial=>{const i=index++;return [file==='Accounts.tsx'&&i===2?session:typeof initial==='function'?initial():initial,()=>{}];}}:n==='@tanstack/react-query'?{useQueryClient:()=>({})}:n==='./i18n'?{useLanguage:()=> 'pt',getLanguage:()=> 'pt',t:k=>k}:n==='./ui'?{Button:({children,variant,size,...props})=>React.createElement('button',props,children),Card:({children,...props})=>React.createElement('section',props,children)}:n.startsWith('./')?new Proxy({}, {get:()=>()=>null}):req(n)});return output;}
// The entry form lives in its own on-demand chunk (SignIn.tsx).
const {SignIn}=load('SignIn.tsx');
function render(){index=0;return renderToStaticMarkup(React.createElement(SignIn,{session:{user:null,token:'fixture',can_bootstrap:false,registration_open:registration},onSignedIn(){},onRecover(){}}));}
let html=render();assert.ok(html.includes('Criar conta'));registration=false;html=render();assert.ok(!html.includes('Criar conta'));assert.ok(html.includes('Solicite seu cadastro ao administrador.'));assert.ok(html.includes('Esqueci minha senha'));
// Until the session is known, the gate shows the check, never the form.
const {AuthGate}=load('Accounts.tsx');index=0;html=renderToStaticMarkup(React.createElement(AuthGate));assert.ok(html.includes('Verificando sessão…'));assert.ok(!html.includes('<form'));
console.log('Public login: self-registration hidden; recovery and login preserved.');

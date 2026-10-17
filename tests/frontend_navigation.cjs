// Browser-history behavior with a synthetic window, no browser or network access.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),ts=req('typescript');
const listeners=new Map(),entries=[{url:'/viagens',state:null}];let cursor=0,dirty=false,pending=null,rendered,scroll=0;
class Event {constructor(type){this.type=type;}}
const window={location:{pathname:'/viagens',search:''},scrollY:0,scrollTo:(x,y)=>scroll=y,
 addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
 removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn),dispatchEvent:event=>{for(const fn of listeners.get(event.type)||[])fn(event);}};
// navigation.ts listens on document for the key or pointer press that cancels a pending heading focus.
const documentListeners=new Map();let heading=null;
const document={body:{},activeElement:null,querySelector:()=>heading,addEventListener:(type,fn)=>{if(!documentListeners.has(type))documentListeners.set(type,new Set());documentListeners.get(type).add(fn);},removeEventListener:(type,fn)=>documentListeners.get(type)?.delete(fn)};
function location(url){const parsed=new URL(url,'https://fixture.example');window.location.pathname=parsed.pathname;window.location.search=parsed.search;}
window.history={get state(){return entries[cursor].state;},replaceState(state,unused,url){entries[cursor]={url:url||entries[cursor].url,state};location(entries[cursor].url);},pushState(state,unused,url){entries.splice(cursor+1);entries.push({state,url});cursor++;location(url);},go(delta){const target=cursor+delta;if(target<0||target>=entries.length)return;cursor=target;location(entries[cursor].url);window.dispatchEvent(new Event('popstate'));}};
function load(name,mocks={},context={}){const out={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src',name),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:out,URLSearchParams,window,Event,document,requestAnimationFrame:cb=>cb(),...context,require:n=>mocks[n]||req(n)});return out;}
const nav=load('navigation.ts',{'react':{useRef:initial=>({current:initial}),useState:initial=>[rendered=initial(),next=>rendered=next],useEffect:effect=>effect()},'./navigationGuard':{hasUnsavedChanges:()=>dirty,confirmNavigation:proceed=>{if(dirty)pending=proceed;else proceed();}}});
const {parseRoute,routePath}=nav;
for(const route of [{view:'home'},{view:'history'},{view:'settings'},{view:'alerts'},{view:'searches',searchId:'uuid-10'},{view:'history',searchId:'uuid-10'},{view:'home',editor:'new',step:1,leg:'inbound'},{view:'searches',searchId:'uuid-10',editor:'edit',step:2,leg:'outbound'},{view:'admin',section:'channels',channel:'whatsapp'},{view:'admin',section:'deliveries',deliveryId:'delivery-1'},{view:'admin',section:'users',userId:'customer-2',userAction:'monitorings',monitorId:'uuid-11'},{view:'admin',section:'users',userId:'customer-2',userAction:'edit'},{view:'admin',section:'users',userAction:'new'}]){
 const url=new URL(routePath(route),'https://fixture.example'),parsed=parseRoute(url.pathname,url.search);
 for(const [key,value] of Object.entries(route))assert.equal(parsed[key],value,routePath(route)+' '+key);
}
for(const path of ['/viagens/x/invalid','/admin/anything','/admin/canais/unsupported','/%E0%A4%A'])assert.equal(parseRoute(path).view,'notfound');
assert.equal(parseRoute('/viagens/nova','?etapa=99').step,2);assert.equal(parseRoute('/viagens/nova','?etapa=bad').step,0);assert.equal(parseRoute('/viagens/nova','?etapa=1.5').step,1);
const api=nav.useNavigation();window.scrollY=380;
api.navigate({view:'home',editor:'new'});assert.equal(window.location.pathname,'/viagens/nova');
api.navigate(current=>({...current,leg:'inbound'}));assert.equal(window.location.search,'?trecho=volta');
api.navigate(current=>({...current,step:1,leg:'outbound'}));assert.equal(window.location.search,'?etapa=1');
window.history.go(-1);assert.equal(rendered.leg,'inbound');assert.equal(rendered.step,0);
window.history.go(-1);assert.equal(rendered.leg,'outbound');
window.history.go(-1);assert.equal(rendered.view,'home');assert.equal(scroll,380,'Back restores the previous list scroll');
window.history.go(1);assert.equal(rendered.editor,'new');
dirty=true;api.navigate({view:'settings'});assert.ok(pending);assert.equal(window.location.pathname,'/viagens/nova');pending();assert.equal(rendered.view,'settings');
// Cancelled Back restores the current entry; approved Back lands on the requested entry.
pending=null;window.history.go(-1);assert.equal(window.location.pathname,'/perfil');assert.ok(pending);pending();assert.equal(window.location.pathname,'/viagens/nova');assert.equal(rendered.editor,'new');
const {priceAxis,visiblePricePoints}=load('priceChart.ts');
for(const prices of [[],[0],[110800,110800,110800],[110801,110802],[100,1000000]]){
 const axis=priceAxis(prices);assert.ok(axis.high>axis.low);assert.ok(axis.ticks.length<=7);assert.equal(new Set(axis.ticks.map(v=>Math.round(v/100))).size,axis.ticks.length);for(const value of prices)assert.ok(value>=axis.low&&value<=axis.high);
}
const flat=Array.from({length:20},(_,i)=>({id:i,price:110800}));assert.deepEqual(Array.from(visiblePricePoints(flat),p=>p.id),[0,19]);
const changes=[{price:100},{price:100},{price:90},{price:90},{price:110}];assert.equal(visiblePricePoints(changes).length,5);
console.log('Navigation: deep links, form stages, Back/Forward, scroll restoration, unsaved-form guards and distinct price axes passed.');
// Engines without URLSearchParams.size (Safari < 17, Chrome < 113, Firefox < 112) still put the stage in the URL and advance.
class LegacySearchParams extends URLSearchParams {}
Object.defineProperty(LegacySearchParams.prototype,'size',{value:undefined});
assert.equal(new LegacySearchParams('etapa=1').size,undefined,'The fixture has no URLSearchParams.size');
let clock=1000;class FixedDate extends Date {static now(){return clock;}}
const legacy=load('navigation.ts',{'react':{useRef:initial=>({current:initial}),useState:initial=>[rendered=initial(),next=>rendered=next],useEffect:effect=>effect()},'./navigationGuard':{hasUnsavedChanges:()=>false,confirmNavigation:proceed=>proceed()}},{URLSearchParams:LegacySearchParams,Date:FixedDate});
assert.equal(legacy.routePath({view:'home',editor:'new',step:1,leg:'inbound'}),'/viagens/nova?etapa=1&trecho=volta');
assert.equal(legacy.routePath({view:'searches',searchId:'uuid-10',editor:'edit',step:2}),'/viagens/uuid-10/editar?etapa=2');
const old=legacy.useNavigation();dirty=false;
old.navigate({view:'home',editor:'new',step:1,leg:'inbound'});assert.equal(window.location.pathname+window.location.search,'/viagens/nova?etapa=1&trecho=volta');assert.equal(rendered.step,1);
old.navigate(current=>({...current,step:2,leg:'outbound'}));assert.equal(window.location.search,'?etapa=2','The assistant advances without URLSearchParams.size');assert.equal(rendered.step,2);
// The page heading takes the focus after a navigation only from the page or the link that navigated, and only until the next key or pointer press or a short delay.
let focused=0;const main={},link={closest:()=>null},otherButton={closest:()=>null},menu={contains:node=>node===menuTrigger},menuTrigger={},menuItem={closest:selector=>selector==='.context-menu'?menu:null};
const present=()=>({focus:()=>focused++,closest:()=>main});
heading=present();document.activeElement=link;old.navigate({view:'alerts'});assert.equal(focused,1,'The link that navigated hands the focus to the heading');
heading=null;document.activeElement=link;old.navigate({view:'history'});heading=present();for(const fn of documentListeners.get('keydown')||[])fn({type:'keydown'});legacy.focusPageHeading();assert.equal(focused,1,'A key press after the navigation cancels the pending focus');
heading=null;document.activeElement=link;old.navigate({view:'settings'});heading=present();for(const fn of documentListeners.get('pointerdown')||[])fn({type:'pointerdown'});legacy.focusPageHeading();assert.equal(focused,1,'A pointer press after the navigation cancels the pending focus');
heading=null;document.activeElement=link;old.navigate({view:'alerts'});heading=present();document.activeElement=otherButton;legacy.focusPageHeading();assert.equal(focused,1,'A refresh never takes the focus from another control');
heading=null;document.activeElement=link;old.navigate({view:'history'});heading=present();clock+=5000;document.activeElement=link;legacy.focusPageHeading();assert.equal(focused,1,'The pending focus expires');
heading=null;document.activeElement=menuItem;old.navigate({view:'settings'});heading=present();document.activeElement=menuTrigger;legacy.focusPageHeading();assert.equal(focused,2,'A menu item that navigated returns the focus to its trigger, which still yields to the heading');
heading=null;document.activeElement=document.body;old.navigate({view:'alerts'});heading=present();legacy.focusPageHeading();assert.equal(focused,3,'Focus on the page body moves to the heading');
console.log('Navigation without URLSearchParams.size and heading focus limited to the page or the navigating link, cancelled by input or time, passed.');

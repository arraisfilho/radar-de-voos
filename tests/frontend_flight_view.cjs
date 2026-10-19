// Sorting and filtering of the flight list on screen only, from fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json'))('typescript');
const out={},store=new Map();
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src/flightView.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports:out,JSON,localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}});
const f=(id,price,duration,departure,arrival,stops,airlines)=>({id,price_cents:price,duration_minutes:duration,departure,arrival,stops,airlines});
const flights=[f('a',97900,1300,'2026-12-01T02:35','2026-12-02T00:15',2,['Gol']),f('b',98400,665,'2026-11-30T01:20','2026-11-30T12:25',1,['Gol']),
  f('c',123800,450,'2026-11-30T03:30','2026-11-30T11:00',1,['LATAM']),f('d',123800,440,'2026-11-30T18:00','2026-12-01T01:20',1,['LATAM']),
  f('e',379100,845,'2026-12-02T03:30','2026-12-02T17:35',2,['LATAM','Aerolineas Argentinas']),f('f',150000,120,'2026-12-02T09:00','2026-12-02T11:00',0,['Azul'])];
const ids=view=>[...out.applyView(flights,{...out.DEFAULT_VIEW,...view})].map(x=>x.id).join('');
assert.equal(ids({}),'abcdfe','Lowest price first, as before');
assert.equal(ids({sort:'duration'}),'fdcbea','Shortest duration');
assert.equal(ids({sort:'departure'}),'bcdaef');assert.equal(ids({sort:'departure-late'}),'feadcb');
assert.equal(ids({stops:'direct'}),'f');assert.equal(ids({stops:'one'}),'bcdf','Up to one stop');
assert.equal(ids({periods:['evening']}),'d');assert.equal(ids({periods:['dawn']}),'abce','Before 6 h is dawn');
assert.equal(ids({airlines:['Aerolineas Argentinas']}),'e','A shared flight counts for each airline');
assert.equal([...out.airlinesOf(flights)].join(','),'LATAM,Gol,Aerolineas Argentinas,Azul','Most frequent airline first');
assert.equal(flights.map(x=>x.id).join(''),'abcdef','The collected list is not reordered in place');
assert.equal(out.isFiltered(out.DEFAULT_VIEW),false);assert.equal(out.isFiltered({...out.DEFAULT_VIEW,periods:['morning']}),true);
out.saveView('trip','outbound',{...out.DEFAULT_VIEW,sort:'duration',stops:'one'});
assert.equal(out.loadView('trip','outbound').sort,'duration');assert.equal(out.loadView('trip','inbound').sort,'price','Each leg keeps its own view');
store.set('radar-view:trip:inbound','{"sort":"bogus","stops":9,"periods":["x","noon","morning"]}');
const cleaned=out.loadView('trip','inbound');assert.equal(cleaned.sort,'price');assert.equal(cleaned.stops,'any');assert.deepEqual([...cleaned.periods],['morning'],'Unknown saved values fall back');
out.saveView('trip','outbound',out.DEFAULT_VIEW);assert.equal(store.has('radar-view:trip:outbound'),false,'The default view is not stored');
console.log('Flight list view: sort by price, duration and times, stops/period/airline filters, per-leg storage passed.');

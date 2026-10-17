// Shared formatter for dates, times, money and durations in PT/EN/ES; fixed time zone, no browser or network required.
process.env.TZ='America/Sao_Paulo';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),ts=req('typescript');
let locale='pt-BR';
// Real Intl constructors behind a counter, to check that formatters are cached per locale and options.
const built={},countedIntl=Object.create(Intl);
for(const name of ['DateTimeFormat','NumberFormat','RelativeTimeFormat','ListFormat']){built[name]=0;countedIntl[name]=function(...args){built[name]++;return new Intl[name](...args);};}
const out={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src/format.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports:out,Intl:countedIntl,Date,Map,require:n=>n==='./i18n'?{getLocale:()=>locale}:req(n)});
const {toDate,formatDate,formatDateRange,formatTime,formatDateTime,formatRelative,formatMoney,formatDuration}=out;
const norm=s=>s.replace(/[   ]/g,' '),locales=['pt-BR','en-US','es-ES'];
const day='2026-12-11',at='2026-12-11T22:05:30',now='2026-12-11T22:05',epoch=1797037500; // epoch: 2026-12-11 22:05 in São Paulo

// toDate: local noon for a date, local wall clock for a date-time, epoch in seconds, invalid input.
const noon=toDate(day);
assert.deepEqual([noon.getFullYear(),noon.getMonth(),noon.getDate(),noon.getHours(),noon.getMinutes()],[2026,11,11,12,0]);
assert.equal(toDate(now).getTime(),new Date(2026,11,11,22,5).getTime());assert.equal(toDate(at).getTime(),new Date(2026,11,11,22,5,30).getTime());
assert.equal(toDate(epoch).getTime(),epoch*1000);assert.equal(toDate(epoch).getTime(),toDate(now).getTime());
const instance=new Date(2026,11,11);assert.equal(toDate(instance),instance);assert.equal(toDate('2028-02-29').getDate(),29);
for(const bad of ['','2026-12-1','11/12/2026','2026-02-29','2026-13-01','2026-12-32','2026-12-11T24:00','2026-12-11T22:60','2026-12-11 22:05','2026-12-11T22:05Z',NaN,Infinity,new Date(NaN)])assert.ok(Number.isNaN(toDate(bad).getTime()),String(bad));
for(const bad of ['2026-02-30','soon',NaN,new Date(NaN)]){for(const format of [formatDate,formatTime,formatDateTime,formatRelative])assert.equal(format(bad),'—');assert.equal(formatDateRange(bad,day),'—');assert.equal(formatDateRange(day,bad),'—');}
assert.equal(formatRelative(day,'soon'),'—');

// formatDate: four styles per language, from any DateValue.
const dates={'pt-BR':['11/12',/^11 de dez\.?$/,/^11 de dez\.? de 2026$/,/^sexta-feira, 11 de dezembro de 2026$/],'en-US':['12/11',/^Dec 11$/,/^Dec 11, 2026$/,/^Friday, December 11, 2026$/],'es-ES':['11/12',/^11 dic\.?$/,/^11 dic\.? 2026$/,/^viernes, 11 de diciembre de 2026$/]};
for(const [language,[numeric,short,medium,long]] of Object.entries(dates)){locale=language;
 assert.equal(formatDate(day,'numeric'),numeric);assert.match(norm(formatDate(day,'short')),short);assert.match(norm(formatDate(day,'medium')),medium);assert.match(norm(formatDate(day,'long')),long);
 assert.equal(formatDate(day),formatDate(day,'medium'));assert.equal(formatDate(epoch,'numeric'),numeric);assert.equal(formatDate(toDate(at),'numeric'),numeric);
}

// formatDateRange: one calendar day, missing end, same month, reversed range and a numeric range across years.
locale='pt-BR';
assert.equal(formatDateRange('2026-12-11T08:00',at),formatDate(day));assert.equal(formatDateRange(day,null,'short'),formatDate(day,'short'));
assert.equal(formatDateRange(day,undefined,'numeric'),'11/12');assert.equal(formatDateRange(day),formatDate(day));
const ranges={'pt-BR':[/^11 ?– ?15 de dez\.? de 2026$/,/^11\/12 ?– ?15\/12$/,/^30\/12\/26 ?– ?02\/01\/27$/],'en-US':[/^Dec 11 ?– ?15, 2026$/,/^12\/11 ?– ?12\/15$/,/^12\/30\/26 ?– ?0?1\/0?2\/27$/],'es-ES':[/^11 ?– ?15 dic\.? 2026$/,/^11\/12 ?– ?15\/12$/,/^30\/12\/26 ?– ?0?2\/0?1\/27$/]};
for(const [language,[medium,numeric,crossing]] of Object.entries(ranges)){locale=language;
 assert.match(norm(formatDateRange(day,'2026-12-15')),medium);assert.match(norm(formatDateRange(day,'2026-12-15','numeric')),numeric);assert.match(norm(formatDateRange('2026-12-30','2027-01-02','numeric')),crossing);
 assert.equal(formatDateRange('2026-12-30','2027-01-02','numeric'),new Intl.DateTimeFormat(language,{day:'2-digit',month:'2-digit',year:'2-digit'}).formatRange(new Date(2026,11,30,12),new Date(2027,0,2,12)));
 assert.equal(formatDateRange('2026-12-15',day),formatDateRange(day,'2026-12-15'));
}

// formatTime and formatDateTime: no seconds; two-digit hours on 24-hour clocks.
const times={'pt-BR':['22:05','09:05',/^11 de dez\.? de 2026,? 22:05$/,/^11\/12,? 22:05$/],'en-US':['10:05 PM','9:05 AM',/^Dec 11, 2026,? (at )?10:05 PM$/,/^12\/11,? 10:05 PM$/],'es-ES':['22:05','09:05',/^11 dic\.? 2026,? 22:05$/,/^11\/12,? 22:05$/]};
for(const [language,[evening,morning,medium,numeric]] of Object.entries(times)){locale=language;
 assert.equal(norm(formatTime(at)),evening);assert.equal(norm(formatTime('2026-12-11T09:05')),morning);assert.equal(formatTime(epoch),formatTime(now));
 assert.match(norm(formatDateTime(at)),medium);assert.equal(formatDateTime(at),formatDateTime(at,'medium'));assert.match(norm(formatDateTime(at,'numeric')),numeric);
}

// formatDateTimeCompact: lists show the year only outside the current one (relative to `now`).
const {formatDateTimeCompact}=out;
for(const [language,thisYear,otherYear] of [['pt-BR',/^11\/12,? 22:05$/,/^11\/12\/25,? 22:05$/],['en-US',/^12\/11,? 10:05 PM$/,/^12\/11\/25,? 10:05 PM$/],['es-ES',/^11\/12,? 22:05$/,/^11\/12\/25,? 22:05$/]]){locale=language;
 assert.match(norm(formatDateTimeCompact(at,'2026-03-01')),thisYear,`${language}: this year without the year`);
 assert.match(norm(formatDateTimeCompact('2025-12-11T22:05','2026-03-01')),otherYear,`${language}: a past year is written`);
 assert.ok(norm(formatDateTimeCompact('2027-01-02T08:00','2026-03-01')).includes('27'),`${language}: next year is written too`);
 assert.equal(formatDateTimeCompact(epoch,'2026-03-01'),formatDateTimeCompact(now,'2026-03-01'));
}
locale='pt-BR';assert.equal(formatDateTimeCompact('soon'),'—');

// formatRelative: now, minutes, hours, calendar days in the past and the future, then the date.
const relative=(language,value,unit,style='short')=>new Intl.RelativeTimeFormat(language,{numeric:'auto',style}).format(value,unit);
for(const language of locales){locale=language;
 assert.equal(formatRelative('2026-12-11T22:04:20',now),relative(language,0,'second'));assert.equal(formatRelative('2026-12-11T22:05:40',now),relative(language,0,'second'));
 assert.equal(formatRelative('2026-12-11T22:00',now),relative(language,-5,'minute'));assert.equal(formatRelative('2026-12-11T22:10',now),relative(language,5,'minute'));
 assert.equal(formatRelative('2026-12-11T19:05',now),relative(language,-3,'hour'));assert.equal(formatRelative('2026-12-12T01:05',now),relative(language,3,'hour'));
 assert.equal(formatRelative('2026-12-10T23:00',now),relative(language,-1,'day'));assert.equal(formatRelative('2026-12-12T21:00',now),relative(language,1,'day'));assert.equal(formatRelative('2026-12-08T09:00',now),relative(language,-3,'day'));
 assert.equal(formatRelative('2026-12-04T22:05',now),formatDate('2026-12-04','medium'));assert.equal(formatRelative('2026-12-25T10:00',now),formatDate('2026-12-25','medium'));
 assert.equal(formatRelative('2026-12-11T22:00',now,'long'),relative(language,-5,'minute','long'));assert.equal(formatRelative(epoch-300,epoch),formatRelative('2026-12-11T22:00',now));
}
locale='pt-BR';
assert.equal(formatRelative('2026-12-11T22:04:20',now),'agora');assert.match(norm(formatRelative('2026-12-11T22:00',now)),/^há 5 min\.?$/);assert.match(norm(formatRelative('2026-12-11T22:10',now)),/^em 5 min\.?$/);
assert.equal(formatRelative('2026-12-10T23:00',now),'ontem');assert.equal(formatRelative('2026-12-10T08:00','2026-12-11T07:00'),'ontem');assert.equal(formatRelative('2026-12-12T21:00',now),'amanhã');
assert.match(norm(formatRelative('2026-12-10T23:00','2026-12-11T08:00')),/^há 9 h\.?$/);assert.equal(formatRelative(new Date()),'agora');
locale='en-US';assert.equal(formatRelative('2026-12-10T23:00',now),'yesterday');assert.equal(formatRelative(new Date()),'now');

// formatMoney: cents, whole amounts without decimals, Intl spacing kept, output follows the current locale.
const money=(language,amount,currency,whole)=>new Intl.NumberFormat(language,{style:'currency',currency,...(whole?{minimumFractionDigits:0,maximumFractionDigits:0}:{})}).format(amount);
locale='pt-BR';
for(const missing of [null,undefined,NaN,Infinity])assert.equal(formatMoney(missing),'—');
assert.equal(norm(formatMoney(110800)),'R$ 1.108');assert.equal(norm(formatMoney(110850)),'R$ 1.108,50');assert.equal(norm(formatMoney(110805)),'R$ 1.108,05');
assert.equal(formatMoney(110850),money('pt-BR',1108.5,'BRL'));assert.equal(formatMoney(110800),money('pt-BR',1108,'BRL',true));
assert.equal(norm(formatMoney(0)),'R$ 0');assert.equal(formatMoney(-0),formatMoney(0));assert.equal(formatMoney(-110850),money('pt-BR',-1108.5,'BRL'));
assert.equal(formatMoney(110850,'USD'),money('pt-BR',1108.5,'USD'));assert.equal(formatMoney(110800,'USD'),money('pt-BR',1108,'USD',true));assert.equal(formatMoney(100,'not a currency'),'—');
const brazilian=formatMoney(110850);
locale='en-US';assert.equal(formatMoney(110850),money('en-US',1108.5,'BRL'));assert.notEqual(formatMoney(110850),brazilian);assert.equal(formatMoney(110800,'USD'),'$1,108');assert.equal(formatMoney(110850,'USD'),'$1,108.50');
locale='es-ES';assert.equal(formatMoney(110850,'EUR'),money('es-ES',1108.5,'EUR'));assert.equal(formatMoney(110800,'EUR'),money('es-ES',1108,'EUR',true));
locale='pt-BR';assert.equal(formatMoney(110850),brazilian);

// formatDuration: Intl units joined by Intl.ListFormat.
assert.equal(norm(formatDuration(45)),'45 min');assert.equal(norm(formatDuration(60)),'1 h');assert.equal(norm(formatDuration(150)),'2 h 30 min');assert.equal(norm(formatDuration(0)),'0 min');assert.equal(formatDuration(-0),formatDuration(0));
for(const bad of [-5,-0.5,NaN,Infinity])assert.equal(formatDuration(bad),'—');
for(const language of locales){locale=language;
 const unit=(amount,name)=>new Intl.NumberFormat(language,{style:'unit',unit:name,unitDisplay:'short'}).format(amount);
 assert.equal(formatDuration(150),new Intl.ListFormat(language,{type:'unit',style:'narrow'}).format([unit(2,'hour'),unit(30,'minute')]));assert.equal(formatDuration(45),unit(45,'minute'));assert.equal(formatDuration(120),unit(2,'hour'));
}

// Cache: one formatter per locale and options, reused across calls and locale switches.
locale='pt-BR';const numbers=built.NumberFormat;
formatMoney(123456,'CHF');assert.equal(built.NumberFormat,numbers+1);for(let i=0;i<5;i++)formatMoney(123456,'CHF');assert.equal(built.NumberFormat,numbers+1);
locale='en-US';formatMoney(123456,'CHF');assert.equal(built.NumberFormat,numbers+2);locale='pt-BR';formatMoney(123456,'CHF');assert.equal(built.NumberFormat,numbers+2);
const total=()=>Object.values(built).reduce((a,b)=>a+b),pass=()=>{for(const language of locales){locale=language;formatDate(day,'long');formatDateRange(day,'2026-12-15','short');formatTime(at);formatDateTime(at,'numeric');formatRelative('2026-12-11T22:00',now,'narrow');formatMoney(110850,'JPY');formatDuration(150);}};
pass();const warm=total();pass();pass();assert.equal(total(),warm);
console.log('Format: PT/EN/ES dates in four styles, ranges, times, date-times, relative times, money in cents, durations, invalid inputs and the per-locale formatter cache passed.');

// Additions for the user pages: departure windows, day headings, day keys and plain numbers.
const {formatDateTimeRange,formatDay,dayKey,formatNumber}=out;
locale='pt-BR';
assert.match(norm(formatDateTimeRange('2026-12-12T08:00','2026-12-14T23:59')),/^12 de dez\.?,? 08:00 ?– ?14 de dez\.?,? 23:59$/);
assert.match(norm(formatDateTimeRange('2026-12-12T08:00','2026-12-12T23:59')),/^12 de dez\.?,? 08:00 ?– ?23:59$/,'One day shows the date once');
assert.equal(formatDateTimeRange('2026-12-14T23:59','2026-12-12T08:00'),formatDateTimeRange('2026-12-12T08:00','2026-12-14T23:59'));assert.equal(formatDateTimeRange('soon',day),'—');
locale='en-US';assert.match(norm(formatDateTimeRange('2026-12-12T08:00','2026-12-14T23:59')),/^Dec 12,? 8:00 AM ?– ?Dec 14,? 11:59 PM$/);
for(const [language,today,yesterday] of [['pt-BR','Hoje','Ontem'],['en-US','Today','Yesterday'],['es-ES','Hoy','Ayer']]){locale=language;
 assert.equal(formatDay('2026-12-11T08:00',now),today);assert.equal(formatDay('2026-12-10T23:59',now),yesterday);
 const long=formatDate('2026-12-06','long');assert.equal(formatDay('2026-12-06T10:00',now),long.charAt(0).toLocaleUpperCase(language)+long.slice(1));
}
locale='pt-BR';assert.equal(formatDay('2026-12-06T10:00',now),'Domingo, 6 de dezembro de 2026');assert.equal(formatDay('soon',now),'—');
assert.equal(dayKey(epoch),'2026-12-11');assert.equal(dayKey('2026-12-11T23:59'),'2026-12-11');assert.equal(dayKey('soon'),'');
assert.equal(formatNumber(0.11345,2),'0,11');assert.equal(formatNumber(1234),'1.234');assert.equal(formatNumber(NaN),'—');locale='en-US';assert.equal(formatNumber(0.11345,2),'0.11');
console.log('Format additions: date-time windows, day headings, local day keys and plain numbers passed.');

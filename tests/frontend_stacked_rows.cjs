// Table rows stacked on phones (<= 767 px), read from the stylesheets: no narrow column, no word or number cut inside; no browser.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const req=require('node:module').createRequire(path.join(__dirname,'../frontend/package.json')),postcss=req('postcss'),ts=req('typescript');
const source=path.join(__dirname,'../frontend/src');
const sheets=Object.fromEntries(['data-view.css','admin.css','audit.css','theme.css','style.css'].map(file=>[file,postcss.parse(fs.readFileSync(path.join(source,file),'utf8'))]));
const PHONE='media (max-width: 767px)';
/** Declarations of a selector at the top level (context null) or inside one at-rule, merged in source order. */
function rule(file,selector,context=null){const found={};sheets[file].walkRules(item=>{const parent=item.parent,inside=parent.type==='atrule'?`${parent.name} ${parent.params}`:null;if(inside===context&&item.selectors.includes(selector))item.walkDecls(d=>{found[d.prop]=d.value;});});return found;}
const tracks=value=>{const out=[];let depth=0,current='';for(const char of value.trim()){if(char==='(')depth++;if(char===')')depth--;if(/\s/.test(char)&&!depth){if(current)out.push(current);current='';}else current+=char;}if(current)out.push(current);return out;};
const areas=value=>[...(value||'').matchAll(/"([^"]*)"/g)].map(match=>match[1].trim().split(/\s+/));

// The four administration lists: only the title shares its line, with the row action; the status and every other field span the whole row.
const shared=rule('data-view.css','.data-table tr',PHONE)['grid-template-columns'];
const lists=[['admin.css','.delivery-table tr','message'],['admin.css','.user-table tr','user'],['admin.css','.admin-monitor-table tr','trip'],['audit.css','.audit-table tr','event'],['audit.css','.audit-table.is-admin tr','event']];
const layout={};
for(const [file,selector,title] of lists){
  const own=rule(file,selector,PHONE),columns=tracks(own['grid-template-columns']||rule(file,'.audit-table tr',PHONE)['grid-template-columns']||shared),rows=areas(own['grid-template-areas']);
  layout[selector]=rows.map(row=>row.join(' '));
  assert.ok(rows.length>1,`${selector}: stacked areas on phones`);
  assert.match(columns[0],/^minmax\(0,\s*1fr\)$/,`${selector}: the first column takes the free width`);
  assert.ok(columns.slice(1).every(track=>track==='auto'),`${selector}: other columns only hold the action`);
  for(const [index,row] of rows.entries()){
    assert.equal(row.length,columns.length,`${selector}: "${row.join(' ')}" matches the ${columns.length} columns, without an empty one taking a gap`);
    if(index===0)assert.ok(row[0]===title&&row.slice(1).every(name=>/^actions?$/.test(name)),`${selector}: the title shares its line only with the action`);
    else assert.ok(row.every(name=>name===row[0]),`${selector}: "${row.join(' ')}" spans the whole row`);
  }
}
for(const area of ['status status','recipient recipient','channel channel','when when'])assert.ok(layout['.delivery-table tr'].includes(area),`Deliveries: ${area} on a line of its own`);
for(const area of ['status status','route route','dates dates'])assert.ok(layout['.admin-monitor-table tr'].includes(area),`Monitorings: ${area} on a line of its own`);
assert.ok(layout['.audit-table.is-admin tr'].includes('origin')&&layout['.audit-table.is-admin tr'].includes('account'),'Audit: account and origin across the row');
assert.ok(!layout['.audit-table tr'].includes('account'),'The personal audit list has no account line');

// Secondary fields: name and value on one line, the value moving below its name when both do not fit.
assert.equal(rule('data-view.css','.cell-label').display,'none','Field names hide on wide screens, where the header names the column');
assert.equal(rule('data-view.css','.data-table .cell-label',PHONE).display,'block');
const field=rule('data-view.css','.data-table .cell-field',PHONE);
assert.equal(field.display,'flex');assert.equal(field['flex-wrap'],'wrap');assert.equal(field['justify-content'],'space-between');
// Nothing breaks inside a word or number: dates stay on one line, longer tokens break only past the full line, titles take two lines.
assert.equal(rule('data-view.css','.data-table time',PHONE)['white-space'],'nowrap');
assert.equal(rule('data-view.css','.data-table td',PHONE)['overflow-wrap'],'break-word');
const clamp=rule('data-view.css','.data-table .cell-clamp',PHONE);
assert.equal(clamp.display,'-webkit-box');assert.equal(clamp['-webkit-line-clamp'],'2');assert.equal(clamp['white-space'],'normal');
// A stricter selector must not reset the stacked cells back to blocks.
for(const selector of ['.data-table td:first-child','.data-table td:last-child'])assert.equal(rule('data-view.css',selector,PHONE).display,undefined,selector);

// Width budget at 320, 375 and 414 px: the viewport minus the page inset and the card padding on phones. Text is estimated
// conservatively at 0.62 em per character (13 px), the channel icon at 15 + 6 px; "name  value" of a delivery must fit one line.
const inset=parseFloat(rule('theme.css',':root',PHONE)['--page-inset']),padding=parseFloat(rule('style.css','.card',PHONE).padding);
assert.equal(inset,16);assert.equal(padding,16);
let locale='pt-BR';const format={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(source,'format.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:format,Intl,Date,require:()=>({getLocale:()=>locale})});
const catalog=JSON.parse(fs.readFileSync(path.join(source,'messages.json'),'utf8'));
const estimate=text=>[...text].length*13*.62;
for(const [language,tag] of [['pt','pt-BR'],['en','en-US'],['es','es-ES']]){
  locale=tag;const label=key=>language==='pt'?key:catalog[key][language];
  // The list writes dates with formatDateTimeCompact: this year's without the year, others with two digits.
  const sample=[new Date(2026,11,28,23,59),new Date(2026,9,17,8,55),new Date(2026,0,1,12,5)];
  const dates=sample.map(date=>format.formatDateTimeCompact(date,date));
  const widest=Math.max(...dates.map(date=>estimate(label('Data e hora'))+12+estimate(date)),estimate(label('Canal'))+12+21+estimate('WhatsApp'));
  for(const viewport of [320,375,414])assert.ok(widest<=viewport-2*inset-2*padding,`${language} at ${viewport} px: ${Math.round(widest)} px of ${viewport-2*inset-2*padding}`);
  // An older record keeps one line from 375 px; at 320 px the value may move under its name (flex-wrap above).
  const older=Math.max(...sample.map(date=>estimate(label('Data e hora'))+12+estimate(format.formatDateTimeCompact(date,new Date(2027,5,1)))));
  for(const viewport of [375,414])assert.ok(older<=viewport-2*inset-2*padding,`${language} at ${viewport} px, another year: ${Math.round(older)} px`);
}
console.log('Stacked rows: title beside the action only, status and fields across the row, dates unbroken and the 320 px budget passed.');
// 768-1279 px: the fixed user-table columns leave the user column at least 200 px, the frame scrolling sideways.
const MEDIUM='media (min-width: 768px) and (max-width: 1279px)';
assert.equal(rule('admin.css','.user-table-frame',MEDIUM)['overflow-x'],'auto');
const fixed=['.user-table .col-phone','.user-table .col-role','.user-table .col-quota','.user-table .col-monitorings','.user-table .col-actions'].reduce((sum,selector)=>sum+parseFloat(rule('admin.css',selector,MEDIUM).width),0);
const userColumn=parseFloat(rule('admin.css','.user-table',MEDIUM)['min-width'])-fixed;
assert.ok(userColumn>=200,`The user column keeps ${userColumn} px`);
console.log('Medium widths: the user column keeps its width and the table scrolls passed.');
assert.equal(rule('audit.css','.audit-toggle','media (pointer: coarse)')['min-height'],'44px','"Detalhes" is a 44 px target on touch screens');

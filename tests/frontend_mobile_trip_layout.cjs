// Phone layout of the trip page: rules that Safari needs and Chrome does not (no browser here).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const css=fs.readFileSync(path.join(__dirname,'../frontend/src/pages.css'),'utf8');
const rule=selector=>{const at=css.indexOf(selector+' {');assert.ok(at>=0,selector);return css.slice(at,css.indexOf('}',at));};
assert.match(rule('.results-head > div'),/flex: 1 1 12rem;/,'The count line keeps a real basis: a zero basis stacks one letter per line in Safari');
const phone=css.slice(css.indexOf('@media (max-width: 479px) {\n  .trip-switcher'));
assert.match(phone,/grid-template-columns: minmax\(0, max-content\) auto minmax\(0, 1fr\);/,'The route codes take their own width on phones');
assert.match(phone,/\.trip-hero-codes > \.route-code \{\n    min-width: min\(3\.4ch, 100%\);/,'A code is never cut below three letters');
assert.match(css,/\.trip-prices > \.metric-total \{\n    display: grid;\n    grid-column: 1 \/ -1;/,'The trip total takes its own line on phones');
console.log('frontend mobile trip layout ok');

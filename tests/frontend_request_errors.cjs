// A failure answered in plain text (proxy or server) must reach the toast as the generic message, not a JSON parse error.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../frontend/src/App.tsx'),'utf8');
const helper=source.slice(source.indexOf('async function request('),source.indexOf('async function perform('));
assert.ok(helper.includes('const result = await response.json().catch(() => ({}));'),'A body that is not JSON falls back to an empty object');
assert.ok(helper.includes('t("Não foi possível concluir a ação")'),'Without a detail the generic message is shown');
console.log('frontend request errors ok');

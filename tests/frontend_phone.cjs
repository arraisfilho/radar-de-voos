const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const ts=require('../frontend/node_modules/typescript');
const phoneLib=require('../frontend/node_modules/libphonenumber-js');
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../frontend/src/phone.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exportsPhone={};
vm.runInNewContext(code,{exports:exportsPhone,require:()=>phoneLib});
const {formatPhone,editPhone,changePhoneCountry,possiblePhone}=exportsPhone;
for(const [country,value,expected] of [['BR','86991234567','(86) 99123-4567'],['US','6502530000','(650) 253-0000'],['GB','07700900123','07700 900123'],['CO','3001234567','300 1234567']]) {
 assert.equal(formatPhone(value,country).display,expected);
}
const pasted=formatPhone('+1 (650) 253-0000','BR');
assert.equal(pasted.country,'US');assert.equal(pasted.value,'6502530000');assert.equal(pasted.display,'(650) 253-0000');
const uk=formatPhone('+44 7700 900123','BR');
assert.equal(uk.country,'GB');assert.equal(uk.value,'07700900123');
assert.equal(formatPhone('+55 86 99123-4567','US').value,'86991234567');
assert.equal(formatPhone('+1 416 555 0123','US').country,'CA');
assert.equal(changePhoneCountry('6502530000','US','BR').value,'6502530000');
const backward=editPhone('(650','US','(650)',4,'deleteContentBackward');
assert.equal(backward.value,'65');
const forward=editPhone('(650)253-0000','US','(650) 253-0000',5,'deleteContentForward');
assert.equal(forward.value,'650530000');
const middle=editPhone('(650) 293-0000','US','(650) 253-0000',8,'insertText');
assert.equal(middle.value,'6502930000');assert.equal(middle.cursor,8);
assert.equal(possiblePhone('65','US'),false);assert.equal(possiblePhone('6502530000','US'),true);
assert.equal(formatPhone('+','BR').value,'+');
console.log('Phone formatting checks passed: BR/US/GB/CO, international paste, shared DDI, country switch, deletion and caret.');

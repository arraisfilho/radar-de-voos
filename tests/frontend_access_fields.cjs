// Exercise country selection and password visibility using synthetic values only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const req = require('node:module').createRequire(path.join(__dirname, '../frontend/package.json'));
const React = req('react'), ts = req('typescript');
let states = [], stateIndex = 0;
const hooks = { ...React, useId: () => 'field-fixture', useLayoutEffect() {}, useRef: () => ({current: null}),
  useState(initial) { const index = stateIndex++; if (!(index in states)) states[index] = initial;
    return [states[index], value => states[index] = typeof value === 'function' ? value(states[index]) : value]; }
};
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const out = {}; modules.set(file, out);
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../frontend/src', file), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}
  }).outputText;
  vm.runInNewContext(code, {exports: out, Intl, require(name) {
    if (name.endsWith('.css')) return {};
    if (name === 'react') return hooks;
    if (name === './i18n') return {getLocale: () => 'pt-BR', t: (key, args = []) => key.replace(/\{(\d+)\}/g, (_, i) => String(args[i]))};
    if (name.startsWith('./')) { const base = path.join(__dirname, '../frontend/src', name); return load(name.slice(2) + (fs.existsSync(base + '.tsx') ? '.tsx' : '.ts')); }
    return req(name);
  }});
  return out;
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) { const found = find(child, predicate); if (found) return found; }
  return null;
}
const {phoneCountries, filterPhoneCountries} = load('phoneCountries.ts');
const countries = phoneCountries('pt-BR');
assert.ok(countries.length > 200, 'The full country list remains available to scroll');
assert.equal(filterPhoneCountries(countries, '+55')[0].code, 'BR');
assert.equal(filterPhoneCountries(countries, '0055')[0].code, 'BR');
assert.equal(filterPhoneCountries(countries, '55').length, 1);
assert.equal(filterPhoneCountries(countries, 'portugal')[0].code, 'PT');
assert.ok(filterPhoneCountries(countries, 'sao tome').some(c => c.code === 'ST'), 'Search ignores accents');
assert.ok(filterPhoneCountries(countries, '+1').some(c => c.code === 'US'));
assert.ok(filterPhoneCountries(countries, '+1').some(c => c.code === 'CA'), 'Shared calling codes do not silently pick one country');
assert.equal(filterPhoneCountries(countries, 'br')[0].code, 'BR');
assert.equal(filterPhoneCountries(countries, 'no-such-country').length, 0);
assert.equal(phoneCountries('en-US').find(c => c.code === 'BR').name, 'Brazil');

const {PhoneCountryPicker} = load('PhoneCountryPicker.tsx');
let chosen = null;
function picker() { stateIndex = 0; return PhoneCountryPicker({country: 'BR', label: 'Fixture phone', disabled: false, onChange: code => chosen = code}); }
states = []; picker().props.onOpenChange(true);
let search = find(picker(), n => n.type === 'input');
search.props.onChange({target: {value: '+1'}});
let prevented = false;
find(picker(), n => n.type === 'input').props.onKeyDown({key: 'ArrowDown', preventDefault() { prevented = true; }});
find(picker(), n => n.type === 'input').props.onKeyDown({key: 'Enter', preventDefault() {}});
assert.ok(prevented); assert.equal(chosen, filterPhoneCountries(countries, '+1')[1].code); assert.equal(states[0], false);
picker().props.onOpenChange(true);
find(picker(), n => n.type === 'input').props.onChange({target: {value: 'no-such-country'}});
assert.ok(find(picker(), n => n.props?.role === 'status').props.children.includes('Nenhum país'));

const {PhoneField} = load('PhoneField.tsx');
states = []; stateIndex = 0;
const phone = PhoneField({label: 'Fixture phone', country: 'BR', value: '+55 11 91234-5678', onChange() {}});
const number = find(phone, n => n.type === 'input' && n.props.type === 'tel');
assert.equal(number.props.value, '(11) 91234-5678');
assert.ok(!find(phone, n => n.props?.className === 'phone-prefix'), 'The number field does not repeat the calling code');

const {PasswordField} = load('PasswordField.tsx');
states = [];
function password() { stateIndex = 0; return PasswordField({label: 'Senha', value: 'Synthetic-only-123', autoComplete: 'current-password', onChange() {}}); }
assert.equal(find(password(), n => n.type === 'input').props.type, 'password');
let toggle = find(password(), n => n.type === 'button');
assert.equal(toggle.props.type, 'button'); assert.equal(toggle.props['aria-label'], 'Mostrar senha');
toggle.props.onClick();
assert.equal(find(password(), n => n.type === 'input').props.type, 'text');
assert.equal(find(password(), n => n.type === 'input').props.value, 'Synthetic-only-123');
assert.equal(find(password(), n => n.type === 'input').props.autoComplete, 'current-password');
toggle = find(password(), n => n.type === 'button');
assert.equal(toggle.props['aria-label'], 'Ocultar senha'); assert.equal(toggle.props['aria-pressed'], true);
toggle.props.onClick(); assert.equal(find(password(), n => n.type === 'input').props.type, 'password');
console.log('Access fields: country name/DDI/accent search, shared codes, keyboard selection, national-only phone and password visibility passed.');

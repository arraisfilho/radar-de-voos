// Airport picker: where the focus goes after choosing or removing an airport, from fixtures; no browser or network.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const req = require('node:module').createRequire(path.join(__dirname, '../frontend/package.json'));
const React = req('react'), ts = req('typescript'), {renderToStaticMarkup} = req('react-dom/server');
const source = path.join(__dirname, '../frontend/src'), modules = new Map();
let states = [], stateIndex = 0, refs = [], refIndex = 0, effects = [], frames = [];
const hooks = {
  ...React,
  useId: () => 'fixture',
  useState: initial => { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
  useRef: initial => { const i = refIndex++; return refs[i] || (refs[i] = {current: initial}); },
  useEffect: (effect, deps) => effects.push({effect, deps}),
};
const document = {body: {name: 'body'}, activeElement: null};
document.activeElement = document.body;
const sessionStorage = {getItem: () => null, setItem() {}};
// The catalog answers at once: the debounce runs immediately and fetch returns the fixtures.
let catalog = [];
const fetch = async () => ({ok: true, json: async () => catalog});
const timers = {setTimeout: callback => { callback(); return 1; }, clearTimeout() {}};
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const out = {}; modules.set(file, out);
  const code = ts.transpileModule(fs.readFileSync(path.join(source, file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}}).outputText;
  vm.runInNewContext(code, {exports: out, Intl, document, sessionStorage, fetch, AbortController, ...timers, requestAnimationFrame: callback => frames.push(callback), require: name =>
    name.endsWith('.css') ? {} : name === 'react' ? hooks : name === './i18n' ? {getLocale: () => 'pt-BR', t: (key, args = []) => key.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]))} :
    name.startsWith('./') ? load(name.slice(2) + (fs.existsSync(path.join(source, name.slice(2) + '.tsx')) ? '.tsx' : '.ts')) : req(name)});
  return out;
}
const {AirportPicker} = load('AirportPicker.tsx');
function find(node, predicate) { if (!node || typeof node !== 'object') return null; if (predicate(node)) return node; for (const child of React.Children.toArray(node.props?.children)) { const found = find(child, predicate); if (found) return found; } return null; }
const control = name => { const node = {name, focus() { document.activeElement = node; }}; return node; };
const airports = [
  {code: 'GRU', city: 'São Paulo', name: 'Guarulhos - Governador Andre Franco Montoro International Airport', label: 'Guarulhos - Governador Andre Franco Montoro', country: 'BR', timezone: 'America/Sao_Paulo'},
  {code: 'CGH', city: 'São Paulo', name: 'Congonhas Airport', label: 'Congonhas', country: 'BR', timezone: 'America/Sao_Paulo'},
  {code: 'SDU', city: 'Rio de Janeiro', name: 'Santos Dumont Airport', label: 'Santos Dumont', country: 'BR', timezone: 'America/Sao_Paulo'},
];
let changed = null;
function render(props) {
  stateIndex = 0; refIndex = 0; effects = [];
  return AirportPicker({label: 'Destino', field: 'destination', airports, onChange: values => { changed = values; }, values: [], ...props});
}
// refs: 0 search field, 1 listbox, 2 the picker. The picker answers the queries the focus code makes.
function page(controls) { (refs[2] ||= {current: null}).current = {isConnected: true, querySelector: selector => controls[selector] || null}; }
const runFrames = () => { const pending = frames; frames = []; pending.forEach(callback => callback()); };

// Removing a chip: the next chip, else "Adicionar outro…", else the previous chip, else the search field.
const next = control('SDU chip'), add = control('add'), before = control('GRU chip'), field = control('search');
states = []; refs = [];
let tree = render({values: ['GRU', 'CGH', 'SDU']});
page({'[data-airport="SDU"] button': next, '[data-airport="GRU"] button': before, '.airport-add': add}); refs[0].current = field;
find(tree, n => n.props?.['aria-label'] === 'Remover CGH de Destino').props.onClick(); runFrames();
assert.deepEqual(changed, ['GRU', 'SDU']); assert.equal(document.activeElement, next, 'The next chip takes the focus');
tree = render({values: ['GRU', 'SDU']});
find(tree, n => n.props?.['aria-label'] === 'Remover SDU de Destino').props.onClick(); runFrames();
assert.equal(document.activeElement, add, 'After the last chip, "Adicionar outro destino" takes it');
page({'[data-airport="GRU"] button': before});
tree = render({values: ['GRU', 'SDU']});
find(tree, n => n.props?.['aria-label'] === 'Remover SDU de Destino').props.onClick(); runFrames();
assert.equal(document.activeElement, before, 'Without the add button (limit reached), the previous chip');
page({});
tree = render({values: ['GRU']});
find(tree, n => n.props?.['aria-label'] === 'Remover GRU de Destino').props.onClick(); runFrames();
assert.equal(document.activeElement, field, 'The only chip gone, the search field');

// Choosing: onSelected moves on; without a next field the chosen airports keep the focus.
document.activeElement = document.body;
states = [false, 'gua', [airports[0]], true, 0, false, '']; refs = [];
page({'.airport-add, .airport-chip:last-child button': add});
tree = render({values: []});
let selected = 0;
find(tree, n => n.props?.role === 'option').props.onClick(); runFrames();
assert.deepEqual(Array.from(changed), ['GRU']); assert.equal(document.activeElement, add, 'With nothing next, "Adicionar outro destino" takes the focus');
const following = control('passengers');
states = [false, 'gua', [airports[0]], true, 0, false, '']; document.activeElement = document.body;
tree = render({values: [], onSelected: () => { selected++; following.focus(); }});
find(tree, n => n.props?.role === 'option').props.onClick(); runFrames();
assert.equal(selected, 1); assert.equal(document.activeElement, following, 'onSelected keeps the control it focused');
console.log('Airport picker focus: next chip, add button, previous chip or field after a removal; next field after a choice passed.');

// Typing: the first result is highlighted on its own (aria-activedescendant), so Enter picks it.
(async () => {
  catalog = airports.slice(0, 2); states = [false, 'gua', [], true, -1, false, '', false]; refs = []; changed = null;
  render({values: []});
  effects[0].effect(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(states[4], 0, 'The first option is highlighted');
  tree = render({values: []});
  const input = () => find(tree, n => n.type === 'input');
  assert.equal(input().props['aria-activedescendant'], 'fixture-option-0');
  // Home and End still move the caret in the field until the list is browsed.
  let prevented = false;
  input().props.onKeyDown({key: 'Home', preventDefault: () => { prevented = true; }});
  assert.equal(prevented, false, 'Home stays in the text field');
  input().props.onKeyDown({key: 'Enter', preventDefault() {}});
  assert.deepEqual(Array.from(changed), ['GRU'], 'Enter without an arrow chooses the highlighted airport');
  // Arrows browse from the highlight; then Home and End move through the list.
  states = [false, 'gua', airports.slice(0, 2), true, 0, false, '', false]; changed = null;
  tree = render({values: []});
  input().props.onKeyDown({key: 'ArrowDown', preventDefault() {}});
  assert.equal(states[4], 1); assert.equal(states[7], true, 'Arrows start browsing');
  tree = render({values: []});
  input().props.onKeyDown({key: 'Home', preventDefault() {}});
  assert.equal(states[4], 0, 'Home goes to the first option while browsing');
  console.log('Airport combobox: first option highlighted for Enter, Home and End in the field until browsing passed.');

  // A long name is cut to the column; the full name stays in the text and the tooltip.
  states = []; tree = render({values: ['GRU']});
  const name = find(tree, n => n.type === 'span' && n.props.title);
  assert.equal(name.props.title, 'São Paulo · Guarulhos - Governador Andre Franco Montoro');
  assert.equal(name.props.children, name.props.title);
  const postcss = req('postcss'), sheet = postcss.parse(fs.readFileSync(path.join(source, 'search-form.css'), 'utf8'));
  const rule = selector => { const found = {}; sheet.walkRules(item => { if (item.parent.type !== 'atrule' && item.selectors.includes(selector)) item.walkDecls(d => { found[d.prop] = d.value; }); }); return found; };
  assert.equal(rule('.airport-picker')['grid-template-columns'], 'minmax(0, 1fr)', 'The picker column never grows past the field');
  assert.equal(rule('.airport-chip')['min-width'], '0');
  const label = rule('.airport-chip > span');
  assert.equal(label['text-overflow'], 'ellipsis'); assert.equal(label['white-space'], 'nowrap'); assert.equal(label['min-width'], '0');
  console.log('Airport chips: long names cut with an ellipsis inside the column, full name in the tooltip passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

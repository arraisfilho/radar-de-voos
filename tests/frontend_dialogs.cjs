// Dialog focus, errors inside confirmations, live regions that exist before their message and the pager; no browser.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const req = require('node:module').createRequire(path.join(__dirname, '../frontend/package.json'));
const React = req('react'), ts = req('typescript'), {renderToStaticMarkup} = req('react-dom/server');
const source = path.join(__dirname, '../frontend/src'), modules = new Map();

// Radix renders a dialog in a portal once mounted; this stand-in renders the content in place and keeps its props.
let content = null;
const Dialog = {
  Root: ({open, children}) => (open ? React.createElement(React.Fragment, null, children) : null),
  Portal: ({children}) => children,
  Overlay: () => null,
  Content: ({children, className, ...props}) => { content = props; return React.createElement('div', {role: 'dialog', className}, children); },
  Title: ({children}) => React.createElement('h2', null, children),
  Description: ({children}) => React.createElement('p', null, children),
  Close: ({children}) => children,
};
// A synthetic page: elements report connection and focus, the heading of their card and the page <h1>.
let frames = [], pageHeading = null, selection = '';
const document = {body: {name: 'body'}, activeElement: null, querySelector: selector => (selector === 'main h1' ? pageHeading : null)};
document.activeElement = document.body;
function element(name, {connected = true, area = null, focusable = true} = {}) {
  const node = {
    name, isConnected: connected, attributes: {},
    focus() { if (focusable && node.isConnected) document.activeElement = node; },
    closest: () => area,
    matches: selector => /^h[1-6]$/.test(name) && selector.split(',').map(s => s.trim()).includes(name),
    hasAttribute: key => key in node.attributes,
    setAttribute: (key, value) => { node.attributes[key] = value; },
  };
  return node;
}
const card = heading => ({querySelector: () => heading});
function load(file, mocks = {}) {
  if (modules.has(file)) return modules.get(file);
  const out = {}; modules.set(file, out);
  const code = ts.transpileModule(fs.readFileSync(path.join(source, file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}}).outputText;
  vm.runInNewContext(code, {exports: out, document, requestAnimationFrame: callback => frames.push(callback), window: {getSelection: () => ({toString: () => selection})}, require: name =>
    name.endsWith('.css') ? {} : name === '@radix-ui/react-dialog' ? Dialog : name === './i18n' ? {t: (key, args = []) => key.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]))} :
    name.startsWith('./') ? load(name.slice(2) + (fs.existsSync(path.join(source, name.slice(2) + '.tsx')) ? '.tsx' : '.ts')) : req(name)});
  return out;
}
const ui = load('ui.tsx');
const runFrames = () => { const pending = frames; frames = []; pending.forEach(callback => callback()); };

// A confirmation that failed keeps the dialog open and announces the error inside it.
let closed = 0;
const confirm = props => renderToStaticMarkup(React.createElement(ui.ConfirmDialog, {open: true, onOpenChange() {}, title: 'Excluir?', description: 'Fixture', confirmLabel: 'Excluir definitivamente', onConfirm() {}, onClosed: () => closed++, ...props}));
let html = confirm({error: 'Falha de exclusão (fixture)'});
const dialog = html.slice(html.indexOf('role="dialog"'));
assert.match(dialog, /<p role="alert" aria-live="assertive" aria-atomic="true">Falha de exclusão \(fixture\)<\/p>/, 'The error is an alert inside the dialog');
assert.ok(dialog.indexOf('Falha de exclusão') < dialog.indexOf('Excluir definitivamente'), 'The error comes before the actions');
html = confirm({});
assert.match(html, /<div class="notice is-error is-empty"><p role="alert" aria-live="assertive" aria-atomic="true"><\/p><\/div>/, 'Before any error, the empty alert region already exists');
console.log('Confirmations: the error of the action is an alert inside the open dialog, in a region that exists beforehand passed.');

// Focus: the control that opened the dialog takes it back once the dialog is gone.
const trigger = element('button');
document.activeElement = trigger;
content.onOpenAutoFocus({preventDefault() {}});
document.activeElement = document.body; // the dialog held the focus and left the page
let prevented = false;
content.onCloseAutoFocus({preventDefault: () => { prevented = true; }});
assert.ok(prevented, 'Radix would otherwise send the focus to its missing trigger');
assert.equal(closed, 1, 'onClosed runs once the dialog has left');
runFrames();
assert.equal(document.activeElement, trigger, 'The opener gets the focus back');
// A navigation that already focused the new page title keeps it.
const title = element('h1');
document.activeElement = trigger; content.onOpenAutoFocus({preventDefault() {}});
document.activeElement = title; content.onCloseAutoFocus({preventDefault() {}}); runFrames();
assert.equal(document.activeElement, title, 'Nothing is pulled away from a control that holds the focus');
// The opener left the page (a deleted row): the title of its card takes the focus.
const cardTitle = element('h2'), removed = element('button', {area: card(cardTitle)});
document.activeElement = removed; content.onOpenAutoFocus({preventDefault() {}});
removed.isConnected = false; document.activeElement = document.body;
content.onCloseAutoFocus({preventDefault() {}}); runFrames();
assert.equal(document.activeElement, cardTitle, 'The card title takes the focus');
assert.equal(cardTitle.attributes.tabindex, '-1', 'A title becomes focusable from script only');
// Neither the opener nor its card remain: the page <h1>.
pageHeading = element('h1');
const lost = element('button', {area: card(element('h2', {connected: false}))});
document.activeElement = lost; content.onOpenAutoFocus({preventDefault() {}});
lost.isConnected = false; document.activeElement = document.body;
content.onCloseAutoFocus({preventDefault() {}}); runFrames();
assert.equal(document.activeElement, pageHeading, 'The page title takes the focus last');
console.log('Dialog focus: back to the opener, else the card or page title, never away from a newly focused title passed.');

// Notices render their live region with or without a message; the dismiss button stays outside it.
const notice = props => renderToStaticMarkup(React.createElement(ui.Notice, props));
assert.equal(notice({}), '<div class="notice is-success is-empty"><p role="status" aria-live="polite" aria-atomic="true"></p></div>');
html = notice({children: 'Configuração salva.', onDismiss() {}});
assert.match(html, /<p role="status" aria-live="polite" aria-atomic="true">Configuração salva\.<\/p><button[^>]*aria-label="Dispensar mensagem"/, 'The message enters the existing region; the button follows it');
assert.ok(!html.includes('is-empty'));
console.log('Notices: the status region exists before the message and the dismiss button sits outside it passed.');

// Pager: the buttons are never disabled (they keep the focus while the next page loads); the ends are aria-disabled.
const {Pager, FilterBar} = load('DataView.tsx');
const pages = [];
function buttons(page) {
  const tree = Pager({page, pageSize: 15, total: 40, onPage: next => pages.push(next), label: 'Páginas'});
  const found = [];
  (function walk(node) { if (!node || typeof node !== 'object') return; if (node.type === ui.Button) found.push(node); React.Children.toArray(node.props?.children).forEach(walk); })(tree);
  return found;
}
let [previous, next] = buttons(0);
assert.equal(previous.props.disabled, undefined); assert.equal(previous.props['aria-disabled'], true); assert.equal(next.props['aria-disabled'], undefined);
previous.props.onClick(); next.props.onClick(); assert.deepEqual(pages, [1], 'The first page ignores "previous"');
[previous, next] = buttons(2);
assert.equal(next.props['aria-disabled'], true); next.props.onClick(); previous.props.onClick(); assert.deepEqual(pages, [1, 1], 'The last page ignores "next"');
html = renderToStaticMarkup(React.createElement(Pager, {page: 1, pageSize: 15, total: 40, onPage() {}, label: 'Páginas'}));
assert.ok(!html.includes('disabled'), 'A middle page has both buttons usable');
html = renderToStaticMarkup(React.createElement(FilterBar, {title: 'Filtrar', active: 0, onApply() {}, onReset() {}}, React.createElement('label', {className: 'field'}, 'Campo')));
assert.ok(!/disabled/.test(html), 'The filter buttons stay enabled while the list reloads');
console.log('Pager and filters: no disabled buttons while loading, aria-disabled ends passed.');
// Clickable rows: a click that ends a text selection does not open the row.
const {selectingText} = load('DataView.tsx');
assert.equal(selectingText(), false);
selection = 'Radar de Voos: queda de preço';
assert.equal(selectingText(), true, 'Selecting a subject to copy it keeps the list');
selection = '';
console.log('Clickable rows: text selection does not open the row passed.');
// States in place of a list: h3 inside a card, h2 right under the page title (task pages).
const {LoadError, EmptyRows} = load('DataView.tsx');
assert.ok(renderToStaticMarkup(React.createElement(LoadError, {message: 'Fixture'})).includes('<h3>Não foi possível carregar</h3>'));
assert.ok(renderToStaticMarkup(React.createElement(LoadError, {message: 'Fixture', level: 2})).includes('<h2>Não foi possível carregar</h2>'));
assert.ok(renderToStaticMarkup(React.createElement(EmptyRows, {icon: () => null, title: 'Nada', level: 2})).includes('<h2>Nada</h2>'));
console.log('List states: heading level follows the page outline passed.');

// Two-step verification from fixtures: the login code step, the administrator's block in the profile (password
// dialogs, QR code, recovery codes), the QR code itself, the recovery codes file, the leave prompt and the audit
// labels. No browser, account, clipboard or network is used.
process.env.TZ = 'America/Sao_Paulo';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {pathToFileURL} = require('node:url');
const req = require('node:module').createRequire(path.join(__dirname, '../frontend/package.json'));
const React = req('react'), ts = req('typescript'), postcss = req('postcss'), {renderToStaticMarkup} = req('react-dom/server');
const source = path.join(__dirname, '../frontend/src'), modules = new Map();
const catalog = JSON.parse(fs.readFileSync(path.join(source, 'messages.json'), 'utf8'));

// Hooks keep their values by call order across renders, as React does for one mounted component. After a
// remount the setters of the old one write nowhere, as React ignores an unmounted component.
let states = [], refs = [], index = 0, refIndex = 0, ids = 0;
const remount = () => { states = []; refs = []; };
const begin = () => { index = 0; refIndex = 0; ids = 0; };
const hooks = {
  ...React,
  useState(initial) {
    const bucket = states, i = index++;
    if (!(i in bucket)) bucket[i] = typeof initial === 'function' ? initial() : initial;
    return [bucket[i], value => { bucket[i] = typeof value === 'function' ? value(bucket[i]) : value; }];
  },
  useRef(initial) { const i = refIndex++; if (!(i in refs)) refs[i] = {current: initial}; return refs[i]; },
  useEffect() {}, useLayoutEffect() {},
  useMemo: create => create(),
  useId: () => 'id-' + ids++,
};

// Radix renders a dialog in a portal once mounted; this stand-in renders it in place and keeps its props.
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

// What the components reach outside React: the API, the query cache, the clipboard, the page and the download link.
let answers = [], calls = [], query = null, guard = null, title = null, clipboard = [], timers = [], clicks = [], blobs = [], revoked = [];
let commands = [], created = [], dispatched = [], fetchImpl = null, execResult = true, language = 'pt', refetches = 0;
async function fakeApi(...args) {
  calls.push(args);
  const next = answers.shift();
  if (next instanceof Error) throw next;
  return next;
}
const failure = (message, status) => Object.assign(Error(message), {status});
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; };
const refetch = () => { refetches++; return Promise.resolve(); };
const client = {
  log: [], cleared: 0,
  async cancelQueries(options) { this.log.push('cancel:' + options.queryKey[0]); },
  setQueryData(key, value) { this.log.push('set:' + key[0]); query = {...query, data: value}; },
  invalidateQueries(options) { this.log.push('invalidate:' + options.queryKey[0]); },
  clear() { this.cleared++; },
};
const navigator = {language: 'pt-BR', clipboard: undefined};
const listeners = {};
const window = {setTimeout: (callback, delay) => timers.push({callback, delay}), clearTimeout() {}, addEventListener(type, listener) { (listeners[type] ||= []).push(listener); }, removeEventListener() {}, dispatchEvent: event => dispatched.push(event)};
class Blob { constructor(parts, options) { this.parts = parts; this.type = options.type; } }
class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
const URL = {createObjectURL: blob => { blobs.push(blob); return 'blob:fixture'; }, revokeObjectURL: url => revoked.push(url)};
const selection = {rangeCount: 0, getRangeAt() {}, removeAllRanges() {}, addRange() {}};
const document = {
  activeElement: null,
  body: {append: node => { node.appended = true; created.push(node); }},
  querySelector: () => null,
  getSelection: () => selection,
  execCommand: command => { commands.push({command, text: created[created.length - 1]?.value}); return execResult; },
  createElement: tag => {
    const node = {tag, style: {}, attributes: {}, setAttribute(name, value) { node.attributes[name] = value; },
      select() {}, setSelectionRange(start, end) { node.range = [start, end]; },
      click() { clicks.push({href: node.href, download: node.download, appended: node.appended}); },
      remove() { node.removed = true; }, focus() {}};
    return node;
  },
};
const location = {host: 'radar.example.org', hash: ''};
const translate = (key, values = []) => (language === 'pt' ? key : catalog[key]?.[language] || key).replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)] ?? ''));
const stubs = {
  './i18n': {t: translate, getLanguage: () => language, getLocale: () => ({pt: 'pt-BR', en: 'en-US', es: 'es-ES'})[language], useLanguage: () => language, usePendingLanguage: () => null, setLanguage: async () => {}},
  '@tanstack/react-query': {useQuery: () => query, useQueryClient: () => client},
  '@radix-ui/react-dialog': Dialog,
  './navigationGuard': {useUnsavedChanges: (dirty, prompt) => { guard = {dirty, prompt}; }},
  './pageTitle': {usePageTitle: page => { title = page; }},
  './PhoneField': {PhoneField: () => null},
  './EmailFields': {EmailFields: () => null},
  './AdditionalPhones': {AdditionalPhones: () => null},
  './TimeZoneField': {TimeZoneField: () => null, validTimeZone: () => true},
  './LanguagePicker': {LanguagePicker: () => null},
  './AppearancePicker': {AppearancePicker: () => null},
  './QuickPreferences': {QuickPreferences: () => null},
  './SystemVersion': {SystemVersion: () => null},
  './AppIcon': {AppIcon: () => null},
  './Avatar': {Avatar: () => null},
  './navigation': {plainClick: () => true, routePath: () => '/admin/envios'},
  './AuditPanel': {AuditPanel: () => React.createElement('p', null, 'Audit fixture')},
};
function resolve(name, overrides) {
  if (name.endsWith('.css')) return {};
  if (overrides && name in overrides) return overrides[name];
  if (name in stubs) return stubs[name];
  if (name === 'react') return hooks;
  if (name.startsWith('./')) return load(name.slice(2) + (fs.existsSync(path.join(source, name.slice(2) + '.tsx')) ? '.tsx' : '.ts'));
  return req(name);
}
/** A module of frontend/src; with `overrides`, a fresh copy that sees those modules instead. */
function load(file, overrides) {
  if (!overrides && modules.has(file)) return modules.get(file);
  const out = {};
  if (!overrides) modules.set(file, out);
  const code = ts.transpileModule(fs.readFileSync(path.join(source, file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}}).outputText;
  vm.runInNewContext(code, {exports: out, Intl, Date, URLSearchParams, structuredClone, console, navigator, window, document, URL, Blob, CustomEvent, location,
    requestAnimationFrame: () => {}, fetch: (...args) => fetchImpl(...args), require: name => resolve(name, overrides)});
  return out;
}
// Calls function components depth-first, as React renders them, so their elements and handlers can be reached.
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== 'object' || !node.props) return node;
  if (typeof node.type === 'function' && !node.type.prototype?.isReactComponent) return expand(node.type(node.props));
  return {...node, props: {...node.props, children: expand(node.props.children)}};
}
function all(tree, test, found = []) {
  if (Array.isArray(tree)) { tree.forEach(item => all(item, test, found)); return found; }
  if (!tree || typeof tree !== 'object') return found;
  if (test(tree)) found.push(tree);
  all(tree.props?.children, test, found);
  return found;
}
const text = node => (typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '');
const button = (tree, label) => all(tree, node => node.type === 'button' && text(node).trim() === label)[0];
const field = (tree, test) => all(tree, node => (node.type === 'input' || node.type === 'textarea') && test(node.props))[0];
/** Markup and expanded tree of one render. */
function screen(element) {
  begin();
  const html = renderToStaticMarkup(element);
  begin();
  return {html, tree: expand(element)};
}
const settle = () => new Promise(done => setImmediate(done));
const event = {preventDefault() {}};
// Values built inside vm contexts have other prototypes: compare them as data.
const plain = value => JSON.parse(JSON.stringify(value));
const same = (actual, expected, ...message) => assert.deepEqual(plain(actual), plain(expected), ...message);
const alertText = (html, message) => new RegExp(`<p role="alert" aria-live="assertive" aria-atomic="true"( id="[^"]+")?>${message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</p>`).test(html);

(async () => {
  // ---------- API errors carry the HTTP status ----------------------------------------------------------------
  const authApi = load('authApi.ts');
  const reply = (status, body) => async (url, init) => { calls.push([url, init]); return {ok: status < 400, status, json: async () => body}; };
  fetchImpl = reply(410, {detail: 'A verificação expirou. Entre novamente.'});
  let error = await authApi.api('/auth/login/2fa', 'fixture-token', {code: '123456'}).catch(e => e);
  assert.equal(error.message, 'A verificação expirou. Entre novamente.');
  assert.equal(error.status, 410);
  assert.equal(authApi.errorStatus(error), 410);
  assert.equal(calls[0][1].headers['x-radar-token'], 'fixture-token');
  fetchImpl = reply(422, {detail: [{msg: 'Value error, Informe o código de 6 dígitos'}]});
  error = await authApi.api('/auth/2fa/confirm', 'fixture-token', {code: '12'}).catch(e => e);
  assert.equal(error.message, 'Informe o código de 6 dígitos');
  assert.equal(error.status, 422);
  fetchImpl = reply(200, {enabled: false});
  same(await authApi.api('/auth/2fa/disable', 'fixture-token', {password: 'x'}), {enabled: false});
  assert.equal(authApi.errorStatus(Error('network')), undefined);
  assert.equal(authApi.errorStatus(null), undefined);
  console.log('Account requests: translated message and HTTP status on the thrown error passed.');
  stubs['./authApi'] = {...authApi, api: fakeApi};

  // ---------- The code field: digits only, a paste goes in place of the selection ----------------------------------
  const {CodeField, codeDigits, pasteCode} = load('CodeField.tsx');
  assert.equal(codeDigits(' 123 456 '), '123456');
  assert.equal(codeDigits('12-34'), '1234');
  assert.equal(codeDigits('1234567'), '123456');
  same(pasteCode('12', ' 34', 2, 2), {value: '1234', caret: 4});
  same(pasteCode('123456', '9', 2, 4), {value: '12956', caret: 3}, 'The selection is replaced');
  same(pasteCode('12', '345 678', 2, 2), {value: '123456', caret: 6}, 'Never more than six digits');
  let typed = null, prevented = false;
  const codeInputOf = props => all(CodeField({label: 'Código', onValue: value => { typed = value; }, ...props}), node => node.type === 'input')[0];
  let input = codeInputOf({value: ''});
  assert.equal(input.props.autoComplete, 'one-time-code');
  assert.equal(input.props.inputMode, 'numeric');
  assert.equal(input.props.pattern, '[0-9]{6}');
  assert.equal(input.props.maxLength, 6);
  assert.equal(input.props.required, true);
  input.props.onPaste({clipboardData: {getData: () => '123 456'}, currentTarget: {selectionStart: 0, selectionEnd: 0}, preventDefault: () => { prevented = true; }});
  assert.equal(typed, '123456', 'A pasted "123 456" is kept whole, without the space');
  assert.ok(prevented, 'The paste is read before maxLength would cut it');
  input = codeInputOf({value: '1299'});
  input.props.onPaste({clipboardData: {getData: () => '3 4'}, currentTarget: {selectionStart: 2, selectionEnd: 4}, preventDefault() {}});
  assert.equal(typed, '1234', 'Pasting over a selection replaces it');
  prevented = false; typed = null;
  input.props.onPaste({clipboardData: {getData: () => 'abc'}, currentTarget: {selectionStart: 4, selectionEnd: 4}, preventDefault: () => { prevented = true; }});
  assert.ok(!prevented && typed === null, 'A paste without digits is left to the browser');
  input.props.onChange({target: {value: '98 76'}});
  assert.equal(typed, '9876');
  console.log('Code field: numeric one-time-code input, six digits, pasted spaces removed, paste over a selection passed.');

  // ---------- Login: the code step after the password -------------------------------------------------------------
  const {SignIn} = load('SignIn.tsx');
  const session = {user: null, token: 'fixture-token', can_bootstrap: false, registration_open: true};
  const user = {id: 'admin-1', name: 'Admin fixture', role: 'admin'};
  let signedIn = null;
  const signInProps = {session, onSignedIn: next => { signedIn = next; }, onRecover() {}};
  const signIn = () => screen(React.createElement(SignIn, signInProps));
  const form = tree => all(tree, node => node.type === 'form')[0];
  async function submitPassword(answer, password = 'fixture password') {
    let {tree} = signIn();
    field(tree, props => props.autoComplete === 'current-password').props.onChange({target: {value: password}});
    ({tree} = signIn());
    answers = [answer];
    form(tree).props.onSubmit(event);
    await settle();
    return signIn();
  }
  // An account without the second factor signs in with the password, as before.
  remount(); calls = []; signedIn = null;
  let {html, tree} = signIn();
  assert.ok(/<p id="[^"]+" class="form-error is-empty" role="alert"><\/p>/.test(html), 'The alert region is there before any message');
  await submitPassword(user);
  assert.equal(calls[0][0], '/auth/login');
  same(signedIn, {...session, user, can_bootstrap: false});
  // With the second factor, the password opens the code step instead of a session.
  remount(); calls = []; signedIn = null; client.cleared = 0;
  ({html, tree} = await submitPassword({two_factor_required: true, expires_in: 300}));
  assert.equal(calls[0][2].password, 'fixture password');
  assert.equal(signedIn, null, 'No session before the code');
  assert.match(html, /<h2 class="auth-heading">Verificação em duas etapas<\/h2>/);
  assert.equal(title, 'Verificação em duas etapas');
  assert.ok(html.includes('Digite o código de 6 dígitos do seu aplicativo autenticador.'));
  let code = field(tree, props => props.autoComplete === 'one-time-code');
  assert.ok(code, 'The code field replaces the password');
  assert.equal(code.props.autoFocus, true);
  // React writes these attributes in camelCase; HTML reads attribute names in any case.
  assert.ok(/<input[^>]*autocomplete="one-time-code"/i.test(html) && /inputmode="numeric"/i.test(html) && html.includes('pattern="[0-9]{6}"') && /maxlength="6"/i.test(html));
  assert.ok(!html.includes('current-password'), 'The password field leaves the card');
  for (const label of ['Verificar', 'Usar código de recuperação', 'Voltar']) assert.ok(button(tree, label), `${label} button`);
  for (const gone of ['Esqueci minha senha', 'Criar conta']) assert.ok(!html.includes(gone), `${gone} waits for the password step`);
  // While the code is checked, nothing can switch the step under the answer.
  code.props.onPaste({clipboardData: {getData: () => '123 456'}, currentTarget: {selectionStart: 0, selectionEnd: 0}, preventDefault() {}});
  ({tree} = signIn());
  assert.equal(field(tree, props => props.autoComplete === 'one-time-code').props.value, '123456');
  const pending = deferred();
  answers = [pending.promise];
  form(tree).props.onSubmit(event);
  ({tree} = signIn());
  for (const label of ['Usar código de recuperação', 'Voltar']) assert.equal(button(tree, label).props.disabled, true, `${label} waits for the answer`);
  pending.resolve(Promise.reject(failure('Código incorreto.', 401)));
  await settle();
  ({html, tree} = signIn());
  same(calls.at(-1).slice(0, 3), ['/auth/login/2fa', 'fixture-token', {code: '123456'}]);
  // A wrong code: announced, tied to the field, and the field cleared for the next code.
  const signInError = html.match(/<p id="([^"]+)" class="form-error" role="alert">Código incorreto\.<\/p>/);
  assert.ok(signInError, 'The error fills the region that was already there');
  code = field(tree, props => props.autoComplete === 'one-time-code');
  assert.equal(code.props.value, '');
  assert.equal(code.props['aria-invalid'], true);
  assert.ok(code.props['aria-describedby'].split(' ').includes(signInError[1]), 'The field points to its error');
  for (const label of ['Usar código de recuperação', 'Voltar']) assert.equal(button(tree, label).props.disabled, false);
  // The server's key missing (503): the reason, the code not marked wrong, the recovery code one click away.
  code.props.onChange({target: {value: '111111'}});
  ({tree} = signIn());
  answers = [failure('Código do aplicativo indisponível no momento. Use um código de recuperação.', 503)];
  form(tree).props.onSubmit(event);
  await settle();
  ({html, tree} = signIn());
  assert.ok(html.includes('role="alert">Código do aplicativo indisponível no momento. Use um código de recuperação.</p>'));
  assert.equal(field(tree, props => props.autoComplete === 'one-time-code').props['aria-invalid'], undefined);
  // A recovery code instead, and the way back to the app code.
  button(tree, 'Usar código de recuperação').props.onClick();
  ({html, tree} = signIn());
  assert.ok(/class="form-error is-empty" role="alert"><\/p>/.test(html), 'Switching clears the error');
  assert.ok(html.includes('Digite um dos códigos de recuperação que você guardou ao ativar a verificação.'));
  const recovery = field(tree, props => props.className === 'recovery-input');
  assert.equal(recovery.props.autoComplete, 'off');
  assert.equal(recovery.props.autoCapitalize, 'none');
  assert.equal(recovery.props.spellCheck, false);
  assert.equal(recovery.props.autoFocus, true);
  assert.ok(/<label>Código de recuperação<input[^>]*autoComplete="off"[^>]*autoCapitalize="none"[^>]*spellcheck="false"/i.test(html));
  assert.ok(button(tree, 'Usar o código do aplicativo'));
  recovery.props.onChange({target: {value: ' ABCD-EFGH-JKMN-PQRS '}});
  ({tree} = signIn());
  // Five minutes later the server forgot the password step: back to it, with the reason announced in the same region.
  answers = [failure('A verificação expirou. Entre novamente.', 410)];
  form(tree).props.onSubmit(event);
  await settle();
  ({html, tree} = signIn());
  same(calls.at(-1)[2], {recovery_code: 'ABCD-EFGH-JKMN-PQRS'});
  assert.ok(html.includes('Entre no seu radar'));
  assert.ok(/<p id="[^"]+" class="form-error" role="alert">A verificação expirou\. Entre novamente\.<\/p>/.test(html));
  assert.equal(field(tree, props => props.autoComplete === 'current-password').props.value, '', 'The password was not kept');
  // The password again, then the app code (the step starts on the app code) signs in.
  ({html, tree} = await submitPassword({two_factor_required: true, expires_in: 300}));
  code = field(tree, props => props.autoComplete === 'one-time-code');
  assert.ok(code, 'A new code step asks for the app code first');
  code.props.onChange({target: {value: '654321'}});
  ({tree} = signIn());
  answers = [user];
  form(tree).props.onSubmit(event);
  await settle();
  same(calls.at(-1)[2], {code: '654321'});
  same(signedIn, {...session, user, can_bootstrap: false});
  assert.ok(client.cleared > 0, 'The cache of a previous visit goes, as in the password login');
  // "Voltar" returns to the password step with nothing typed.
  remount();
  ({tree} = await submitPassword({two_factor_required: true, expires_in: 300}));
  button(tree, 'Voltar').props.onClick();
  ({html, tree} = signIn());
  assert.ok(html.includes('Entre no seu radar') && html.includes('form-error is-empty'));
  assert.equal(field(tree, props => props.autoComplete === 'current-password').props.value, '');
  console.log('Login: code step after the password, paste, busy step, wrong code tied to the field, missing key, recovery code, expired step and back passed.');

  // ---------- QR code --------------------------------------------------------------------------------------------
  const uri = 'otpauth://totp/Radar%20de%20Voos:%2B5511987654321?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Radar%20de%20Voos&algorithm=SHA1&digits=6&period=30';
  const qr = load('qr.ts');
  const matrix = qr.qrMatrix(uri), n = matrix.length;
  // Byte mode, error correction M: the smallest version whose capacity holds the address.
  const capacity = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
  const version = capacity.findIndex(bytes => bytes >= uri.length) + 1;
  assert.equal(version, 8);
  assert.equal(n, 17 + 4 * version, 'Module count of the smallest version that fits');
  assert.ok(matrix.every(row => row.length === n));
  const FINDER = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
  const finderAt = (top, left) => FINDER.every((row, r) => [...row].every((bit, c) => matrix[top + r][left + c] === (bit === '1')));
  assert.ok(finderAt(0, 0) && finderAt(0, n - 7) && finderAt(n - 7, 0), 'Finder patterns in three corners');
  assert.ok(!finderAt(n - 7, n - 7), 'No finder pattern in the fourth corner');
  for (let i = 0; i < 8; i++) {
    assert.ok(!matrix[7][i] && !matrix[i][7], 'Separator of the top-left finder');
    assert.ok(!matrix[7][n - 1 - i] && !matrix[i][n - 8], 'Separator of the top-right finder');
    assert.ok(!matrix[n - 8][i] && !matrix[n - 1 - i][7], 'Separator of the bottom-left finder');
  }
  // Format information (ISO/IEC 18004, 7.9): 15 bits around the top-left finder and again split between the other
  // two, masked with 101010000010010; the first two data bits are the error correction level, 00 for M.
  const bit = (row, column) => (matrix[row][column] ? 1 : 0);
  let near = 0, apart = 0;
  for (let i = 0; i <= 5; i++) near |= bit(i, 8) << i;
  near |= bit(7, 8) << 6 | bit(8, 8) << 7 | bit(8, 7) << 8;
  for (let i = 9; i < 15; i++) near |= bit(8, 14 - i) << i;
  for (let i = 0; i < 8; i++) apart |= bit(8, n - 1 - i) << i;
  for (let i = 8; i < 15; i++) apart |= bit(n - 15 + i, 8) << i;
  assert.equal(near, apart, 'Both copies of the format information agree');
  const format = near ^ 0b101010000010010, data = format >> 10;
  let check = data;
  for (let i = 0; i < 10; i++) check = (check << 1) ^ ((check >> 9) * 0b10100110111);
  assert.equal(format & 0x3ff, check, 'BCH(15,5) check bits of the format information');
  assert.equal(data >> 3, 0b00, 'Error correction level M');
  assert.ok(matrix[n - 8][8], 'The dark module beside the bottom-left finder');
  // The browser bundles the ESM build of the library; it draws the same symbol.
  const esm = (await import(pathToFileURL(path.join(path.dirname(req.resolve('qrcode-generator')), 'qrcode.mjs')).href)).default;
  same(load('qr.ts', {'qrcode-generator': esm}).qrMatrix(uri), matrix);
  // One path of one-module-high rectangles, shifted by the quiet zone, draws exactly the dark modules.
  const {size, path: d} = qr.qrPath(matrix);
  assert.equal(qr.QR_QUIET_ZONE, 4);
  assert.equal(size, n + 8);
  const runs = [...d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
  assert.equal(runs.map(run => run[0]).join(''), d, 'Only rectangles in the path');
  const drawn = Array.from({length: size}, () => Array(size).fill(false));
  for (const [, x, y, width, back] of runs) {
    assert.equal(width, back);
    assert.ok(!drawn[+y][+x - 1] && !matrix[+y - 4][+x - 5] && !matrix[+y - 4][+x - 4 + +width], 'Each rectangle is a whole run');
    for (let i = 0; i < +width; i++) { assert.ok(!drawn[+y][+x + i], 'No overlap'); drawn[+y][+x + i] = true; }
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      assert.equal(drawn[y][x], y >= 4 && x >= 4 && y < size - 4 && x < size - 4 && matrix[y - 4][x - 4], `Module ${x},${y}`);
  for (const [top, left] of [[4, 4], [4, size - 11], [size - 11, 4]])
    assert.ok(FINDER.every((row, r) => [...row].every((value, c) => drawn[top + r][left + c] === (value === '1'))), 'Finder drawn inside the quiet zone');
  // The colors: dark modules on a light field that the dark appearance never inverts.
  const theme = postcss.parse(fs.readFileSync(path.join(source, 'theme.css'), 'utf8'));
  const tokens = {light: {}, dark: {}};
  theme.walkRules(':root', rule => rule.walkDecls(decl => { tokens[rule.parent.type === 'atrule' && rule.parent.params.includes('dark') ? 'dark' : 'light'][decl.prop] = decl.value; }));
  assert.equal(tokens.light['--qr-light'], '#ffffff');
  assert.equal(tokens.light['--qr-dark'], '#000000');
  assert.ok(!('--qr-light' in tokens.dark) && !('--qr-dark' in tokens.dark), 'The QR tokens stay the same in the dark appearance');
  const qrRule = {};
  postcss.parse(fs.readFileSync(path.join(source, 'pages.css'), 'utf8')).walkRules('.two-factor-qr', rule => rule.walkDecls(decl => { qrRule[decl.prop] = decl.value; }));
  assert.equal(qrRule.background, 'var(--qr-light)');
  assert.equal(qrRule.fill, 'var(--qr-dark)');
  assert.equal(qrRule['forced-color-adjust'], 'none');
  console.log('QR code: module count, three finder patterns, format bits at level M, quiet zone, one path, same symbol in both builds and fixed colors passed.');

  // ---------- Leave prompt: a text of its own per form -----------------------------------------------------------------
  const live = {...hooks, useRef: value => ({current: value}), useEffect: effect => effect()};
  const codesPrompt = {title: 'Sair sem guardar os códigos?', description: 'Os códigos de recuperação não serão mostrados de novo. Saia só depois de copiá-los ou baixá-los.', stay: 'Continuar aqui', leave: 'Sair mesmo assim'};
  let guards = load('navigationGuard.ts', {react: live}), proceeded = 0;
  guards.useUnsavedChanges(false, {title: 'Não fala: nada a perder'});
  guards.useUnsavedChanges(true, codesPrompt);
  dispatched = [];
  guards.confirmNavigation(() => proceeded++);
  assert.equal(proceeded, 0);
  same(dispatched[0].detail.prompt, codesPrompt, 'The only form with something to lose speaks with its own text');
  guards.useUnsavedChanges(true);
  dispatched = [];
  guards.confirmNavigation(() => proceeded++);
  assert.equal(dispatched[0].detail.prompt, undefined, 'Another form without a text of its own would lose too: the default text');
  guards = load('navigationGuard.ts', {react: live});
  guards.useUnsavedChanges(true);
  dispatched = [];
  guards.confirmNavigation(() => proceeded++);
  assert.equal(dispatched[0].detail.prompt, undefined, 'Without a text of its own, the default one');
  guards = load('navigationGuard.ts', {react: live});
  guards.useUnsavedChanges(false, codesPrompt);
  guards.confirmNavigation(() => proceeded++);
  assert.equal(proceeded, 1, 'Nothing to lose: no question');
  const {NavigationPrompt} = load('NavigationPrompt.tsx');
  remount(); states[0] = {proceed() {}, cancel() {}}; refs[0] = {current: codesPrompt};
  begin(); html = renderToStaticMarkup(React.createElement(NavigationPrompt));
  for (const part of Object.values(codesPrompt)) assert.ok(html.includes(part), `Leave prompt shows "${part}"`);
  remount(); states[0] = {proceed() {}, cancel() {}}; refs[0] = {current: undefined};
  begin(); html = renderToStaticMarkup(React.createElement(NavigationPrompt));
  for (const part of ['Descartar alterações?', 'Há informações não salvas neste formulário.', 'Continuar editando', 'Descartar e sair']) assert.ok(html.includes(part), `Default prompt keeps "${part}"`);
  console.log('Leave prompt: a text per form, the default text otherwise, and no question when nothing would be lost passed.');

  // ---------- Profile: the block of the administrator, isolated from failures -----------------------------------------
  const ui = load('ui.tsx');
  const settings = load('TwoFactorSettings.tsx');
  const {Profile, TwoFactorBlock} = load('Profile.tsx');
  const profileUser = {id: 'admin-1', name: 'Admin fixture', role: 'admin', phone: '+5511987654321', country: 'BR', emails: [], additional_phones: [], whatsapp_use_login: true, whatsapp_country: 'BR', whatsapp_phone: '+5511987654321', telegram_username: '', language: 'pt', timezone: 'America/Sao_Paulo', quiet_hours: false, quiet_start: '22:00', quiet_end: '08:00', phone_verified: true};
  const profile = role => { remount(); begin(); return renderToStaticMarkup(React.createElement(Profile, {user: {...profileUser, role}, token: 'fixture-token', onSaved: async () => {}, onLogout: async () => {}, onNotice() {}})); };
  const offData = {enabled: false, enabled_at: null, recovery_codes_remaining: 0};
  query = {data: offData, isPending: false, isError: false, refetch};
  html = profile('admin');
  const security = html.slice(html.indexOf('profile-security'));
  assert.ok(security.indexOf('Verificação em duas etapas') >= 0 && security.indexOf('Verificação em duas etapas') < security.indexOf('Audit fixture'), 'Above the access list');
  assert.ok(html.includes('Carregando…'), 'A placeholder while the chunk downloads');
  await settle();
  html = profile('admin');
  assert.match(html, /<section class="list-group two-factor" aria-labelledby="[^"]+"><div class="list-row two-factor-heading">/);
  html = profile('user');
  assert.ok(!html.includes('Verificação em duas etapas') && !html.includes('two-factor'), 'Other accounts never see it');
  assert.ok(html.includes('Audit fixture'));
  // A failure stays in the block, with a retry that asks for the chunk again.
  const isolated = new TwoFactorBlock({token: 'fixture-token', userId: 'admin-1'});
  isolated.setState = update => Object.assign(isolated.state, update);
  const firstChunk = isolated.render().props.children.type;
  Object.assign(isolated.state, TwoFactorBlock.getDerivedStateFromError(Error('chunk failed')));
  const failed = isolated.render();
  html = renderToStaticMarkup(failed);
  assert.ok(html.includes('Verificação em duas etapas') && alertText(html, 'Não foi possível carregar a verificação em duas etapas.') && html.includes('Tentar novamente'));
  button(expand(failed), 'Tentar novamente').props.onClick();
  assert.equal(isolated.state.failed, false);
  assert.notEqual(isolated.render().props.children.type, firstChunk, 'A new lazy component, so the download is tried again');
  console.log('Profile: the block only for administrators, above the access list, its failures kept inside it passed.');

  // ---------- Profile block: every state ---------------------------------------------------------------------------------
  const props = {token: 'fixture-token', userId: 'admin-1'};
  const block = () => screen(React.createElement(settings.TwoFactorSettings, props));
  const shallow = () => { begin(); return settings.TwoFactorSettings(props); };
  const dialogOf = variant => all(shallow(), node => node.type === ui.ConfirmDialog && (node.props.confirmVariant || 'danger') === variant)[0];
  const regions = html => (html.match(/class="two-factor-messages[^"]*"/g) || []).length;
  settings.forgetIssuedCodes();
  remount(); calls = [];
  query = {data: undefined, isPending: true, isError: false, refetch};
  ({html} = block());
  assert.ok(html.includes('<h3 id=') && html.includes('Verificação em duas etapas') && html.includes('Carregando…'));
  assert.ok(!html.includes('status-pill') && !html.includes('Ativar'));
  query = {data: undefined, isPending: false, isError: true, refetch};
  ({html, tree} = block());
  assert.ok(alertText(html, 'Não foi possível carregar a verificação em duas etapas.'));
  refetches = 0; button(tree, 'Tentar novamente').props.onClick(); assert.equal(refetches, 1);
  // Off: what it does and "Ativar"; the message regions exist before any message.
  query = {data: offData, isPending: false, isError: false, refetch};
  ({html, tree} = block());
  assert.ok(html.includes('<span class="status-pill">Desativada</span>'));
  assert.ok(html.includes('Além da senha, o login pedirá um código de 6 dígitos'));
  assert.ok(!html.includes('<svg class="two-factor-qr"') && !html.includes('role="dialog"'));
  assert.equal(regions(html), 2, 'Success and error regions in every view');
  same(guard, {dirty: false, prompt: plain(guard.prompt)});
  // "Ativar" asks for the password first, in a dialog that explains why; the field takes the focus.
  button(tree, 'Ativar').props.onClick();
  ({html, tree} = block());
  let dialog = html.slice(html.indexOf('role="dialog"'));
  assert.ok(dialog.includes('<h2>Ativar a verificação em duas etapas</h2>') && dialog.includes('Para proteger sua conta, confirme sua senha'));
  assert.ok(/<input[^>]*autoComplete="current-password"/i.test(dialog) && dialog.includes('Sua senha'));
  assert.ok(/<button class="button button-primary button-standard"[^>]*>Continuar<\/button>/.test(dialog), 'A blue confirmation: nothing is removed');
  const focusRef = dialogOf('primary').props.initialFocus;
  let focused = 0, preventedFocus = 0;
  focusRef.current = {focus() { focused++; }};
  content.onOpenAutoFocus({preventDefault() { preventedFocus++; }});
  assert.ok(preventedFocus === 1 && focused === 1, 'The password field takes the focus, not the close button');
  calls = [];
  dialogOf('primary').props.onConfirm(); await settle();
  ({html, tree} = block());
  assert.equal(calls.length, 0, 'Nothing is sent without the password');
  assert.ok(alertText(html.slice(html.indexOf('role="dialog"')), 'Digite sua senha para confirmar.'));
  field(tree, props => props.autoComplete === 'current-password').props.onChange({target: {value: 'wrong password'}});
  answers = [failure('Senha incorreta.', 403)]; focused = 0;
  dialogOf('primary').props.onConfirm(); await settle();
  ({html, tree} = block());
  same(calls.at(-1), ['/auth/2fa/setup', 'fixture-token', {password: 'wrong password'}]);
  assert.ok(alertText(html.slice(html.indexOf('role="dialog"')), 'Senha incorreta.'), 'The error is announced inside the open dialog');
  assert.equal(field(tree, props => props.autoComplete === 'current-password').props.value, '');
  assert.equal(focused, 1, 'The field takes the focus again after the error');
  // Turned on in another tab meanwhile (409): the dialog closes, the status reloads, the reason shows in the block.
  field(tree, props => props.autoComplete === 'current-password').props.onChange({target: {value: 'fixture password'}});
  answers = [failure('A verificação em duas etapas já está ativa.', 409)]; refetches = 0;
  dialogOf('primary').props.onConfirm(); await settle();
  ({html} = block());
  assert.ok(!html.includes('role="dialog"') && refetches === 1);
  dialogOf('primary').props.onClosed();
  ({html, tree} = block());
  assert.ok(alertText(html, 'A verificação em duas etapas já está ativa.'), 'Announced once the dialog has left');
  // The right password: setup with the QR code, the key in groups of four and the address to copy or select.
  const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
  button(tree, 'Ativar').props.onClick();
  ({tree} = block());
  field(tree, props => props.autoComplete === 'current-password').props.onChange({target: {value: 'fixture password'}});
  answers = [{secret, uri, expires_in: 600}];
  dialogOf('primary').props.onConfirm(); await settle();
  ({html, tree} = block());
  same(calls.at(-1), ['/auth/2fa/setup', 'fixture-token', {password: 'fixture password'}]);
  assert.ok(!html.includes('role="dialog"') && !alertText(html, 'A verificação em duas etapas já está ativa.'));
  const svg = html.match(/<svg [^>]*class="two-factor-qr"[^>]*>(.*?)<\/svg>/);
  assert.ok(svg, 'The QR code is an inline SVG');
  assert.ok(svg[0].includes(`viewBox="0 0 ${size} ${size}"`) && svg[0].includes('shape-rendering="crispEdges"') && svg[0].includes('role="img"'));
  assert.ok(svg[0].includes('aria-label="QR code para configurar o aplicativo autenticador"'));
  assert.equal(svg[1], `<path d="${d}"></path>`, 'A single path, the one qrPath draws');
  assert.ok(html.includes('Não consegue ler o QR code?'));
  assert.ok(html.includes('<p class="two-factor-secret" translate="no">JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP</p>'));
  assert.ok(html.includes('<summary>Mostrar link de configuração</summary>'));
  const address = field(tree, props => props.className === 'two-factor-uri');
  assert.ok(address.props.readOnly && address.props.value === uri && address.props['aria-label'] === 'Link de configuração', 'The otpauth:// address in a read-only field');
  assert.ok(/<input[^>]*autocomplete="one-time-code"/i.test(html.slice(html.indexOf('two-factor-confirm'))));
  assert.ok(html.includes('A configuração expira em 10 minutos.') && html.includes('as outras sessões abertas da sua conta serão encerradas'));
  for (const label of ['Copiar chave', 'Copiar link', 'Cancelar', 'Confirmar']) assert.ok(button(tree, label), `${label} button`);
  assert.equal(guard.dirty, true, 'Leaving during the setup asks first');
  assert.equal(guard.prompt.title, 'Sair antes de concluir?');
  // Copy: the clipboard API, or a selected textarea where it does not exist (http:// on a local network).
  navigator.clipboard = {writeText: async value => { clipboard.push(value); }};
  button(tree, 'Copiar chave').props.onClick(); await settle();
  assert.equal(clipboard.at(-1), secret, 'The key is copied without the spaces of its groups');
  ({html, tree} = block());
  assert.ok(button(tree, 'Copiado'), 'The button confirms the copy');
  assert.ok(html.includes('<p class="sr-only" role="status" aria-live="polite">Copiado para a área de transferência.</p>'));
  navigator.clipboard = undefined; execResult = true; commands = []; created = [];
  button(tree, 'Copiar link').props.onClick(); await settle();
  same(commands, [{command: 'copy', text: uri}]);
  assert.ok(created[0].tag === 'textarea' && 'readonly' in created[0].attributes && created[0].removed, 'A read-only textarea, removed afterwards');
  ({html, tree} = block());
  assert.ok(!alertText(html, 'Não foi possível copiar. Selecione o texto e copie manualmente.'));
  execResult = false;
  button(tree, 'Copiar chave').props.onClick(); await settle();
  ({html, tree} = block());
  assert.ok(alertText(html, 'Não foi possível copiar. Selecione o texto e copie manualmente.'), 'Neither way worked: the reason');
  // A wrong confirmation code keeps the setup; the error is tied to the field.
  field(tree, props => props.autoComplete === 'one-time-code').props.onChange({target: {value: '12 34 56'}});
  ({tree} = block());
  answers = [failure('Código incorreto. Confira o horário do celular e tente de novo.', 422)];
  all(tree, node => node.type === 'form' && /two-factor-confirm/.test(node.props.className))[0].props.onSubmit(event);
  await settle();
  ({html, tree} = block());
  same(calls.at(-1), ['/auth/2fa/confirm', 'fixture-token', {code: '123456'}]);
  assert.ok(alertText(html, 'Código incorreto. Confira o horário do celular e tente de novo.') && html.includes('two-factor-qr'));
  let confirmCode = field(tree, props => props.autoComplete === 'one-time-code');
  assert.equal(confirmCode.props.value, '');
  assert.equal(confirmCode.props['aria-invalid'], true);
  const blockError = all(tree, node => node.type === 'p' && node.props.role === 'alert')[0].props.id;
  assert.ok(blockError && confirmCode.props['aria-describedby'].split(' ').includes(blockError), 'The field points to its error');
  // Cancelling waits for a confirmation on its way, then goes back to the status.
  confirmCode.props.onChange({target: {value: '111111'}});
  ({tree} = block());
  const slow = deferred();
  answers = [slow.promise];
  all(tree, node => node.type === 'form' && /two-factor-confirm/.test(node.props.className))[0].props.onSubmit(event);
  ({tree} = block());
  assert.equal(button(tree, 'Cancelar').props.disabled, true, 'No cancelling under a confirmation on its way');
  slow.resolve(Promise.reject(failure('A configuração expirou. Comece de novo.', 410)));
  await settle();
  // An expired setup starts over, with the reason.
  ({html, tree} = block());
  assert.ok(!html.includes('two-factor-qr') && alertText(html, 'A configuração expirou. Comece de novo.') && button(tree, 'Ativar'));
  // Setup again; cancel goes back to the status.
  const setupAgain = async () => {
    ({tree} = block());
    button(tree, 'Ativar').props.onClick();
    ({tree} = block());
    field(tree, props => props.autoComplete === 'current-password').props.onChange({target: {value: 'fixture password'}});
    answers = [{secret, uri, expires_in: 600}];
    dialogOf('primary').props.onConfirm(); await settle();
    ({tree} = block());
  };
  await setupAgain();
  button(tree, 'Cancelar').props.onClick();
  ({html, tree} = block());
  assert.ok(!html.includes('two-factor-qr') && button(tree, 'Ativar'));
  // The right code: the recovery codes, shown once, to copy or download; the status is cached without them.
  await setupAgain();
  field(tree, props => props.autoComplete === 'one-time-code').props.onChange({target: {value: '654321'}});
  ({tree} = block());
  const codes = ['abcd-efgh-jkmn-pqrs', '2345-6789-abcd-efgh', 'jkmn-pqrs-tuvw-xyz2', '3456-789a-bcde-fghj', 'kmnp-qrst-uvwx-yz23', '4567-89ab-cdef-ghjk', 'mnpq-rstu-vwxy-z234', '5678-9abc-defg-hjkm', 'npqr-stuv-wxyz-2345', '6789-abcd-efgh-jkmn'];
  const enabledAt = Date.UTC(2026, 9, 17, 12, 30) / 1000;
  const confirmed = {enabled: true, enabled_at: enabledAt, recovery_codes_remaining: 10, recovery_codes: codes};
  answers = [confirmed]; client.log = [];
  all(tree, node => node.type === 'form' && /two-factor-confirm/.test(node.props.className))[0].props.onSubmit(event); await settle();
  ({html, tree} = block());
  same(calls.at(-1), ['/auth/2fa/confirm', 'fixture-token', {code: '654321'}]);
  same(query.data, {enabled: true, enabled_at: enabledAt, recovery_codes_remaining: 10}, 'The cached status never keeps the codes');
  same(client.log, ['cancel:two-factor', 'set:two-factor', 'invalidate:audit'], 'A status request in flight is cancelled before the new status is written');
  assert.ok(html.includes('<span class="status-pill is-active">Ativada</span>'));
  assert.ok(html.includes('<p role="status" aria-live="polite" aria-atomic="true">Verificação em duas etapas ativada.</p>'));
  assert.ok(html.includes('Guarde seus códigos de recuperação') && html.includes('Cada código vale uma vez.') && html.includes('Eles não serão mostrados de novo.'));
  const list = html.match(/<ul class="two-factor-codes" role="list" translate="no" aria-label="Códigos de recuperação">(.*?)<\/ul>/);
  assert.ok(list, 'A list with role="list", which Safari keeps without bullets');
  assert.equal(list[1], codes.map(item => `<li>${item}</li>`).join(''));
  assert.equal(guard.dirty, true);
  same(guard.prompt, {title: 'Sair sem guardar os códigos?', description: 'Os códigos de recuperação não serão mostrados de novo. Saia só depois de copiá-los ou baixá-los.', stay: 'Continuar aqui', leave: 'Sair mesmo assim'});
  for (const label of ['Copiar', 'Baixar', 'Concluir']) assert.ok(button(tree, label), `${label} button`);
  navigator.clipboard = {writeText: async value => { clipboard.push(value); }};
  button(tree, 'Copiar').props.onClick(); await settle();
  assert.equal(clipboard.at(-1), codes.join('\n'));
  // Download: a text file named in the language of the page, with when and for which address.
  const kept = settings.issuedCodes('admin-1');
  same(kept.codes, codes);
  ({tree} = block());
  timers = []; clicks = []; blobs = []; revoked = [];
  button(tree, 'Baixar').props.onClick();
  same(clicks, [{href: 'blob:fixture', download: 'radar-de-voos-codigos-de-recuperacao.txt', appended: true}]);
  assert.equal(blobs[0].type, 'text/plain;charset=utf-8');
  assert.equal(blobs[0].parts.join(''), settings.recoveryCodesText(codes, new Date(kept.issuedAt), 'radar.example.org'));
  timers.forEach(timer => timer.callback());
  same(revoked, ['blob:fixture'], 'The temporary address is released afterwards');
  const formats = load('format.ts');
  const issuedAt = new Date(Date.UTC(2026, 9, 17, 12, 30));
  for (const [code, file, heading, line] of [
    ['pt', 'radar-de-voos-codigos-de-recuperacao.txt', 'Radar de Voos: códigos de recuperação', 'Emitidos em {0} para radar.example.org'],
    ['en', 'flight-radar-recovery-codes.txt', 'Flight Radar (Radar de Voos): recovery codes', 'Issued on {0} for radar.example.org'],
    ['es', 'radar-de-vuelos-codigos-de-recuperacion.txt', 'Radar de Vuelos (Radar de Voos): códigos de recuperación', 'Emitidos el {0} para radar.example.org'],
  ]) {
    language = code;
    assert.equal(settings.recoveryFileName(), file);
    assert.ok(/^[a-z0-9.-]+$/.test(file), 'An ASCII file name');
    assert.equal(settings.recoveryCodesText(codes.slice(0, 2), issuedAt, 'radar.example.org'),
      [heading, line.replace('{0}', formats.formatDateTime(issuedAt)), '', codes[0], codes[1], ''].join('\n'), `File in ${code}`);
  }
  language = 'pt';
  assert.equal(settings.groupSecret(secret), 'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP');
  // The codes outlive the block for ten minutes, for the same account only; "Concluir" forgets them.
  remount();
  ({html} = block());
  assert.ok(list[0] && html.includes(list[0]), 'Back on the profile, the codes are still there');
  assert.equal(settings.issuedCodes('admin-1', kept.issuedAt + 11 * 60_000), null, 'Ten minutes later they are gone');
  settings.keepIssuedCodes('admin-1', codes);
  assert.equal(settings.issuedCodes('admin-2'), null, 'Another account never sees them');
  assert.equal(settings.issuedCodes('admin-1'), null, 'And they are dropped');
  settings.keepIssuedCodes('admin-1', codes);
  for (const listener of listeners['radar:signed-out'] || []) listener();
  assert.equal(settings.issuedCodes('admin-1'), null, 'Signing out forgets them');
  // A confirmation that answers after the block left the page keeps its codes for the next visit.
  query = {data: offData, isPending: false, isError: false, refetch};
  remount();
  await setupAgain();
  field(tree, props => props.autoComplete === 'one-time-code').props.onChange({target: {value: '222222'}});
  ({tree} = block());
  const late = deferred();
  answers = [late.promise];
  all(tree, node => node.type === 'form' && /two-factor-confirm/.test(node.props.className))[0].props.onSubmit(event);
  remount(); // the administrator left the profile meanwhile
  late.resolve(confirmed);
  await settle();
  ({html, tree} = block());
  assert.ok(html.includes('Guarde seus códigos de recuperação') && codes.every(item => html.includes(`<li>${item}</li>`)), 'The late codes show on the next visit');
  button(tree, 'Concluir').props.onClick();
  assert.equal(settings.issuedCodes('admin-1'), null, '"Concluir" forgets them');
  // On: since when, how many recovery codes remain, and "Desativar".
  ({html, tree} = block());
  assert.equal(guard.dirty, false);
  assert.ok(html.includes('Ativada desde 17 de out. de 2026'));
  assert.ok(/Códigos de recuperação<\/span><span class="list-row-detail">10 restantes<\/span>/.test(html));
  assert.ok(!html.includes('two-factor-codes') && !html.includes('Para gerar novos códigos'));
  query = {...query, data: {...query.data, recovery_codes_remaining: 1}};
  ({html, tree} = block());
  assert.ok(html.includes('1 restante<') && html.includes('Para gerar novos códigos de recuperação, desative e ative a verificação de novo.'));
  // Turning off asks for the password in a red confirmation; its errors stay inside the dialog.
  button(tree, 'Desativar').props.onClick();
  ({html, tree} = block());
  dialog = html.slice(html.indexOf('role="dialog"'));
  assert.ok(dialog.includes('<h2>Desativar a verificação em duas etapas?</h2>'));
  assert.ok(/<input[^>]*autoComplete="current-password"/i.test(dialog) && dialog.includes('Sua senha'));
  assert.ok(/<button class="button button-danger button-standard button-confirm"[^>]*>Desativar<\/button>/.test(dialog));
  const stopFocus = dialogOf('danger').props.initialFocus;
  assert.equal(stopFocus, dialogOf('primary').props.initialFocus, 'The same password field takes the focus in both dialogs');
  stopFocus.current = {focus() { focused++; }};
  field(tree, props => props.autoComplete === 'current-password').props.onChange({target: {value: 'wrong password'}});
  answers = [failure('Senha incorreta.', 403)]; focused = 0;
  dialogOf('danger').props.onConfirm(); await settle();
  ({html, tree} = block());
  same(calls.at(-1), ['/auth/2fa/disable', 'fixture-token', {password: 'wrong password'}]);
  assert.ok(alertText(html.slice(html.indexOf('role="dialog"')), 'Senha incorreta.') && focused === 1);
  // Already off in another tab (409): the dialog closes, the status reloads, the reason shows in the block.
  field(tree, props => props.autoComplete === 'current-password').props.onChange({target: {value: 'fixture password'}});
  answers = [failure('A verificação em duas etapas não está ativa.', 409)]; refetches = 0;
  dialogOf('danger').props.onConfirm(); await settle();
  ({html} = block());
  assert.ok(!html.includes('role="dialog"') && refetches === 1);
  dialogOf('danger').props.onClosed();
  ({html, tree} = block());
  assert.ok(alertText(html, 'A verificação em duas etapas não está ativa.'));
  // The right password: the status is written after cancelling a request in flight; the success waits for the dialog.
  button(tree, 'Desativar').props.onClick();
  ({tree} = block());
  field(tree, props => props.autoComplete === 'current-password').props.onChange({target: {value: 'fixture password'}});
  answers = [offData]; client.log = [];
  dialogOf('danger').props.onConfirm(); await settle();
  ({html, tree} = block());
  same(client.log, ['cancel:two-factor', 'set:two-factor', 'invalidate:audit']);
  assert.ok(!html.includes('role="dialog"'), 'The dialog closes');
  assert.ok(html.includes('<span class="status-pill">Desativada</span>') && button(tree, 'Ativar'));
  assert.ok(!html.includes('Verificação em duas etapas desativada.'), 'Not yet: the dialog is still leaving');
  dialogOf('danger').props.onClosed();
  ({html} = block());
  assert.ok(html.includes('<p role="status" aria-live="polite" aria-atomic="true">Verificação em duas etapas desativada.</p>'), 'The success waits for the dialog to leave');
  console.log('Profile block: loading, error, off, password dialogs with focus and errors, 409s in the block, setup with QR, key and address, copy with fallback, recovery codes kept outside the block, files per language, on and turning off passed.');

  // ---------- Audit labels ---------------------------------------------------------------------------------------------------
  const {AuditPanel, auditLabels, auditDetails} = load('AuditPanel.tsx');
  const labels = auditLabels();
  const expected = {
    admin_2fa_enabled: 'Verificação em duas etapas ativada',
    admin_2fa_disabled: 'Verificação em duas etapas desativada',
    login_2fa_started: 'Senha aceita, código pedido',
    login_2fa_failed: 'Código de verificação recusado',
    recovery_code_used: 'Código de recuperação usado',
  };
  for (const [name, label] of Object.entries(expected)) assert.equal(labels[name], label);
  for (const name of Object.keys(expected)) assert.ok(catalog[labels[name]]?.en && catalog[labels[name]]?.es, `${name} is translated`);
  same(auditDetails('admin_2fa_enabled', {sessions_revoked: 2}), [['Outras sessões encerradas', '2']]);
  same(auditDetails('recovery_code_used', {remaining: 9}), [['Códigos de recuperação restantes', '9']]);
  same(auditDetails('admin_2fa_disabled', null), []);
  same(auditDetails('login_2fa_started', null), []);
  // They belong to an account, so the personal list offers them (configuration events stay out of it).
  query = {data: {items: [], total: 0, page_size: 25, days: 30, max_records: 20000}, isPending: false, isError: false, isFetching: false, refetch};
  remount(); begin();
  html = renderToStaticMarkup(React.createElement(AuditPanel));
  for (const [name, label] of Object.entries(expected)) assert.ok(html.includes(`<option value="${name}">${label}</option>`), `${name} in the personal filter`);
  assert.ok(!html.includes('value="admin_smtp_saved"'));
  console.log('Audit: labels and details of the two-step verification events, offered in the personal list passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

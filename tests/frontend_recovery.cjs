// Password recovery by code from fixtures: the phone and channel step, the code and new password on the same
// screen, the resend countdown, refused codes and the way back. No browser, account or network is used.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const req = require('node:module').createRequire(path.join(__dirname, '../frontend/package.json'));
const React = req('react'), ts = req('typescript'), postcss = req('postcss'), {renderToStaticMarkup} = req('react-dom/server');
const source = path.join(__dirname, '../frontend/src');
const catalog = JSON.parse(fs.readFileSync(path.join(source, 'messages.json'), 'utf8'));

// Hooks keep their values by call order across renders, as React does for one mounted component; effects run
// when the test says so, and the timers they start wait in `timers`.
let states = [], refs = [], effects = [], index = 0, refIndex = 0, ids = 0;
const begin = () => { index = 0; refIndex = 0; ids = 0; effects = []; };
const hooks = {
  ...React,
  useState(initial) {
    const i = index++;
    if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
    return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }];
  },
  useRef(initial) { const i = refIndex++; if (!(i in refs)) refs[i] = {current: initial}; return refs[i]; },
  useEffect(effect) { effects.push(effect); },
  useLayoutEffect() {},
  useId: () => 'id-' + ids++,
};
let language = 'pt', title = null, answers = [], calls = [], timers = [], sessionOk = true;
const translate = (key, values = []) => (language === 'pt' ? key : catalog[key]?.[language] || key).replace(/\{(\d+)\}/g, (_, i) => String(values[Number(i)] ?? ''));
const failure = (message, status, retryAfter) => Object.assign(Error(message), {status, retryAfter});
const stubs = {
  './i18n': {t: translate, getLanguage: () => language},
  './authApi': {
    api: async (...args) => { calls.push(args); const next = answers.shift(); if (next instanceof Error) throw next; return next; },
    errorStatus: error => error?.status,
    retryAfter: error => error?.retryAfter,
  },
  './ui': {Button: ({children, variant, size, ...props}) => React.createElement('button', props, children), Card: ({children, ...props}) => React.createElement('section', props, children)},
  './PhoneField': {PhoneField: props => React.createElement('phone-field', {label: props.label, country: props.country, value: props.value, onChange: props.onChange})},
  './PasswordField': {PasswordField: ({label, ...props}) => React.createElement('label', null, label, React.createElement('input', {...props, type: 'password'}))},
  './QuickPreferences': {QuickPreferences: () => null},
  './SystemVersion': {SystemVersion: () => null},
  './AppIcon': {AppIcon: () => null},
  './pageTitle': {usePageTitle: page => { title = page; }},
};
function load(file) {
  const out = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(source, file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}}).outputText;
  vm.runInNewContext(code, {exports: out, console, requestAnimationFrame: () => {},
    setTimeout: (callback, delay) => { timers.push({callback, delay}); return timers.length; }, clearTimeout() {},
    fetch: async (url, init) => { assert.equal(url, '/api/auth/session'); assert.equal(init.cache, 'no-store'); if (!sessionOk) throw Error('offline'); return {ok: true, json: async () => ({token: 'fixture-token'})}; },
    require: name => name === 'react' ? hooks : name in stubs ? stubs[name] : name === './CodeField' ? load('CodeField.tsx') : req(name)});
  return out;
}
// Calls function components depth-first, as React renders them, so their elements and handlers can be reached.
function expand(node) {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== 'object' || !node.props) return node;
  if (typeof node.type === 'function') return expand(node.type(node.props));
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
const settle = () => new Promise(done => setImmediate(done));
const event = {preventDefault() {}};

const {RecoveryForm, RESEND_SECONDS} = load('RecoveryForm.tsx');
let backs = 0, dones = 0;
const element = () => React.createElement(RecoveryForm, {onBack: () => { backs++; }, onDone: () => { dones++; }});
/** One render: markup, expanded tree and its parts. */
function screen() {
  begin(); const html = renderToStaticMarkup(element());
  begin(); const tree = expand(element());
  const button = label => all(tree, node => node.type === 'button' && text(node).trim() === label)[0];
  return {html, tree, button,
    form: all(tree, node => node.type === 'form')[0],
    submit: all(tree, node => node.type === 'button' && node.props.type === 'submit')[0],
    radios: all(tree, node => node.type === 'input' && node.props.type === 'radio'),
    code: all(tree, node => node.type === 'input' && node.props.autoComplete === 'one-time-code')[0],
    password: all(tree, node => node.type === 'input' && node.props.type === 'password')[0],
    phone: all(tree, node => node.type === 'phone-field')[0],
    alert: text(all(tree, node => node.props?.role === 'alert')[0]),
    notice: all(tree, node => node.props?.role === 'status')[0]};
}
/** Runs the effects of the last render, then the timers they started: one second of each countdown. */
function tick() { timers = []; effects.forEach(effect => effect()); assert.ok(timers.length); for (const timer of timers) { assert.equal(timer.delay, 1000); timer.callback(); } }

(async () => {
  // ---------- First step: the login phone and the channel, WhatsApp first ----------------------------------------
  let view = screen();
  assert.equal(title, 'Recuperar acesso');
  for (const part of ['Recuperar acesso', 'Enviamos um código para o WhatsApp ou o e-mail da sua conta.', 'Receber o código por', 'Enviar código', 'Voltar ao login',
    'Sem WhatsApp ou e-mail na conta? Peça ao administrador para redefinir a senha.']) assert.ok(view.html.includes(part), part);
  assert.deepEqual(view.radios.map(radio => [radio.props.value, radio.props.checked, radio.props.name]), [['whatsapp', true, 'recovery-channel'], ['email', false, 'recovery-channel']]);
  assert.ok(view.html.includes('<legend>Receber o código por</legend>'));
  assert.match(view.html, /<label class="channel-option"><input type="radio" name="recovery-channel" checked="" value="whatsapp"\/><span class="channel-card"><svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>WhatsApp<\/span><\/label>/);
  assert.ok(!view.code && !view.password, 'No code or password before a code is sent');
  assert.equal(view.notice.props.className, 'auth-notice is-empty');assert.equal(text(view.notice), '', 'The notice region waits, empty');
  assert.equal(view.submit.props.disabled, false);
  view.radios[1].props.onChange();
  view.phone.props.onChange('US', '6502530000');
  view = screen();
  assert.deepEqual(view.radios.map(radio => radio.props.checked), [false, true]);
  answers.push({ok: true});
  view.form.props.onSubmit(event);await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['/auth/recovery', 'fixture-token', {country: 'US', phone: '6502530000', channel: 'email'}]]);
  console.log('Recovery request: phone and channel cards (WhatsApp first), one request with a fresh token passed.');

  // ---------- Second step, same screen: the code and the new password ----------------------------------------------
  view = screen();
  for (const part of ['Digite o código que chegou no seu e-mail.', 'Se a conta existir e tiver e-mail cadastrado, o código chega em instantes.', 'Código recebido no e-mail',
    'Nova senha', 'Pelo menos 10 caracteres.', 'Criar nova senha', 'Reenviar em 60 s']) assert.ok(view.html.includes(part), part);
  assert.equal(view.notice.props.className, 'auth-notice');
  assert.equal(view.phone.props.value, '6502530000', 'The phone and the channel stay on the screen');
  for (const [prop, value] of [['inputMode', 'numeric'], ['autoComplete', 'one-time-code'], ['maxLength', 6], ['pattern', '[0-9]{6}'], ['autoFocus', true], ['required', true]])
    assert.equal(view.code.props[prop], value, prop);
  for (const [prop, value] of [['autoComplete', 'new-password'], ['minLength', 10], ['maxLength', 200], ['required', true]]) assert.equal(view.password.props[prop], value, prop);
  assert.equal(view.submit.props.disabled, true, 'Disabled until six digits and a password');
  assert.equal(view.button('Reenviar em 60 s').props.disabled, true);
  assert.equal(RESEND_SECONDS, 60);
  tick();view = screen();assert.ok(view.button('Reenviar em 59 s'), 'The wait counts down every second');
  for (let left = 59; left > 0; left--) { tick(); view = screen(); }
  assert.equal(view.button('Reenviar código').props.disabled, false);
  timers = [];effects.forEach(effect => effect());assert.equal(timers.length, 0, 'At zero the countdown stops');
  view.code.props.onChange({target: {value: '12 34 5'}});
  view = screen();assert.equal(view.submit.props.disabled, true);
  view.code.props.onChange({target: {value: '12 34 56'}});view.password.props.onChange({target: {value: 'new-fixture-password'}});
  view = screen();assert.equal(view.submit.props.disabled, false);
  // A resend: the same phone and channel, and the wait starts over.
  answers.push({ok: true});view.button('Reenviar código').props.onClick();await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['/auth/recovery', 'fixture-token', {country: 'US', phone: '6502530000', channel: 'email'}]);
  view = screen();assert.ok(view.button('Reenviar em 60 s'));assert.equal(view.code.props.value, '', 'A new code replaces the typed one');
  console.log('Recovery code step: numeric one-time-code field, new password, button enabled by six digits and a password, 60 s resend countdown passed.');

  // ---------- Refused codes, the login lock and the success ------------------------------------------------------------
  view.code.props.onChange({target: {value: '111111'}});view = screen();
  answers.push(failure('Código inválido ou vencido. Peça um novo.', 422));
  view.form.props.onSubmit(event);await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1))), ['/auth/recovery/confirm', 'fixture-token', {country: 'US', phone: '6502530000', code: '111111', password: 'new-fixture-password'}]);
  view = screen();assert.equal(view.alert, 'Código inválido ou vencido. Peça um novo.');assert.equal(view.code.props.value, '');assert.equal(view.code.props['aria-invalid'], true);
  assert.equal(view.code.props['aria-describedby'], 'id-1 id-0', 'The field is described by the error and the hint');
  assert.equal(dones, 0);
  view.code.props.onChange({target: {value: '222222'}});view = screen();assert.equal(view.code.props['aria-invalid'], undefined, 'Typing clears the mark');
  // Another 422 (a field out of range) shows its message and keeps the code.
  answers.push(failure('Informe o código de 6 dígitos', 422));
  view.form.props.onSubmit(event);await settle();
  view = screen();assert.equal(view.alert, 'Informe o código de 6 dígitos');assert.equal(view.code.props.value, '222222');assert.equal(view.code.props['aria-invalid'], undefined);
  // The server counts code points: five emoji are ten UTF-16 units for the browser, but five characters.
  const sent = calls.length;
  view.password.props.onChange({target: {value: '😀😀😀😀😀'}});view = screen();assert.equal(view.submit.props.disabled, false);
  view.form.props.onSubmit(event);await settle();view = screen();
  assert.equal(calls.length, sent, 'Nothing is sent');assert.equal(view.alert, 'Use pelo menos dez caracteres.');
  view.password.props.onChange({target: {value: 'new-fixture-password'}});
  // The login lock: the notice says how long, the code stays, and "Criar nova senha" waits for Retry-After.
  answers.push(failure('Muitas tentativas. Aguarde alguns minutos e tente novamente.', 429, 61));
  view = screen();view.form.props.onSubmit(event);await settle();
  view = screen();
  assert.equal(view.alert, 'Acesso bloqueado temporariamente por tentativas erradas. Tente de novo em 2 min ou peça ao administrador para redefinir a senha.');
  assert.equal(view.code.props.value, '222222', 'The lock leaves the code as typed');assert.equal(view.code.props['aria-invalid'], undefined);
  assert.equal(text(view.submit), 'Criar nova senha em 1:01');assert.equal(view.submit.props.disabled, true);
  tick();view = screen();assert.equal(text(view.submit), 'Criar nova senha em 1:00');
  for (let left = 60; left > 0; left--) { tick(); view = screen(); }
  assert.equal(text(view.submit), 'Criar nova senha');assert.equal(view.submit.props.disabled, false);assert.equal(view.alert, '', 'The notice ends with the lock');
  for (const [seconds, minutes] of [[undefined, 1], [1, 1], [60, 1], [845, 15]]) {
    answers.push(failure('Muitas tentativas. Aguarde alguns minutos e tente novamente.', 429, seconds));view.form.props.onSubmit(event);await settle();view = screen();
    assert.ok(view.alert.includes(`em ${minutes} min`), `${seconds} s: ${view.alert}`);
    for (let left = seconds ?? 60; left > 0; left--) { tick(); view = screen(); }
  }
  answers.push({ok: true});view.form.props.onSubmit(event);await settle();
  assert.equal(dones, 1, 'Back to the login, which says the password was created');
  console.log('Recovery confirmation: refused code cleared and marked, the lock keeps it, success goes back to the login passed.');

  // ---------- A new phone or channel goes back to the first step -------------------------------------------------------
  // A fresh code, then another channel: the wait of that account goes on.
  view = screen();answers.push({ok: true});view.button('Reenviar código').props.onClick();await settle();
  view = screen();view.radios[0].props.onChange();view = screen();
  assert.ok(!view.code && !view.password && view.html.includes('Enviamos um código para o WhatsApp ou o e-mail da sua conta.'));
  assert.equal(view.notice.props.className, 'auth-notice is-empty');
  assert.equal(text(view.submit), 'Reenviar em 60 s');assert.equal(view.submit.props.disabled, true, 'The server sends one code a minute: the button waits too');
  for (let left = 60; left > 0; left--) { tick(); view = screen(); }
  assert.equal(text(view.submit), 'Enviar código');
  answers.push({ok: true});view.form.props.onSubmit(event);await settle();view = screen();
  assert.equal(calls.at(-1)[2].channel, 'whatsapp');
  assert.ok(view.html.includes('Digite o código que chegou no seu WhatsApp.') && view.html.includes('Se a conta existir e tiver WhatsApp cadastrado, o código chega em instantes.') && view.html.includes('Código recebido no WhatsApp'));
  view.phone.props.onChange('US', '6502530001');view = screen();assert.ok(!view.code, 'Another phone, another code');
  assert.equal(text(view.submit), 'Enviar código');assert.equal(view.submit.props.disabled, false, 'Another phone (another account) ends the wait of the former one');
  view.button('Voltar ao login').props.onClick();assert.equal(backs, 1);
  // Without the server, the session check fails before any request.
  sessionOk = false;const before = calls.length;view.form.props.onSubmit(event);await settle();view = screen();
  assert.equal(view.alert, 'Não foi possível conectar ao radar.');assert.equal(calls.length, before);sessionOk = true;
  console.log('Recovery: another phone or channel asks for a new code, the way back and an unreachable server passed.');

  // ---------- English and Spanish --------------------------------------------------------------------------------------
  for (const [lang, resend, note] of [['en', 'Resend in 60 s', 'No WhatsApp or email on the account?'], ['es', 'Reenviar en 60 s', '¿Sin WhatsApp ni correo en la cuenta?']]) {
    language = lang;states = [];refs = [];
    view = screen();view.phone.props.onChange('US', '6502530000');answers.push({ok: true});view.form.props.onSubmit(event);await settle();view = screen();
    assert.ok(view.html.includes(resend), resend);assert.ok(view.html.includes(note), note);
  }
  language = 'pt';
  console.log('Recovery texts in English and Spanish passed.');

  // ---------- Retry-After reaches the error of an account request ---------------------------------------------------
  let header = '845';
  const accountApi = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(source, 'authApi.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {exports: accountApi,
    fetch: async () => ({ok: false, status: 429, headers: {get: name => (name === 'retry-after' ? header : null)}, json: async () => ({detail: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'})}),
    require: name => stubs[name]});
  let error = await accountApi.api('/auth/recovery/confirm', 'fixture-token', {}).catch(e => e);
  assert.deepEqual([error.status, accountApi.retryAfter(error), error.message], [429, 845, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.']);
  header = null;error = await accountApi.api('/auth/recovery/confirm', 'fixture-token', {}).catch(e => e);
  assert.equal(accountApi.retryAfter(error), undefined, 'Without the header, the form waits a minute');
  console.log('Account requests: Retry-After on the error of a 429 passed.');

  // ---------- Styles: theme tokens, 44 px cards, the hidden notice ---------------------------------------------------
  const sheet = postcss.parse(fs.readFileSync(path.join(source, 'style.css'), 'utf8'));
  const rules = {};
  sheet.walkRules(rule => { if (/channel-|auth-notice/.test(rule.selector) && rule.parent.type === 'root') { rules[rule.selector] = {}; rule.walkDecls(decl => { rules[rule.selector][decl.prop] = decl.value; }); } });
  assert.equal(rules['.channel-card']['min-height'], 'var(--touch-size)');
  assert.match(fs.readFileSync(path.join(source, 'theme.css'), 'utf8'), /--touch-size: 44px;/);
  assert.equal(rules['.channel-options']['grid-template-columns'], 'repeat(2, minmax(0, 1fr))', 'Two cards side by side, down to 375 px');
  assert.ok(Object.keys(rules).some(selector => selector.includes('.auth-notice.is-empty')), 'The empty notice takes no space');
  for (const [selector, declarations] of Object.entries(rules)) {
    assert.ok(!/:has\(/.test(selector), selector);
    for (const value of Object.values(declarations)) assert.ok(!/#[0-9a-f]{3,8}\b|color-mix|oklch/i.test(value), `${selector}: ${value}`);
  }
  let forced = false;
  sheet.walkAtRules('media', rule => { if (rule.params.includes('forced-colors')) rule.walkRules(inner => { if (inner.selector.includes('input:checked + .channel-card')) forced = true; }); });
  assert.ok(forced, 'The chosen card stays visible with forced colors');
  console.log('Recovery styles: theme tokens only, 44 px channel cards, forced colors passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

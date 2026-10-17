// Channel forms from fixtures: WhatsApp saves that cancel queued messages ask first, SMTP drafts are guarded and example placeholders are translated; no browser or API.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const req = require('node:module').createRequire(path.join(__dirname, '../frontend/package.json'));
const React = req('react'), ts = req('typescript');
const source = path.join(__dirname, '../frontend/src');
let states = [], index = 0, refs = [], refIndex = 0, guarded = null;
const hooks = {
  ...React,
  useId: () => 'fixture',
  useEffect() {},
  useState: initial => { const i = index++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
  useRef: initial => { const i = refIndex++; return refs[i] || (refs[i] = {current: initial}); },
};
const ui = {
  Button: ({children, variant, size, ...props}) => React.createElement('button', props, children),
  Card: ({children, ...props}) => React.createElement('section', props, children),
  Notice: ({children}) => React.createElement('p', null, children),
  ConfirmDialog: () => null,
};
// Translated text is marked, so a placeholder that skipped t() shows up bare.
const i18n = {getLocale: () => 'pt-BR', t: (key, args = []) => '«' + key.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)])) + '»'};
let fixture;
const query = {useQueryClient: () => ({setQueryData(key, value) { fixture = value; }, invalidateQueries: async () => {}}), useQuery: () => ({data: fixture})};
function load(file) {
  const out = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(source, file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}}).outputText;
  vm.runInNewContext(code, {exports: out, Intl, require: name =>
    name === 'react' ? hooks : name === './ui' ? ui : name === './i18n' ? i18n : name === '@tanstack/react-query' ? query :
    name === './navigationGuard' ? {useUnsavedChanges: value => { guarded = value; }} :
    name === './WhatsAppReceipts' ? {WhatsAppReceipts: () => null} : name === './PhoneField' ? {PhoneField: () => null} :
    name === './format' ? {formatDateTime: String} : req(name)});
  return out;
}
// The handlers start their request without returning it (void): let it finish.
const settle = () => new Promise(resolve => setImmediate(resolve));
function find(node, predicate, found = []) { if (!node || typeof node !== 'object') return found; if (predicate(node)) found.push(node); for (const child of React.Children.toArray(node.props?.children)) find(child, predicate, found); return found; }

(async () => {
  // WhatsApp: the enabled integration saved off, or with another URL or session, asks before cancelling the queue.
  const {WhatsAppPanel} = load('WhatsAppPanel.tsx');
  const saved = {provider: 'openwa', enabled: true, values: {base_url: 'https://fixture.example.org', session_id: 'fixture-session'}, secrets_set: {token: true}, available: true, providers: [{id: 'openwa', name: 'OpenWA', fields: [{key: 'base_url', label: 'URL do serviço', secret: false, default: '', type: 'url'}, {key: 'session_id', label: 'ID da sessão', secret: false, default: '', type: 'text'}, {key: 'token', label: 'Token da API', secret: true, default: '', type: 'password'}]}]};
  const CONFIRM_SAVE = 10; // useState order: draft, busy, error, message, check, country, phone, consent, confirm, confirmError, confirmSave
  let requests = [];
  const request = async (...args) => { requests.push(args); return {...saved, ...args[1]}; };
  function panel(draft) { index = 0; refIndex = 0; if (draft) states[0] = draft; return WhatsAppPanel({request}); }
  // The confirmations are elements of the panel; their props hold the title and the handlers.
  const dialog = (tree, title) => find(tree, n => n.type === ui.ConfirmDialog && n.props.title === title)[0].props;
  async function submit(draft) { const tree = panel(draft); await find(tree, n => n.type === 'form')[0].props.onSubmit({preventDefault() {}}); }
  for (const [change, draft] of [
    ['a new session', {provider: 'openwa', enabled: true, values: {...saved.values, session_id: 'other-session'}}],
    ['another URL', {provider: 'openwa', enabled: true, values: {...saved.values, base_url: 'https://other.example.org'}}],
    ['switched off', {provider: 'openwa', enabled: false, values: {...saved.values}}],
  ]) {
    states = []; refs = []; fixture = saved; requests = [];
    await submit(draft);
    assert.equal(states[CONFIRM_SAVE], true, `Saving ${change} asks first`);
    assert.equal(requests.length, 0, `Nothing is saved before the confirmation (${change})`);
  }
  // A new token alone keeps the queue: it saves at once.
  states = []; refs = []; fixture = saved; requests = [];
  await submit({provider: 'openwa', enabled: true, values: {...saved.values, token: 'fixture-new-token'}});
  assert.equal(states[CONFIRM_SAVE], false); assert.equal(requests.length, 1); assert.equal(requests[0][2], 'PUT');
  // A disabled integration has no queue to cancel.
  states = []; refs = []; fixture = {...saved, enabled: false}; requests = [];
  await submit({provider: 'openwa', enabled: false, values: {...saved.values, session_id: 'other-session'}});
  assert.equal(states[CONFIRM_SAVE], false); assert.equal(requests.length, 1);
  // Confirming saves; the dialog closes, and the success waits for it to leave.
  states = []; refs = []; fixture = saved; requests = [];
  await submit({provider: 'openwa', enabled: false, values: {...saved.values}});
  const confirmSave = dialog(panel(), '«Salvar e cancelar as mensagens pendentes?»');
  assert.ok(confirmSave.open); assert.equal(confirmSave.confirmLabel, '«Salvar e cancelar pendentes»');
  confirmSave.onConfirm(); await settle();
  assert.equal(requests.length, 1); assert.equal(requests[0][1].enabled, false);
  assert.equal(states[CONFIRM_SAVE], false, 'The dialog closes after saving');
  assert.equal(states[3], '', 'No message while the dialog leaves');
  confirmSave.onClosed();
  assert.equal(states[3], '«Configuração WhatsApp salva. Use Verificar sessão antes do teste.»');
  // A failed save stays in the dialog.
  states = []; refs = []; fixture = saved; requests = [];
  await submit({provider: 'openwa', enabled: false, values: {...saved.values}});
  index = 0; refIndex = 0;
  dialog(WhatsAppPanel({request: async () => { throw Error('Integrador indisponível (fixture)'); }}), '«Salvar e cancelar as mensagens pendentes?»').onConfirm(); await settle();
  assert.equal(states[CONFIRM_SAVE], true, 'The dialog stays open');
  assert.equal(states[9], '«Integrador indisponível (fixture)»', 'The error belongs to the dialog');
  assert.equal(states[2], '', 'Not to the form behind it');
  console.log('WhatsApp saves: switching off or changing URL/session asks before cancelling queued messages; errors stay in the dialog passed.');

  // SMTP: an edited draft is guarded on channel and tab changes; the example placeholders go through t().
  const {SmtpSettings} = load('SmtpSettings.tsx');
  const smtp = {enabled: true, host: 'smtp.example.org', port: 587, security: 'starttls', username: 'radar', sender: 'radar@example.org', recipient: 'admin@example.org', password_set: true};
  function settings(draft) { index = 0; refIndex = 0; if (draft) states[0] = draft; return SmtpSettings({smtp, provider: 'smtp', request: async () => smtp, onChanged: async () => {}}); }
  states = []; refs = [];
  let tree = settings();
  assert.equal(guarded, false, 'The saved configuration is no draft');
  settings({...smtp, password: '', host: 'smtp.other.example.org'});
  assert.equal(guarded, true, 'An edited server asks before leaving');
  settings({...smtp, password: 'fixture-password'});
  assert.equal(guarded, true, 'A typed password asks before leaving');
  states = []; refs = []; tree = settings();
  const placeholders = find(tree, n => n.type === 'input' && typeof n.props.placeholder === 'string').map(n => n.props.placeholder);
  for (const example of ['«smtp.seuprovedor.com»', '«radar@seudominio.com»', '«voce@exemplo.com»']) assert.ok(placeholders.includes(example), `${example} is translated`);
  console.log('SMTP settings: unsaved drafts guarded and translated example placeholders passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

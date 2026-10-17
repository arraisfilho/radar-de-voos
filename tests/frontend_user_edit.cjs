// Editing an account again: the form starts from the account fetched now, never a cached copy, and saving drops that copy; no browser or API.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const req = require('node:module').createRequire(path.join(__dirname, '../frontend/package.json'));
const React = req('react'), ts = req('typescript');
const source = path.join(__dirname, '../frontend/src'), modules = new Map();
let states = [], index = 0, effects = [], effectIndex = 0, lastDeps = [];
const hooks = {
  ...React,
  useId: () => 'fixture',
  useState: initial => { const i = index++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
  // Effects run after the render when their dependencies changed, as in React.
  useEffect: (effect, deps) => {
    const i = effectIndex++, previous = lastDeps[i];
    if (!deps || !previous || deps.some((value, k) => !Object.is(value, previous[k]))) { lastDeps[i] = deps; effects.push(effect); }
  },
};
let account = {};
const removed = [], invalidated = [];
const cache = {removeQueries: ({queryKey}) => removed.push(Array.from(queryKey)), invalidateQueries: async ({queryKey}) => { invalidated.push(Array.from(queryKey)); }};
const query = {useQueryClient: () => cache, useQuery: ({queryKey}) => (queryKey[0] === 'admin-user' ? account : {data: {items: [], total: 0, page_size: 15}}), keepPreviousData: previous => previous};
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const out = {}; modules.set(file, out);
  const code = ts.transpileModule(fs.readFileSync(path.join(source, file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}}).outputText;
  vm.runInNewContext(code, {exports: out, Intl, URLSearchParams, structuredClone, require: name =>
    name.endsWith('.css') ? {} : name === 'react' ? hooks : name === '@tanstack/react-query' ? query : name === './navigationGuard' ? {useUnsavedChanges() {}, afterSave: callback => callback()} :
    name === './i18n' ? {getLocale: () => 'pt-BR', t: (key, args = []) => key.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]))} :
    name.startsWith('./') ? load(name.slice(2) + (fs.existsSync(path.join(source, name.slice(2) + '.tsx')) ? '.tsx' : '.ts')) : req(name)});
  return out;
}
const {AdminUsers} = load('AdminUsers.tsx');
const user = {id: 'fixture', role: 'user', name: 'Cached name', country: 'BR', phone: '+5511987654321', emails: [], whatsapp_use_login: true, whatsapp_country: 'BR', whatsapp_phone: null, telegram_username: '', additional_phones: [], language: 'pt', timezone: 'America/Sao_Paulo', quiet_hours: false, quiet_start: '22:00', quiet_end: '08:00', phone_verified: false, search_limit: 5};
const route = {view: 'admin', section: 'users', userId: 'fixture', userAction: 'edit'};
let sent = null;
function render() { index = 0; effectIndex = 0; effects = []; return AdminUsers({request: async (url, body) => { sent = body; return {...user, ...body}; }, userId: 'admin', route, navigate() {}}); }
const runEffects = () => effects.splice(0).forEach(effect => effect());
function find(node, predicate) { if (!node || typeof node !== 'object') return null; if (predicate(node)) return node; for (const child of React.Children.toArray(node.props?.children)) { const found = find(child, predicate); if (found) return found; } return null; }
const DRAFT = 4; // useState order in AdminUsers: q, filter, page, editing, draft…

(async () => {
  // A copy cached from an earlier visit is shown by the query, but the form waits for the account as fetched now.
  account = {data: user, isFetchedAfterMount: false, isError: false};
  render(); runEffects(); render(); runEffects();
  assert.equal(states[DRAFT], null, 'No form from the cached copy');
  account = {data: {...user, name: 'Fresh name'}, isFetchedAfterMount: true, isError: false};
  render(); runEffects();
  assert.equal(states[DRAFT].name, 'Fresh name', 'The form starts from the account fetched now');
  // A refetch on focus does not overwrite what is being typed.
  states[DRAFT] = {...states[DRAFT], name: 'Typed name'};
  account = {data: {...user, name: 'Refetched name'}, isFetchedAfterMount: true, isError: false};
  render(); runEffects();
  assert.equal(states[DRAFT].name, 'Typed name');
  // A failed refetch never falls back to the cached copy.
  states = []; lastDeps = []; account = {data: user, isFetchedAfterMount: true, isError: true, error: new Error('Fixture failure')};
  render(); runEffects(); render(); runEffects();
  assert.equal(states[DRAFT], null);
  // Saving sends the fresh values and removes the cached account, so the next edit loads it again.
  states = []; lastDeps = []; account = {data: {...user, name: 'Fresh name'}, isFetchedAfterMount: true, isError: false};
  render(); runEffects();
  const form = find(render(), node => node.type === 'form');
  await form.props.onSubmit({preventDefault() {}});
  assert.equal(sent.name, 'Fresh name');
  assert.ok(removed.some(key => key.join() === 'admin-user,fixture'), 'The cached account is dropped after saving');
  console.log('Account edits: form from freshly fetched data only, kept while typing, cache dropped after saving passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

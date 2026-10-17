// Leaner screens from fixtures: the appearance picker and its first-paint script, the unseen alerts badge, return dates,
// the paused trip header, the merged fares and alerts block, the lowest fare under the target and empty alert tiles.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const req = require('node:module').createRequire(path.join(__dirname, '../frontend/package.json'));
const React = req('react'), ts = req('typescript'), {renderToStaticMarkup} = req('react-dom/server');
const source = path.join(__dirname, '../frontend/src');
const t = (key, args = []) => key.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]));
// A document with the head of index.html, as far as the appearance code reads and writes it.
function page(stored, failing = false) {
  const attributes = {}, metas = [{name: 'color-scheme', attrs: {content: 'light dark'}}, {attrs: {media: '(prefers-color-scheme: light)', 'data-scheme': 'light'}}, {attrs: {media: '(prefers-color-scheme: dark)', 'data-scheme': 'dark'}}];
  const element = meta => ({getAttribute: name => meta.attrs[name] ?? null, setAttribute: (name, value) => { meta.attrs[name] = value; }});
  const store = new Map(stored ? [['radar-appearance', stored]] : []);
  const broken = () => { throw Error('storage blocked'); };
  return {
    attributes, metas, store,
    localStorage: failing ? {getItem: broken, setItem: broken, removeItem: broken} : {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key)},
    document: {
      documentElement: {setAttribute: (name, value) => { attributes[name] = value; }, removeAttribute: name => { delete attributes[name]; }},
      querySelector: selector => (selector === 'meta[name="color-scheme"]' ? element(metas[0]) : null),
      querySelectorAll: () => metas.slice(1).map(element),
    },
  };
}
function load(file, context = {}, stubs = {}) {
  const out = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(source, file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}}).outputText;
  vm.runInNewContext(code, {exports: out, Intl, Date, ...context, require: name => {
    if (name.endsWith('.css')) return {};
    if (name in stubs) return stubs[name];
    if (name === './i18n') return {t, getLocale: () => 'pt-BR', useLanguage: () => 'pt', getLanguage: () => 'pt'};
    if (name.startsWith('./')) return load(name.slice(2) + (fs.existsSync(path.join(source, name.slice(2) + '.tsx')) ? '.tsx' : '.ts'), context, stubs);
    return req(name);
  }});
  return out;
}

// ---------- Appearance: saved on the device, applied before the first paint ----------------------------------------------
const html = fs.readFileSync(path.join(source, '../index.html'), 'utf8');
const boot = html.match(/<script>([^<]*radar-appearance[^<]*)<\/script>/)[1];
for (const [stored, theme, scheme, lightMedia, darkMedia] of [['dark', 'dark', 'dark', 'not all', 'all'], ['light', 'light', 'light', 'all', 'not all'], [null, undefined, 'light dark', '(prefers-color-scheme: light)', '(prefers-color-scheme: dark)'], ['purple', undefined, 'light dark', '(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']]) {
  const doc = page(stored);
  vm.runInNewContext(boot, {localStorage: doc.localStorage, document: doc.document});
  assert.deepEqual([doc.attributes['data-theme'], doc.metas[0].attrs.content, doc.metas[1].attrs.media, doc.metas[2].attrs.media], [theme, scheme, lightMedia, darkMedia], `Boot with ${stored}`);
}
assert.doesNotThrow(() => vm.runInNewContext(boot, page('dark', true)), 'Blocked storage: the device appearance, no error');
let doc = page(null);
const appearance = load('appearance.ts', {localStorage: doc.localStorage, document: doc.document, window: {addEventListener() {}}});
assert.equal(appearance.getAppearance(), 'system');
appearance.setAppearance('dark');
assert.deepEqual([doc.store.get('radar-appearance'), doc.attributes['data-theme'], doc.metas[0].attrs.content, doc.metas[2].attrs.media], ['dark', 'dark', 'dark', 'all']);
appearance.setAppearance('system');
assert.deepEqual([doc.store.has('radar-appearance'), doc.attributes['data-theme'], doc.metas[0].attrs.content, doc.metas[1].attrs.media], [false, undefined, 'light dark', '(prefers-color-scheme: light)'], 'Sistema: nothing saved, the device decides');
doc = page('light', true);
const blocked = load('appearance.ts', {localStorage: doc.localStorage, document: doc.document, window: {addEventListener() {}}});
assert.equal(blocked.getAppearance(), 'system'); assert.doesNotThrow(() => blocked.setAppearance('light')); assert.equal(doc.attributes['data-theme'], 'light', 'Applied for this visit without storage');
const picker = renderToStaticMarkup(React.createElement(load('AppearancePicker.tsx', {window: undefined}).AppearancePicker, {labeled: true}));
assert.ok(picker.includes('Aparência') && /<option value="system" selected="">Sistema<\/option><option value="light">Claro<\/option><option value="dark">Escuro<\/option>/.test(picker), 'Sistema, Claro, Escuro; Sistema by default');
for (const file of ['App.tsx', 'Profile.tsx', 'SignIn.tsx', 'Accounts.tsx', 'RecoveryForm.tsx'])
  assert.match(fs.readFileSync(path.join(source, file), 'utf8'), /<LanguagePicker[^>]*\/>\s*\n?\s*(<\/div>\s*<div className="list-row">\s*)?<AppearancePicker/, `${file}: beside the language`);
console.log('Appearance: Sistema, Claro or Escuro saved on the device, applied by the head script before the first paint, beside every language picker passed.');

// ---------- "Alertas" counts only what arrived after the last visit on this device ---------------------------------------
const store = new Map();
const seen = load('alertsSeen.ts', {localStorage: {getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value)}});
assert.equal(seen.unseenAlerts([300, 200, 100], null), 0, 'A first visit on the device starts from now');
seen.markAlertsSeen('u1', 150);
assert.equal(seen.alertsSeenAt('u1'), 150); assert.equal(seen.unseenAlerts([300, 200, 100], 150), 2);
seen.markAlertsSeen('u1', 120); assert.equal(seen.alertsSeenAt('u1'), 150, 'Never back in time');
assert.equal(seen.alertsSeenAt('u2'), null, 'Per account');
const brokenSeen = load('alertsSeen.ts', {localStorage: {getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }}});
brokenSeen.markAlertsSeen('u1', 500); assert.equal(brokenSeen.alertsSeenAt('u1'), 500, 'Kept in memory without storage');
console.log('Alerts badge: unseen since the last visit, per account and device, never back in time passed.');

// ---------- Return dates ------------------------------------------------------------------------------------------------
const {impossibleReturns} = load('searchJourney.ts');
const window = (start, end) => ({start: start + 'T00:00', end: end + 'T23:59'});
assert.deepEqual({...impossibleReturns({outbound: window('2090-11-05', '2090-11-11'), inbound: window('2090-11-09', '2090-11-09')})}, {impossible: 2, total: 7}, 'Outbound on the 10th and 11th, return on the 9th');
assert.deepEqual({...impossibleReturns({outbound: window('2090-11-05', '2090-11-06'), inbound: window('2090-11-09', '2090-11-10')})}, {impossible: 0, total: 4});
assert.deepEqual({...impossibleReturns({outbound: window('2090-11-05', '2090-11-06'), inbound: null})}, {impossible: 0, total: 0});
console.log('Return dates: impossible date pairs counted for the warning passed.');

// ---------- Trip header: about 120 px, Retomar in sight for a paused trip -----------------------------------------------
const ui = {Button: ({children, variant, size, ...props}) => React.createElement('button', {...props, 'data-variant': variant || 'primary'}, children), Card: ({children, className}) => React.createElement('section', {className: 'card ' + className}, children), ContextMenu: ({children}) => React.createElement('div', {role: 'menu'}, children)};
const heroStubs = {'./ui': ui, './LiveStatus': {LiveStatus: ({search}) => React.createElement('span', null, search.active ? 'Ao vivo' : 'Pausado'), CollectionNotice: () => null}, './RouteSummary': {RouteCodes: () => React.createElement('span', null, 'THE → GRU'), RoutePlaces: () => null}, './navigation': {plainClick: () => true, routePath: () => '/'}};
const {TripHero} = load('TripHero.tsx', {}, heroStubs);
const leg = {start: '2090-11-05T00:00', end: '2090-11-06T23:59', arrival_before: null, stops: [0, 1, 2], max_duration: null, max_layover: null, airlines: []};
const config = {name: 'Fixture', origins: ['THE'], destinations: ['GRU'], outbound: leg, inbound: null, adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0, cabin: 'economy', currency: 'BRL', target_cents: null, min_drop_cents: 5000, notify_email: false, notify_whatsapp: true};
const hero = (search, ended = false) => renderToStaticMarkup(React.createElement(TripHero, {search: {id: 'trip', active: 1, ends_at: 4e9, config, ...search}, airports: [], routes: [], serverTime: 1, serverNow: 1, updatedAt: 1, connectionError: false, ended, busy: false, onEdit() {}, onAlerts() {}, onToggle() {}, onEnd() {}, onDelete() {}, onRestore() {}}));
let markup = hero({active: 0});
assert.match(markup, /<button data-variant="primary">.*?Retomar<\/button>/, 'Paused: Retomar as the visible main action');
assert.ok(!markup.includes('Retomar monitoramento') && !markup.includes('Pausar monitoramento') && markup.includes('Editar viagem'), 'Editing moves to the menu; no second resume');
markup = hero({});
assert.ok(markup.includes('Editar') && markup.includes('Pausar monitoramento') && !/>Retomar</.test(markup));
assert.ok(markup.indexOf('trip-hero-top') < markup.indexOf('trip-hero-meta') && markup.includes('trip-hero-facts') && !markup.includes('info-chip'), 'Route and actions, then one line of plain details');
// Phones: the cities on one line (airports in the tooltip), the title as the trip selector, "Editar" named for the icon.
const airportsList = [{code: 'THE', city: 'Teresina', name: 'Senador Petrônio Portella Airport', label: 'Senador Petrônio Portella', country: 'BR', timezone: 'America/Fortaleza'}, {code: 'GRU', city: 'São Paulo', name: 'Guarulhos International Airport', label: 'Guarulhos', country: 'BR', timezone: 'America/Sao_Paulo'}];
markup = renderToStaticMarkup(React.createElement(TripHero, {search: {id: 'trip', active: 1, ends_at: 4e9, config}, airports: airportsList, routes: [], serverTime: 1, serverNow: 1, updatedAt: 1, connectionError: false, ended: false, busy: false, onEdit() {}, onAlerts() {}, onToggle() {}, onEnd() {}, onDelete() {}, onRestore() {}, switcher: {value: 'trip', onChange() {}, options: [React.createElement('option', {key: 'a', value: 'trip'}, 'THE → GRU'), React.createElement('option', {key: 'b', value: 'other'}, 'GRU → MDE')]}}));
assert.match(markup, /<p class="trip-hero-cities" title="Teresina · Senador Petrônio Portella → São Paulo · Guarulhos">Teresina → São Paulo<\/p>/);
assert.match(markup, /<select class="trip-hero-switch" aria-label="Trocar de viagem">.*GRU → MDE/);
assert.match(markup, /<button[^>]*aria-label="Editar viagem"[^>]*>.*<span class="trip-hero-edit-label">Editar<\/span>/);
assert.ok(!hero({}).includes('trip-hero-switch"'), 'One trip: no selector');
markup = hero({active: 0}, true);
assert.equal((markup.match(/Histórico preservado/g) || []).length, 1, 'Ended: said once, in the header');
console.log('Trip header: route and actions on one row, details on one line, Retomar for a paused trip, ended said once passed.');

// ---------- Lowest fare under the target ---------------------------------------------------------------------------------
const formStubs = {'./ui': ui, './currency': {currencies: ['BRL'], currencyLabel: () => 'BRL'}, './DatePicker': {DatePicker: () => null}, './AirportPicker': {AirportPicker: () => null}, './AirlinePicker': {AirlinePicker: () => null}, './RouteSummary': {RouteCodes: () => null, RoutePlaces: () => null}, './navigation': {routePath: () => '/perfil', plainClick: () => false}, './tripSummary': {legDates: leg => leg.start}, './InfoTip': {InfoTip: () => null}};
const {SearchForm} = load('SearchForm.tsx', {requestAnimationFrame: callback => callback()}, formStubs);
const form = props => renderToStaticMarkup(React.createElement(SearchForm, {config: {...config, inbound: {...leg, start: '2090-11-09T00:00', end: '2090-11-09T23:59'}}, setConfig() {}, airports: [], onSave() {}, saving: false, alertsOnly: true, ...props}));
markup = form({lowest: {outbound: 194800, inbound: 99000}});
assert.match(markup, /Menor preço agora: Ida R\$\s1\.948 · Volta R\$\s990/); assert.match(markup, /aria-describedby="[^"]*-now"/);
assert.ok(!form({}).includes('Menor preço agora'), 'Nothing to show for a new trip');
markup = renderToStaticMarkup(React.createElement(SearchForm, {config: {...config, outbound: {...leg, end: '2090-11-11T23:59'}, inbound: {...leg, start: '2090-11-09T00:00', end: '2090-11-09T23:59'}}, setConfig() {}, airports: [], onSave() {}, saving: false, general: true, journey: {step: 2, direction: 'outbound', onChange() {}}}));
assert.ok(markup.includes('Em 2 de 7 combinações de datas, a volta é antes da ida.'), 'The review warns about impossible pairs');
console.log('Alert settings: the lowest fare now under the target; the review warns about returns before the outbound passed.');

// ---------- Alert center: no empty tiles ---------------------------------------------------------------------------------
let totals = {};
const activityStubs = {'@tanstack/react-query': {useQuery: () => ({data: {items: [], totals, has_more: false}, isLoading: false, isError: false})}, './ui': ui, './tripSummary': {tripTitle: () => ({title: 'Fixture'})}};
const {Activity} = load('Activity.tsx', {}, activityStubs);
const center = () => renderToStaticMarkup(React.createElement(Activity, {searches: [], serverNow: 1, onOpenTrip() {}, onManageContacts() {}}));
assert.ok(!center().includes('activity-summary'), 'No alerts yet: no blocks');
totals = {queued: 2, held: 2};
assert.ok(!center().includes('<span>Enviando</span>'), 'Held alerts are not "Enviando"');
totals = {sent: 3, expired: 1};
markup = center();
assert.ok(markup.includes('Enviados') && markup.includes('Com problema') && !markup.includes('<span>Enviando</span>'), 'Only blocks with alerts');
assert.ok(!markup.includes('Aceito') && !markup.includes('Exigem atenção'));
console.log('Alert center: summary blocks only with alerts, in the chips\' words passed.');

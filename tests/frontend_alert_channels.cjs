// Alert channels from fixtures: WhatsApp first, the "Você será avisado por" line, new-trip defaults, the number typed in
// the review, focus on a new contact field, the sign-up time zone and the device zone in the profile; no browser or API.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const req = require('node:module').createRequire(path.join(__dirname, '../frontend/package.json'));
const React = req('react'), ts = req('typescript'), {renderToStaticMarkup} = req('react-dom/server');
const source = path.join(__dirname, '../frontend/src');
// Hooks keep their values by call order, as React does for one mounted component; effects are collected to run by hand.
let states = [], refs = [], index = 0, refIndex = 0, effects = [];
const begin = () => { index = 0; refIndex = 0; effects = []; };
const remount = () => { states = []; refs = []; begin(); };
const hooks = {
  ...React,
  useId: () => 'fixture',
  useState(initial) { const i = index++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
  useRef(initial) { const i = refIndex++; return refs[i] || (refs[i] = {current: initial}); },
  useEffect(effect) { effects.push(effect); },
  useLayoutEffect() {},
};
const t = (key, args = []) => key.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]));
const Button = ({children, variant, size, ...props}) => React.createElement('button', props, children);
let api = null, device = 'America/Araguaina', zoneField = null;
class HTMLInputElement {}
// The device's time zone is the fixture's; dates still format as usual.
const FakeIntl = Object.create(Intl, {DateTimeFormat: {value: function (...args) {
  const real = new Intl.DateTimeFormat(...args);
  return {format: date => real.format(date), formatToParts: date => real.formatToParts(date), resolvedOptions: () => ({...real.resolvedOptions(), timeZone: device})};
}}});
const stubs = {
  './i18n': {t, getLocale: () => 'pt-BR', getLanguage: () => 'pt'},
  './ui': {Button, Card: ({children}) => React.createElement('section', null, children), Notice: ({children}) => React.createElement('p', null, children)},
  './currency': {currencies: ['BRL'], currencyLabel: () => 'BRL'},
  './DatePicker': {DatePicker: () => null},
  './AirportPicker': {AirportPicker: () => null},
  './AirlinePicker': {AirlinePicker: () => null},
  './RouteSummary': {RouteCodes: () => null, RoutePlaces: () => null},
  './navigation': {routePath: () => '/perfil', plainClick: () => true},
  './tripSummary': {legDates: leg => leg.start},
  './InfoTip': {InfoTip: ({label}) => React.createElement('button', {type: 'button', 'aria-label': label})},
  './PhoneField': {PhoneField: () => null},
  './PasswordField': {PasswordField: () => null},
  './CodeField': {CodeField: () => null},
  // The legends only, to check the order of the contact blocks.
  './EmailFields': {EmailFields: ({label}) => React.createElement('legend', null, label)},
  './AdditionalPhones': {AdditionalPhones: ({label}) => React.createElement('legend', null, label)},
  './LanguagePicker': {LanguagePicker: () => null},
  './SystemVersion': {SystemVersion: () => null},
  './AppIcon': {AppIcon: () => null},
  './Avatar': {Avatar: () => null},
  './pageTitle': {usePageTitle() {}},
  './navigationGuard': {useUnsavedChanges() {}},
  './TimeZoneField': {TimeZoneField: props => { zoneField = props; return null; }, validTimeZone: () => true},
  './AuditPanel': {AuditPanel: () => null},
  './authApi': {api: async (path, token, body) => { api = {path, body}; return {id: 'customer-1'}; }, errorStatus: () => undefined},
  '@tanstack/react-query': {useQueryClient: () => ({clear() {}})},
};
const modules = new Map();
function load(file, own = {}) {
  const key = file + JSON.stringify(Object.keys(own));
  if (modules.has(key)) return modules.get(key);
  const out = {};
  modules.set(key, out);
  const code = ts.transpileModule(fs.readFileSync(path.join(source, file), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}}).outputText;
  vm.runInNewContext(code, {exports: out, Intl: FakeIntl, Date, structuredClone, HTMLInputElement, requestAnimationFrame: callback => callback(),
    document: {getElementById: () => null},
    require: name => {
      if (name.endsWith('.css')) return {};
      if (name in own) return own[name];
      if (name === 'react') return hooks;
      if (name in stubs) return stubs[name];
      if (name.startsWith('./')) return load(name.slice(2) + (fs.existsSync(path.join(source, name.slice(2) + '.tsx')) ? '.tsx' : '.ts'));
      return req(name);
    }});
  return out;
}
function all(tree, test, found = []) {
  if (Array.isArray(tree)) { tree.forEach(item => all(item, test, found)); return found; }
  if (!tree || typeof tree !== 'object') return found;
  if (test(tree)) found.push(tree);
  all(tree.props?.children, test, found);
  if (tree.props?.action) all(tree.props.action, test, found);
  return found;
}
const text = node => (typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '');

const settle = () => new Promise(resolve => setImmediate(resolve));
// The visible part of a masked number: without the text for screen readers.
const visible = markup => markup.replace(/<span class="sr-only">.*?<\/span>/g, '').replace(/<[^>]+>/g, '');

// ---------- Masked numbers and the summary line ------------------------------------------------------------------------
const {maskPhone, ChannelSummary} = load('AlertChannels.tsx');
// By the count of digits, for any country: the last 4 and all but 8 at the start stay.
assert.equal(maskPhone('+55 63 99999 9260'), '+55 63 9···· 9260');
assert.equal(maskPhone('+1 202 555 0123'), '+1 20· ··· 0123');
assert.equal(maskPhone('+44 20 7946 0018'), '+44 20 ···· 0018');
assert.equal(maskPhone('+351 912 345 678'), '+351 9·· ··5 678');
let html = renderToStaticMarkup(React.createElement(ChannelSummary, {whatsapp: ['+55 63 99999 9260', '+55 11 98765 4321'], email: ['a@example.org']}));
assert.ok(html.includes('<span aria-hidden="true">+55 63 9···· 9260</span><span class="sr-only">terminado em 9260</span> e mais 1'), 'Dots for the eyes, the last digits for screen readers, "e mais 1"');
assert.ok(html.indexOf('Você será avisado por:') < html.indexOf('9260') && html.indexOf('9260') < html.indexOf('a@example.org'), 'WhatsApp first, then e-mail');
assert.ok(renderToStaticMarkup(React.createElement(ChannelSummary, {whatsapp: [], email: []})).includes('Somente no painel'));
html = renderToStaticMarkup(React.createElement(ChannelSummary, {compact: true, whatsapp: ['+55 63 99999 9260'], email: ['a@example.org']}));
assert.ok(html.includes('title="WhatsApp"') && html.includes('title="E-mail"') && !html.includes('a@example.org') && html.indexOf('WhatsApp') < html.indexOf('E-mail'), 'Compact: icons only, names kept');
assert.ok(renderToStaticMarkup(React.createElement(ChannelSummary, {compact: true, whatsapp: [], email: []})).includes('Somente no painel'));
console.log('Alert channels: numbers masked by their digit count, read as their last digits, WhatsApp before e-mail, the review line and the compact icons passed.');

// ---------- The trip form: new trips start with WhatsApp where it can send ---------------------------------------------
const {SearchForm} = load('SearchForm.tsx');
const leg = {start: '2090-11-05T22:00', end: '2090-11-06T06:00', arrival_before: null, stops: [0, 1, 2], max_duration: 1440, max_layover: null, airlines: []};
const base = {name: 'Fixture', origins: ['THE'], destinations: ['GRU'], outbound: leg, inbound: null, adults: 1, children: 0, infants_in_seat: 0, infants_on_lap: 0, cabin: 'economy', checked_bags: 0, currency: 'BRL', language: 'pt', min_drop_cents: 5000, target_cents: null, notify_email: false, notify_whatsapp: true};
let config, saved, numberSaved;
const formRef = {current: {reportValidity: () => true, querySelector: () => null}};
function form(props = {}, value = base) {
  remount(); config = structuredClone(value); saved = null;
  refs[1] = formRef;
  const all_ = {airports: [], saving: false, general: true, journey: {step: 2, direction: 'outbound', onChange() {}}, ...props};
  const draw = () => { begin(); return SearchForm({...all_, config, setConfig: next => { config = next; }, onSave: (next, reviewed, number) => { saved = next; numberSaved = !!number; }}); };
  return {draw, submit: () => draw().props.onSubmit({preventDefault() {}}), markup: () => { begin(); refs[1] = formRef; return renderToStaticMarkup(React.createElement(SearchForm, {...all_, config, setConfig() {}, onSave() {}})); }};
}
const switches = markup => [...markup.matchAll(/<span class="channel-name" id="[^"]*">([^<]+)<\/span><small[^>]*>(.*?)<\/small><\/label><input([^>]*)>/g)].map(m => ({name: m[1], detail: visible(m[2]), checked: m[3].includes('checked=""'), disabled: m[3].includes('disabled=""')}));
const numberField = tree => all(tree, node => typeof node.props?.value === 'object' && node.props.value && 'busy' in node.props.value)[0];
const whatsappSwitch = tree => all(tree, node => node.props?.label === 'WhatsApp' && 'checked' in node.props)[0];
// WhatsApp unavailable on the instance: off, short status, nothing else; the trip is created without it.
let trip = form({whatsappAvailable: false, emailAvailable: true, emailRecipients: []});
html = trip.markup();
let rows = switches(html);
assert.deepEqual(rows.map(r => r.name), ['WhatsApp', 'E-mail'], 'WhatsApp first; Telegram is gone');
assert.deepEqual([rows[0].checked, rows[0].disabled, rows[0].detail], [false, true, 'Indisponível']);
assert.ok(html.includes('Somente no painel') && !html.includes('Telegram') && !html.includes('Em breve'));
trip.submit(); assert.equal(saved.notify_whatsapp, false);
// Available with numbers: on; every number formatted (an extra one comes raw), once, masked; the trip keeps WhatsApp.
trip = form({whatsappAvailable: true, whatsappRecipients: ['+55 63 99999-9260', '+5563999999260', '+5511987654321'], emailRecipients: ['a@example.org']});
html = trip.markup(); rows = switches(html);
assert.deepEqual([rows[0].checked, rows[0].detail], [true, '+55 63 9···· 9260, +55 11 9···· 4321']);
assert.ok(/Você será avisado por:.*\+55 63 9···· 9260/.test(html) && !/channel-target-to">a@example.org/.test(html), 'E-mail stays off until chosen');
trip.submit(); assert.equal(saved.notify_whatsapp, true);
// A saved trip keeps its choice: on and unavailable, the switch shows it and saving asks to turn it off.
trip = form({whatsappAvailable: false, editing: true}, {...base, notify_whatsapp: true});
rows = switches(trip.markup()); assert.deepEqual([rows[0].checked, rows[0].disabled], [true, false]);
trip.submit(); assert.equal(saved, null); assert.ok(states[2].includes('canal disponível'));
// A saved e-mail-only trip stays e-mail only, edited in the assistant or in its alert settings.
for (const props of [{editing: true}, {general: false, alertsOnly: true, journey: undefined}]) {
  trip = form({...props, whatsappAvailable: true, whatsappRecipients: ['+55 63 99999-9260'], emailRecipients: ['a@example.org']}, {...base, notify_email: true, notify_whatsapp: false});
  trip.submit();
  assert.deepEqual([saved.notify_email, saved.notify_whatsapp], [true, false], JSON.stringify(Object.keys(props)));
}
// A restored draft with a return chosen on purpose is never moved; the default return may be.
trip = form({}, {...base, inbound: {...leg, start: '2090-11-06T00:00', end: '2090-11-06T23:59'}}); trip.draw(); assert.equal(refs[0].current, true, 'A chosen return counts as touched');
trip = form({}, {...base, inbound: {...leg, start: '2090-11-10T00:00', end: '2090-11-10T23:59'}}); trip.draw(); assert.equal(refs[0].current, false, 'The default return stays free to follow the outbound');
console.log('Trip form: WhatsApp on for new trips where it can send, off and "Indisponível" otherwise, saved trips unchanged, restored returns kept passed.');

// ---------- The number typed in the review ------------------------------------------------------------------------------
(async () => {
  let sent = [], failure = null;
  const saveWhatsapp = async (country, phone) => { sent.push([country, phone]); if (failure) throw Error(failure); };
  const review = () => form({whatsappAvailable: true, whatsappRecipients: [], onSaveWhatsapp: saveWhatsapp, defaultCountry: 'BR'});
  // Left empty: panel only.
  trip = review();
  assert.ok(numberField(trip.draw()), 'The WhatsApp row carries the number field');
  assert.ok(trip.markup().includes('Somente no painel'));
  trip.submit(); assert.equal(saved.notify_whatsapp, false); assert.deepEqual(sent, []); assert.equal(numberSaved, false);
  // Typed and not saved: shown in the line, saved to the profile when the trip is created, then the trip with WhatsApp.
  trip = review();
  numberField(trip.draw()).props.onChange({...numberField(trip.draw()).props.value, phone: '63999999260'});
  assert.ok(/Você será avisado por:.*\+55 63 9···· 9260/.test(trip.markup()), 'The line shows the number about to be saved');
  trip.submit(); assert.equal(saved, null, 'Not before the number is saved');
  await settle();
  assert.deepEqual(sent, [['BR', '63999999260']]); assert.equal(saved.notify_whatsapp, true);
  assert.equal(numberSaved, true, 'The page is told the number was saved, for an error creating the trip');
  const {creationFailure} = load('contacts.ts');
  assert.equal(creationFailure('Limite de buscas atingido.', true), 'O número de WhatsApp foi salvo no perfil, mas a viagem não foi criada: Limite de buscas atingido.');
  assert.equal(creationFailure('Limite de buscas atingido.', false), 'Limite de buscas atingido.', 'Other failures keep their message');
  // Back a stage and here again: the number is still there (the form keeps it).
  trip = review();
  numberField(trip.draw()).props.onChange({...numberField(trip.draw()).props.value, phone: '6399999'});
  assert.equal(numberField(trip.draw()).props.value.phone, '6399999', 'Kept by the form, not by the field');
  // An impossible number stops the creation, with the error at the field.
  sent = []; trip.submit(); await settle();
  assert.equal(saved, null); assert.deepEqual(sent, []); assert.ok(states[4].error.includes('Confira o código de área'));
  assert.ok(numberField(trip.draw()).props.value.error, 'Shown next to the number');
  // The profile refuses it: the error stays at the field and nothing is created.
  numberField(trip.draw()).props.onChange({...states[4], phone: '63999999260'});
  failure = 'Informe um telefone válido'; trip.submit(); await settle(); failure = null;
  assert.equal(saved, null); assert.equal(states[4].error, 'Informe um telefone válido'); assert.equal(states[4].busy, false);
  // Switched off and on again: the switch never locks and the typed number comes back.
  trip = review(); sent = [];
  numberField(trip.draw()).props.onChange({...numberField(trip.draw()).props.value, phone: '63999999260'});
  whatsappSwitch(trip.draw()).props.onChange(false);
  let rows = switches(trip.markup());
  assert.deepEqual([rows[0].checked, rows[0].disabled], [false, false], 'Off, and it can be turned on again');
  assert.equal(numberField(trip.draw()), undefined, 'The field hides with the switch off');
  trip.submit(); assert.equal(saved.notify_whatsapp, false); assert.equal(sent.length, 0, 'Off: the number is not saved');
  whatsappSwitch(trip.draw()).props.onChange(true);
  assert.equal(numberField(trip.draw()).props.value.phone, '63999999260', 'The number typed before is kept');
  console.log('Review number: kept across stages and the switch, saved before the trip is created, invalid or refused numbers stop it at the field, empty means panel only passed.');

  // ---------- The number field itself -----------------------------------------------------------------------------------
  const {WhatsAppNumber} = load('WhatsAppNumber.tsx');
  let value = {country: 'BR', phone: '', error: 'Old error', busy: false}, saves = 0;
  const field = () => WhatsAppNumber({value, onChange: next => { value = next; }, onSave: () => { saves++; }});
  const phoneField = all(field(), node => node.props?.label === 'Número do WhatsApp')[0];
  assert.equal(phoneField.props.required, false, 'An empty number is a valid choice');
  phoneField.props.onChange('BR', '63999999260'); assert.deepEqual({...value}, {country: 'BR', phone: '63999999260', error: '', busy: false});
  let prevented = false;
  field().props.onKeyDown({key: 'Enter', target: new HTMLInputElement(), preventDefault() { prevented = true; }});
  assert.ok(prevented && saves === 1, 'Enter saves the number, never the trip');
  value = {...value, busy: true}; field().props.onKeyDown({key: 'Enter', target: new HTMLInputElement(), preventDefault() {}}); assert.equal(saves, 1);
  console.log('Number field: not required, Enter saves the number only once at a time passed.');

  // ---------- Saving only the number keeps the rest of the profile ------------------------------------------------------
  const {whatsappNumberBody} = load('contacts.ts');
  const account = {name: 'Customer fixture', emails: ['a@example.org'], additional_phones: [{country: 'BR', phone: '+5511987654321'}], telegram_username: '', timezone: 'America/Araguaina', quiet_hours: true, quiet_start: '23:00', quiet_end: '07:00', whatsapp_use_login: true, whatsapp_country: 'BR', whatsapp_phone: '+5563999999260'};
  assert.deepEqual(JSON.parse(JSON.stringify(whatsappNumberBody(account, 'BR', '63988887777'))), {...account, whatsapp_use_login: false, whatsapp_country: 'BR', whatsapp_phone: '63988887777'});
  console.log('Number body: extra phones, quiet hours and time zone kept passed.');

  // ---------- "Adicionar" moves the focus to the new field --------------------------------------------------------------
  for (const [file, name, added, type] of [['EmailFields.tsx', 'EmailFields', 'Adicionar outro e-mail', 'email'], ['AdditionalPhones.tsx', 'AdditionalPhones', 'Adicionar telefone', 'tel']]) {
    const component = load(file)[name];
    let values = type === 'email' ? ['a@example.org'] : [{country: 'BR', phone: '63999999260'}], focused = null;
    remount();
    const draw = () => { begin(); return component({values, onChange: next => { values = next; }}); };
    let fields = draw();
    effects.forEach(effect => effect());
    all(fields, node => node.type === Button && text(node).includes(added))[0].props.onClick();
    refs[0].current = {querySelectorAll: selector => (selector.includes(type) ? [{focus() { focused = 'first'; }}, {focus() { focused = 'new'; }}] : [])};
    fields = draw(); effects.forEach(effect => effect());
    assert.equal(focused, 'new', `${name}: the new field takes the focus`);
    focused = null; draw(); effects.forEach(effect => effect());
    assert.equal(focused, null, `${name}: only right after adding`);
  }
  console.log('Contact fields: the new e-mail or phone field takes the focus passed.');

  // ---------- Sign-up sends this device's time zone ---------------------------------------------------------------------
  const {SignIn} = load('SignIn.tsx');
  const session = {user: null, token: 'fixture', can_bootstrap: false, registration_open: true};
  for (const [mode, expected] of [['register', 'America/Araguaina'], ['login', undefined]]) {
    remount(); states[2] = mode; api = null;
    const signIn = SignIn({session, onSignedIn() {}, onRecover() {}});
    await all(signIn, node => node.type === 'form')[0].props.onSubmit({preventDefault() {}});
    assert.equal(api.body.timezone, expected, `${mode}: time zone ${expected || 'not sent'}`);
  }
  console.log('Sign-up: the device time zone goes with a new account, never with a login passed.');

  // ---------- Profile: WhatsApp first; the device shortcut names the zone for an account on UTC --------------------------
  const {Profile} = load('Profile.tsx');
  const user = {id: 'customer-1', name: 'Customer fixture', role: 'user', phone: '+5563999999260', phone_display: '+55 63 99999-9260', country: 'BR', emails: [], additional_phones: [], whatsapp_use_login: true, whatsapp_country: 'BR', whatsapp_phone: '+5563999999260', telegram_username: '', language: 'pt', timezone: 'UTC', quiet_hours: false, quiet_start: '22:00', quiet_end: '08:00', phone_verified: false};
  const profile = (account = user) => { remount(); return renderToStaticMarkup(React.createElement(Profile, {user: account, token: 'fixture', onSaved: async () => {}, onLogout: async () => {}, onNotice() {}})); };
  html = profile();
  const contacts = html.slice(html.indexOf('profile-contacts'));
  assert.ok(contacts.indexOf('WhatsApp') >= 0 && contacts.indexOf('WhatsApp') < contacts.indexOf('Outros números de WhatsApp') && contacts.indexOf('Outros números de WhatsApp') < contacts.indexOf('E-mails de alerta'), 'WhatsApp before e-mail');
  assert.ok(!html.includes('Ative o WhatsApp nos alertas') && html.includes('aria-label="Sobre os contatos de alerta"'), 'Help behind the info button');
  assert.ok(!html.includes('Usar fuso deste aparelho'), 'No second button: the field\'s own shortcut is used');
  assert.equal(zoneField.suggest, true); profile({...user, timezone: 'America/Sao_Paulo'}); assert.equal(zoneField.suggest, false);
  const {TimeZoneField} = load('TimeZoneField.tsx');
  let zone = 'UTC';
  const shortcut = props => { begin(); return all(TimeZoneField({value: zone, onChange: next => { zone = next; }, ...props}), node => node.type === Button)[0]; };
  assert.equal(text(shortcut({suggest: true})), 'Usar fuso deste aparelho (America/Araguaina)');
  shortcut({suggest: true}).props.onClick(); assert.equal(zone, 'America/Araguaina', 'One tap fills the zone; saving stays with the person');
  assert.equal(text(shortcut({suggest: true})), 'Usar fuso do dispositivo');
  zone = 'UTC'; assert.equal(text(shortcut({})), 'Usar fuso do dispositivo', 'Other screens keep the plain shortcut');
  device = 'UTC'; assert.equal(text(shortcut({suggest: true})), 'Usar fuso do dispositivo'); device = 'America/Araguaina';
  console.log('Profile: WhatsApp before e-mail, help behind an info button, the device shortcut names the zone only from UTC passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });

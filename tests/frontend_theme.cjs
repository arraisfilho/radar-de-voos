// Contrast and palette coverage across both appearances, independent of an account.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const req = require('node:module').createRequire(path.join(__dirname, '../frontend/package.json'));
const postcss = req('postcss'), directory = path.join(__dirname, '../frontend/src');
const theme = postcss.parse(fs.readFileSync(path.join(directory, 'theme.css'), 'utf8'));
// Light: the base :root. Dark: the base plus :root[data-theme="dark"] (the appearance picker), which
// must equal the device's dark block, :root:not([data-theme="light"]) in prefers-color-scheme: dark.
function rules(selector, media = null) {
  const found = [];
  theme.walkRules(rule => {
    const inside = rule.parent.type === 'atrule' ? rule.parent.params : null;
    if (rule.selector === selector && inside === media) found.push(Object.fromEntries(rule.nodes.filter(n => n.type === 'decl').map(d => [d.prop, d.value])));
  });
  return found;
}
function palette(dark) {
  return {...rules(':root')[0], ...(dark ? rules(':root[data-theme="dark"]')[0] : {})};
}
{
  const chosen = rules(':root[data-theme="dark"]'), device = rules(':root:not([data-theme="light"])', '(prefers-color-scheme: dark)');
  assert.equal(chosen.length, 1); assert.equal(device.length, 1);
  assert.deepEqual(chosen[0], device[0], 'The dark appearance and the device dark mode carry the same tokens');
  assert.deepEqual(rules(':root[data-theme="light"]'), [{'color-scheme': 'light'}], 'Claro keeps the light tokens and says so to the browser');
  assert.equal(rules(':root', '(prefers-color-scheme: dark)').length, 0, 'No dark block the picker cannot turn off');
  for (const tone of ['green', 'red', 'amber', 'gray']) for (const part of ['text', 'bg']) assert.ok(`--status-${tone}-${part}` in chosen[0], `Dark --status-${tone}-${part}`);
}
function luminance(hex) {
  const channels = hex.slice(1).match(/../g).slice(0, 3).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
for (const dark of [false, true]) {
  const colors = palette(dark);
  const pairs = [
    ['--text', '--page'], ['--text', '--surface'], ['--muted', '--surface'], ['--muted', '--page'],
    ['--primary', '--surface'], ['--primary', '--surface-tint'], ['--on-accent', '--action'], ['--on-accent', '--action-hover'],
    ['--success-text', '--success-bg'], ['--warning-text', '--warning-bg'], ['--danger-text', '--danger-bg'], ['--purple-text', '--purple-bg'],
  ];
  for (const [foreground, background] of pairs) {
    const a = luminance(colors[foreground]), b = luminance(colors[background]);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${dark ? 'Dark' : 'Light'} contrast ${foreground} on ${background}`);
  }
  // Delivery status chips: the label on its soft fill, and on the surfaces where the chip is drawn.
  for (const tone of ['green', 'red', 'amber', 'gray'])
    for (const background of [`--status-${tone}-bg`, '--surface', '--page', '--surface-raised']) {
      const a = luminance(colors[`--status-${tone}-text`]), b = luminance(colors[background]);
      assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${dark ? 'Dark' : 'Light'} status ${tone} on ${background}`);
    }
  for (const plot of ['--chart-out', '--chart-in']) {
    const a = luminance(colors[plot]), b = luminance(colors['--surface']);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 3, `${plot} must remain visible on the chart`);
  }
  // The solid focus outline must stand out from every background it is drawn on (WCAG 2.4.11 / 1.4.11).
  for (const background of ['--page', '--surface']) {
    const a = luminance(colors['--focus']), b = luminance(colors[background]);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 3, `${dark ? 'Dark' : 'Light'} focus outline on ${background}`);
  }
}
// Translucent tokens (#rrggbbaa) are composited over what lies beneath them before measuring.
function over(foreground, background) {
  const [r, g, b, a = 255] = foreground.slice(1).match(/../g).map(value => parseInt(value, 16));
  const base = background.slice(1).match(/../g).slice(0, 3).map(value => parseInt(value, 16));
  return '#' + [r, g, b].map((value, i) => Math.round(value * a / 255 + base[i] * (1 - a / 255)).toString(16).padStart(2, '0')).join('');
}
const contrast = (x, y) => { const a = luminance(x), b = luminance(y); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); };
for (const dark of [false, true]) {
  const colors = palette(dark), mode = dark ? 'Dark' : 'Light';
  // The final destructive button: white on the strong red.
  assert.ok(contrast(colors['--on-accent'], colors['--danger-strong']) >= 4.5, `${mode} --on-accent on --danger-strong`);
  // Tab bar: the current label in --primary and the others in --muted, on the bar over any page background.
  for (const bar of [colors['--material-bar-solid'], over(colors['--material-bar'], colors['--page']), over(colors['--material-bar'], colors['--surface'])])
    for (const label of ['--primary', '--muted']) assert.ok(contrast(colors[label], bar) >= 4.5, `${mode} tab bar label ${label}`);
  for (const background of ['--page', '--surface', '--surface-raised']) {
    // Segmented control: the ring of the selected item stands 3:1 out of the track (WCAG 1.4.11).
    const track = over(colors['--segmented-bg'], colors[background]);
    assert.ok(contrast(colors['--segmented-thumb-border'], track) >= 3, `${mode} selected segment ring on the track over ${background}`);
    // Pills, counters and step marks: secondary text on a gray fill at 4.5:1.
    for (const fill of ['--fill-3', '--fill-4'])
      assert.ok(contrast(colors['--muted-on-fill'], over(colors[fill], colors[background])) >= 4.5, `${mode} --muted-on-fill on ${fill} over ${background}`);
    // A counter inside an unselected segment sits on two fills.
    assert.ok(contrast(colors['--text'], over(colors['--fill-3'], track)) >= 4.5, `${mode} segment count on the track over ${background}`);
  }
}
// The stylesheets use those tokens where the pairs apply.
const sheets = Object.fromEntries(['style.css', 'pages.css', 'search-form.css', 'audit.css'].map(file => [file, postcss.parse(fs.readFileSync(path.join(directory, file), 'utf8'))]));
function declarations(file, selector, media = null) {
  const found = {};
  sheets[file].walkRules(rule => {
    const inside = rule.parent.type === 'atrule' ? rule.parent.params : null;
    if (inside === media && rule.selectors.includes(selector)) rule.walkDecls(d => { found[d.prop] = d.value; });
  });
  return found;
}
assert.equal(declarations('style.css', '.button-danger.button-confirm').background, 'var(--danger-strong)');
assert.equal(declarations('style.css', '.dialog .button-danger').background, 'var(--danger-strong)');
const tab = declarations('style.css', '.mobile-nav a.selected', '(max-width: 1023px)');
assert.equal(tab.color, 'var(--primary)');
assert.equal(tab['font-weight'], '600', 'The current tab is also semibold, not told by color alone');
assert.ok(parseFloat(declarations('style.css', '.mobile-nav a.selected > svg', '(max-width: 1023px)')['stroke-width']) > 2, 'The current tab icon has a bolder stroke');
for (const selector of ['.segmented > [aria-pressed="true"]', '.segmented > [aria-selected="true"]', '.segmented > [aria-current="page"]']) {
  const thumb = declarations('style.css', selector);
  assert.match(thumb['box-shadow'], /inset 0 0 0 1px var\(--segmented-thumb-border\)/, `${selector}: ring around the thumb`);
  assert.equal(thumb['font-weight'], '600', `${selector}: semibold label`);
}
assert.equal(declarations('style.css', '.segmented > button')['font-weight'], '500', 'Unselected segments stay lighter than the selected one');
assert.deepEqual(declarations('style.css', '.nav-count.is-unseen'), {background: 'var(--action)', color: 'var(--on-accent)'}, 'New alerts badge: white on the accent (4.5:1, checked above)');
for (const tone of ['green', 'red', 'amber', 'gray'])
  assert.deepEqual(declarations('pages.css', `.status-chip.tone-${tone}`), {background: `var(--status-${tone}-bg)`, color: `var(--status-${tone}-text)`}, `Status chip ${tone} uses its tokens`);
for (const [file, selector] of [['style.css', '.status-pill'], ['style.css', '.status-pill.is-paused'], ['style.css', '.status-pill.is-ended'], ['style.css', '.nav-count'], ['pages.css', '.live-pill'], ['search-form.css', '.wizard-step-mark'], ['audit.css', '.audit-count']])
  assert.equal(declarations(file, selector).color, 'var(--muted-on-fill)', `${selector} text on its fill`);
assert.equal(declarations('pages.css', '.segment-count').color, 'var(--text)');
console.log('Contrast fixes: final destructive button, tab bar labels, segmented ring and secondary text on fills passed in both appearances.');
// Focus not obscured (WCAG 2.4.11): the page scrolls focused content clear of the fixed bars.
const root = declarations('style.css', 'html');
assert.equal(root['scroll-padding-top'], 'var(--shell-top)');
assert.equal(root['scroll-padding-bottom'], 'calc(var(--shell-bottom) + 16px)');
for (const bar of ['html.with-pending-bar', 'html.with-form-bar'])
  assert.match(declarations('style.css', bar)['scroll-padding-bottom'] || '', /var\(--bottom-bar-height\)/, `${bar} adds the bar over the tab bar`);
assert.match(declarations('style.css', 'html.with-save-bar', '(max-width: 767px)')['scroll-padding-bottom'] || '', /var\(--bottom-bar-height\)/);
assert.match(declarations('style.css', 'html.with-editor-bar', '(max-width: 767px)')['scroll-padding-bottom'] || '', /var\(--control-large\)/);
console.log('Fixed bars: scroll padding for the shell bars, the pending-changes, form and save bars and the assistant footer passed.');
assert.notEqual(palette(false)['--surface'], palette(true)['--surface']);
assert.equal(palette(true)['color-scheme'], 'dark');
for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.css') && file !== 'theme.css')) {
  postcss.parse(fs.readFileSync(path.join(directory, file), 'utf8')).walkDecls(declaration => {
    assert.ok(!/#[0-9a-f]{3,8}\b|\bwhite\b|\bblack\b/i.test(declaration.value), `${file}: fixed color in ${declaration.prop} would bypass the OS palette`);
  });
}
const html = fs.readFileSync(path.join(directory, '../index.html'), 'utf8');
assert.ok(html.includes('name="color-scheme" content="light dark"'));
assert.ok(html.includes('media="(prefers-color-scheme: dark)"'));
// The saved appearance applies before the first paint: an inline script in <head>, ahead of the styles and the app.
const head = html.slice(0, html.indexOf('</head>'));
assert.ok(/<script>[^<]*radar-appearance[^<]*data-theme[^<]*<\/script>/.test(head), 'Boot script in the head');
assert.ok(head.indexOf('radar-appearance') < html.indexOf('/src/main.tsx'));
console.log('System appearance: light/dark text and chart contrast, semantic colors across all stylesheets and first-paint metadata passed.');

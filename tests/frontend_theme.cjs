// Contrast and palette coverage across both appearances, independent of an account.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const req = require('node:module').createRequire(path.join(__dirname, '../frontend/package.json'));
const postcss = req('postcss'), directory = path.join(__dirname, '../frontend/src');
const theme = postcss.parse(fs.readFileSync(path.join(directory, 'theme.css'), 'utf8'));
function palette(dark) {
  const colors = {};
  theme.walkRules(':root', rule => {
    if (rule.parent.type === 'atrule' && (!dark || !rule.parent.params.includes('prefers-color-scheme: dark'))) return;
    rule.walkDecls(declaration => { colors[declaration.prop] = declaration.value; });
  });
  return colors;
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
  for (const plot of ['--chart-out', '--chart-in']) {
    const a = luminance(colors[plot]), b = luminance(colors['--surface']);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 3, `${plot} must remain visible on the chart`);
  }
}
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
console.log('System appearance: light/dark text and chart contrast, semantic colors across all stylesheets and first-paint metadata passed.');

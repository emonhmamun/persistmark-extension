/* Quick CI/dev lint: validates manifest.json and syntax-checks every tracked JS file. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failed = 0;

/* 1. manifest.json must be valid JSON with required fields */
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const required = ['manifest_version', 'name', 'version', 'action', 'content_scripts', 'background'];
  for (const key of required) {
    if (!(key in manifest)) { console.error('✗ manifest.json missing key: ' + key); failed++; }
  }
  const files = [
    ...Object.values(manifest.icons || {}),
    manifest.action.default_popup,
    manifest.options_ui && manifest.options_ui.page,
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap(cs => [...cs.js, ...cs.css])
  ].filter(Boolean);
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f))) { console.error('✗ manifest references missing file: ' + f); failed++; }
  }
  console.log('✓ manifest.json OK (' + manifest.name + ' v' + manifest.version + ')');
} catch (e) {
  console.error('✗ manifest.json invalid: ' + e.message);
  process.exit(1);
}

/* 2. syntax-check all extension JS files */
const jsFiles = [
  'shared/common.js',
  'background/service-worker.js',
  'content/content-script.js',
  'popup/popup.js',
  'options/options.js'
];
for (const f of jsFiles) {
  try {
    execFileSync('node', ['--check', path.join(ROOT, f)], { stdio: 'pipe' });
    console.log('✓ ' + f);
  } catch (e) {
    console.error('✗ ' + f + '\n' + e.stderr.toString());
    failed++;
  }
}

if (failed) { console.error('\nLINT FAILED: ' + failed + ' error(s)'); process.exit(1); }
console.log('\nLINT PASSED');

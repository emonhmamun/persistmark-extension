/* Builds a store-ready zip (dist/persistmark-extension.zip) from the repo. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const exclude = [
  'dist/*', '.git/*', '.github/*', 'node_modules/*', 'test/*',
  'docs/*', 'assets/*', 'screenshots/*', 'scripts/*',
  '*.md', 'package.json', 'package-lock.json', '.gitignore', 'LICENSE', 'icons/source.png'
];

execFileSync('zip', [
  '-r', path.join(DIST, 'persistmark-extension.zip'), '.', ...exclude.flatMap(x => ['-x', x])
], { cwd: ROOT, stdio: 'inherit' });

const size = fs.statSync(path.join(DIST, 'persistmark-extension.zip')).size;
console.log('\n✓ Built dist/persistmark-extension.zip (' + (size / 1024).toFixed(1) + ' KB)');

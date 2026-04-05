'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'node_modules', 'libflacjs', 'dist');
const vendor = path.join(root, 'vendor');
const pairs = [
  ['libflac.min.wasm.js', 'libflac.min.wasm.js'],
  ['libflac.min.wasm.wasm', 'libflac.min.wasm.wasm'],
];
for (const [name, outName] of pairs) {
  fs.copyFileSync(path.join(dist, name), path.join(vendor, outName));
}
console.log('Copied libflac wasm runtime to vendor/');

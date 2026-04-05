'use strict';
/**
 * libflac.min.wasm.js does `var Module=Module||{}` inside the factory, which shadows
 * the global Module and drops pre-set Module.wasmBinary (from libflac-wasm-embed.js).
 * Copy wasmBinary from globalThis.Module into the inner Module so file:// works.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const target = path.join(root, 'vendor', 'libflac.min.wasm.js');
const needle = 'function(global,expLib,require){null;var Module=Module||{};';
const inject =
  'function(global,expLib,require){null;var Module=Module||{};' +
  'if(typeof globalThis!=="undefined"&&globalThis.Module&&globalThis.Module.wasmBinary)' +
  'Module.wasmBinary=globalThis.Module.wasmBinary;';

let s = fs.readFileSync(target, 'utf8');
if (!s.includes(needle)) {
  if (s.includes(inject.slice(0, 80))) {
    console.log('libflac inner Module patch already applied:', path.relative(root, target));
    process.exit(0);
  }
  throw new Error(
    'patch-libflac-inner-module: expected needle not found in libflac.min.wasm.js (libflac version changed?)'
  );
}
s = s.replace(needle, inject);
fs.writeFileSync(target, s, 'utf8');
console.log('Patched inner Module wasmBinary bridge in', path.relative(root, target));

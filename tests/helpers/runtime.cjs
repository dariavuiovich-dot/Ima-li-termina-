const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');

// Run the actual TypeScript modules, with isolated in-memory storage and network.
// No credentials or production notification transports enter the test runtime.
module.exports = function createRuntime(fetch) {
  const root = path.resolve(__dirname, '../..');
  const context = vm.createContext({
    fetch, Request, Response, Headers, URL, AbortSignal, Buffer, TextDecoder, console,
    setTimeout, clearTimeout,
    process: { env: { NODE_ENV: 'development', OPS_TELEGRAM_WEBHOOK_SELF_HEAL: 'false' } }
  });
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const nativeRequire = createRequire(filename);
    const requireModule = name => name.startsWith('@/')
      ? load(name.slice(2) + '.ts') : nativeRequire(name);
    vm.runInContext(`(function(require, module, exports) {\n${source}\n})`, context, { filename })(requireModule, module, module.exports);
    return module.exports;
  }
  return { load, context };
};

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const store = require('../lib/credential-store.ts');
function storage() { const data = new Map(); global.window = { localStorage: { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) } }; return data; }
test('remembered API and opaque admin session survive a fresh module read without storing password', () => {
  const data = storage();
  store.saveStoredCredentials({ accessKey: 'fixture', llmApiKey: 'fixture' });
  store.saveStoredAdminSession({ token: 'opaque-device-token', expiresAt: null });
  assert.equal(store.loadStoredCredentials().llmApiKey, 'fixture');
  assert.deepEqual(store.loadStoredAdminSession(), { token: 'opaque-device-token', expiresAt: null });
  assert.ok(![...data.values()].some(v => v.includes('password')));
});
test('expired legacy sessions are dropped and disconnect forgets both credentials', () => {
  storage();
  store.saveStoredAdminSession({ token: 'old', expiresAt: 1 });
  assert.equal(store.loadStoredAdminSession(), null);
  store.saveStoredAdminSession({ token: 'new', expiresAt: null });
  store.saveStoredCredentials({ accessKey: 'fixture', llmApiKey: 'fixture' });
  store.clearStoredCredentials();
  assert.equal(store.loadStoredCredentials(), null);
  assert.equal(store.loadStoredAdminSession(), null);
});

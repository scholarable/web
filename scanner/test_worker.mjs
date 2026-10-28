import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

let now = Date.parse('2026-10-05T12:00:00Z');
class Clock extends Date { constructor(value = now) { super(value); } static now() { return now; } }
const context = vm.createContext({ Date: Clock, Request, Response, URL, Uint8Array, AbortSignal });
const module = new vm.SourceTextModule(await fs.readFile(new URL('./worker.mjs', import.meta.url), 'utf8'), { context });
const native = new vm.SyntheticModule(['DurableObject'], function () {
  this.setExport('DurableObject', class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } });
}, { context });
await module.link(() => native); await module.evaluate();
const saved = new Map(); let alarm, starts = 0, forwarded = 0, ready = false;
const container = { running: false, images: { base: 'verified-image' },
  start(options) { assert.equal(options.enableInternet, false); assert.equal(options.instance, 'standard-1'); this.running = true; starts++; },
  async destroy() { this.running = false; }, async setInactivityTimeout(value) { assert.equal(value, 30000); },
  getTcpPort() { return { async fetch(url, options) {
    if (url.endsWith('/health')) return new Response(null, { status: ready ? 200 : 503 });
    forwarded++; assert.deepEqual(Object.keys(options.headers).sort(), ['Content-Length', 'Content-Type']);
    assert.equal(new TextDecoder().decode(options.body), '%PDF-test');
    return Response.json({ clean: true, readable: true, format: 'pdf' });
  } }; }
};
const ctx = { container, blockConcurrencyWhile: fn => fn(), storage: {
  async get(key) { return saved.get(key); }, async put(key, value) { saved.set(key, value); }, async setAlarm(value) { alarm = value; }
} };
const env = { SCANNER_ENABLED: 'true' };
const scanner = new module.namespace.DocumentScanner(ctx, env);
const request = () => new Request('https://private/scan', { method: 'POST', body: '%PDF-test', headers: { 'Content-Type': 'application/pdf', Cookie: 'never-forward', 'X-Filename': 'never-forward.pdf' } });
assert.equal((await scanner.fetch(request())).status, 503); // Cold start, no bytes sent.
assert.equal(starts, 1); assert.equal(forwarded, 0); assert.equal(alarm, now + 120000);
ready = true; assert.equal((await scanner.fetch(request())).status, 200); assert.equal(starts, 1);
now += 120001; assert.equal((await scanner.fetch(request())).status, 503); assert.equal(container.running, false);
saved.set('runtime', { month: '2026-10', starts: 180, stopAt: now });
assert.equal((await scanner.fetch(request())).status, 503); assert.equal(starts, 1);
now = Date.parse('2026-11-01T00:00:00Z');
assert.equal((await scanner.fetch(request())).status, 200); assert.equal(saved.get('runtime').starts, 1);
const oversized = new Request('https://private/scan', { method: 'POST', body: new Uint8Array(5 * 1024 * 1024 + 1), headers: { 'Content-Type': 'application/pdf' } });
assert.equal((await scanner.fetch(oversized)).status, 413); assert.equal(forwarded, 2);
scanner.busy = true; assert.equal((await scanner.fetch(request())).status, 503); scanner.busy = false;
env.SCANNER_ENABLED = 'false'; assert.equal((await scanner.fetch(request())).status, 503);
await scanner.alarm(); assert.equal(container.running, false);
assert.equal(await module.namespace.default.fetch(request(), { SCANNER: { getByName(name) { assert.equal(name, 'scanner'); return { fetch: async () => 'single-instance' }; } } }), 'single-instance');
console.log('Wrapper guards: cold start, network isolation, header stripping, runtime cap, month rollover, size, concurrency, pause and shutdown passed');

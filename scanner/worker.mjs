import { DurableObject } from 'cloudflare:workers';

const WINDOW_MS = 120000;
const MAX_STARTS = 180; // At most six reserved container-hours per UTC month.
const unavailable = () => new Response('Scanner unavailable', { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '10' } });

export class DocumentScanner extends DurableObject {
  busy = false;
  constructor(ctx, env) {
    super(ctx, env);
    if (ctx.container?.running) ctx.blockConcurrencyWhile(() => ctx.container.setInactivityTimeout(30000));
  }
  async fetch(request) {
    if (this.env.SCANNER_ENABLED !== 'true' || this.busy) return unavailable();
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/scan' || request.headers.get('Content-Type') !== 'application/pdf') return new Response(null, { status: 415 });
    this.busy = true;
    try {
      const container = this.ctx.container;
      if (!container) return unavailable();
      if (!container.running) {
        const now = Date.now();
        const month = new Date(now).toISOString().slice(0, 7);
        const saved = await this.ctx.storage.get('runtime');
        const starts = saved?.month === month ? saved.starts : 0;
        if (starts >= MAX_STARTS) return unavailable();
        // Reserve before starting: retries, crashes and cold starts count too.
        await this.ctx.storage.put('runtime', { month, starts: starts + 1, stopAt: now + WINDOW_MS });
        await this.ctx.storage.setAlarm(now + WINDOW_MS);
        container.start({ image: container.images.base, instance: 'standard-1', enableInternet: false });
      }
      const runtime = await this.ctx.storage.get('runtime');
      if (!runtime || Date.now() >= runtime.stopAt) {
        await container.destroy();
        return unavailable();
      }
      await container.setInactivityTimeout(30000);
      const port = container.getTcpPort(8080);
      const health = await port.fetch('http://container/health', { signal: AbortSignal.timeout(1000) });
      await health.body?.cancel();
      if (!health.ok) return unavailable(); // Cold start: caller retries, no PDF forwarded.
      const reader = request.body?.getReader();
      if (!reader) return new Response(null, { status: 400 });
      const chunks = []; let length = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.length;
          if (length > 5 * 1024 * 1024) return new Response(null, { status: 413 });
          chunks.push(part.value);
        }
      } finally { await reader.cancel(); }
      if (!length) return new Response(null, { status: 400 });
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      // Never forward identity, cookies, filenames, URLs or caller headers.
      return await port.fetch('http://container/scan', { method: 'POST', body: bytes,
        headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(length) },
        signal: AbortSignal.timeout(13000) });
    } catch { return unavailable(); }
    finally { this.busy = false; }
  }
  async alarm() { await this.ctx.container?.destroy(); }
}

export default {
  fetch(request, env) { return env.SCANNER.getByName('scanner').fetch(request); }
};

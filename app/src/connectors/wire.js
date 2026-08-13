// Shared plumbing for every driver: one JSON-over-HTTP helper with a timeout,
// a size cap and an error that says which service failed and why. Drivers stay
// short because none of them re-implement this.
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 2_000_000;

export async function wire(url, { method = 'GET', headers = {}, body = null, form = null, timeout = TIMEOUT_MS, service = 'service' } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const init = { method, signal: ctl.signal, headers: { accept: 'application/json', ...headers } };
    if (form) {
      init.headers['content-type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(form).toString();
    } else if (body !== null) {
      init.headers['content-type'] = init.headers['content-type'] || 'application/json';
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(url, init);
    const text = (await res.text()).slice(0, MAX_BYTES);
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 2000) }; }
    if (!res.ok) {
      const detail = data?.error?.message || data?.message || data?.error || res.statusText;
      throw new Error(`${service} ${res.status}: ${String(detail).slice(0, 300)}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Base64url — Gmail speaks it, and so does every JWT anyone hands us. */
export const b64url = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unb64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

/** The credential or a clear refusal — never a silent call with no auth. */
export function need(ctx, what = 'credential') {
  const c = ctx.credential();
  if (!c) throw new Error(`${ctx.connector} has no ${what} — connect it first`);
  return c;
}

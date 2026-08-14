// The one door to the server.
//
// Every request in the console goes through here, which is what makes the
// session header, the JSON error shape and the 401 behaviour one decision
// rather than two hundred. Nothing above this line knows the token exists.
import { TOKEN_KEY } from '../state/session.js';


/**
 * What to do when the server says the session is over.
 *
 * The 401 handler used to be a direct call into the login panel, which made this
 * service import a view — the wrong way round, and a cycle the moment the
 * login panel needs to call the API to sign in. The panel registers itself
 * here instead, and until it does the default is to do nothing, so a 401
 * during boot cannot blow up before there is anything to show.
 */
let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json', 'x-auth-token': localStorage.getItem(TOKEN_KEY) || '' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized();
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}
/**
 * Download a file from an authenticated endpoint.
 * A plain <a download> can't carry the session header, so the server answered
 * those links with a 401 JSON body — which is what the browser saved. This
 * fetches with the token, then hands the real blob to a temporary link.
 */
export async function downloadFile(path, fallbackName = 'export.csv') {
  try {
    const res = await fetch(path, { headers: { 'x-auth-token': localStorage.getItem(TOKEN_KEY) || '' } });
    if (!res.ok) {
      let msg = `${res.status}`;
      try { msg = (await res.json()).error || msg; } catch { /* not JSON */ }
      if (res.status === 401) onUnauthorized();
      throw new Error(msg);
    }
    const cd = res.headers.get('content-disposition') || '';
    const name = cd.match(/filename="?([^";]+)"?/)?.[1] || fallbackName;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Downloaded ${name}`);
  } catch (e) {
    toast(`Export failed: ${e.message}`, true);
  }
}

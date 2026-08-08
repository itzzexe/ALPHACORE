// The generic driver — any HTTP API, described rather than coded.
//
// The named drivers cover the services worth writing a file for. This one
// covers everything else: a supplier's order API, a government portal, a
// partner's webhook, an internal tool at a customer. You give it a base URL,
// how it authenticates, and a list of operations; it becomes a connector with
// the same gate, the same allowlist, the same ledger as Gmail.
//
// A connector created from this driver stores its spec in `connectors.config`:
//
//   {
//     baseUrl: 'https://api.example.com/v1',
//     auth: { in: 'header', name: 'authorization', prefix: 'Bearer ' },
//     ops: {
//       'order.create': { method: 'POST', path: '/orders', body: true, targetFrom: 'customer' },
//       'order.read':   { method: 'GET',  path: '/orders/{id}' }
//     }
//   }
//
// Path templates take {name} from the arguments; whatever is left over becomes
// the query string on a GET and the JSON body on anything else.
import { wire } from './wire.js';

const SAFE_METHOD = /^(GET|POST|PUT|PATCH|DELETE)$/i;

function build(spec, opName, args, credential) {
  const op = spec.ops?.[opName];
  if (!op) throw new Error(`this connector does not define ${opName}`);
  if (!SAFE_METHOD.test(op.method || 'GET')) throw new Error('unsupported method');
  const rest = { ...args };
  const path = String(op.path || '').replace(/\{(\w+)\}/g, (_m, k) => {
    const v = rest[k];
    delete rest[k];
    if (v === undefined) throw new Error(`missing path value {${k}}`);
    return encodeURIComponent(String(v));
  });

  const base = String(spec.baseUrl || '').replace(/\/$/, '');
  if (!/^https:\/\//i.test(base)) throw new Error('the base URL must be https');
  const url = new URL(base + path);

  const headers = { ...(spec.headers || {}), ...(op.headers || {}) };
  const auth = spec.auth || {};
  if (credential) {
    if (auth.in === 'header') headers[auth.name || 'authorization'] = `${auth.prefix || ''}${credential}`;
    else if (auth.in === 'query') url.searchParams.set(auth.name || 'key', credential);
    else if (auth.in === 'basic') headers.authorization = `Basic ${Buffer.from(credential).toString('base64')}`;
  }

  const method = (op.method || 'GET').toUpperCase();
  let body = null;
  if (method === 'GET' || method === 'DELETE') {
    for (const [k, v] of Object.entries(rest)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  } else {
    body = op.body === false ? null : rest;
  }
  return { url: url.toString(), method, headers, body };
}

export default {
  id: 'http',
  label: 'Any HTTP API',
  docs: 'describe the API in the connector config; no code needed',
  auth: { kind: 'token', note: 'whatever the API wants — header, query parameter or basic' },
  capabilities: ['request'],
  quotaDay: 500,
  ops: {
    // A single capability with the operation name as an argument, so one
    // connector can expose an entire API while the gate still sees each call.
    request: {
      target: (args, ctx) => {
        const spec = ctx.config || {};
        const op = spec.ops?.[args.op] || {};
        try { return op.targetFrom ? String(args[op.targetFrom]) : new URL(spec.baseUrl).hostname; }
        catch { return spec.baseUrl || null; }
      },
      value: (args) => Number(args.valueUsd || 0),
      async run({ op, ...args }, ctx) {
        const spec = ctx.config || {};
        const req = build(spec, op, args, ctx.credential());
        const data = await wire(req.url, {
          method: req.method, headers: req.headers, body: req.body,
          service: `${ctx.connector}.${op}`,
        });
        return { op, status: 'ok', data };
      },
    },
  },
};

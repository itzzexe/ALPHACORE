// Generate the OpenAPI description from the route table itself.
//
//   node scripts/openapi.mjs            # write public/openapi.json
//   node scripts/openapi.mjs --check    # fail if it is out of date
//
// Written from the source of truth rather than kept alongside it, because a
// hand-maintained spec for 460 routes is a document that is wrong within a
// fortnight and then trusted anyway. This one cannot drift: it is the same
// array the server dispatches on, read at build time.
//
// What it can state exactly: every path, its method, the permission it demands,
// and which path parameters exist. What it cannot: request and response shapes,
// which live in the handlers as plain JavaScript. Those are marked as such
// rather than guessed at — a spec that invents a schema is worse than one that
// admits it does not have one, because tooling believes it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'src', 'api.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// ------------------------------------------------------------ the routes --

/**
 * Pull `['METHOD', /regex/, handler]` out of the table.
 *
 * Reading the file rather than importing it keeps this script free of the
 * database, the vault and the whole boot sequence — it can run in CI on a
 * checkout with no data directory at all.
 */
const routes = [...src.matchAll(/\['(GET|POST|PUT|DELETE|PATCH)',\s*(\/\^[^,]+?\$\/)\s*,/g)]
  .map((m) => ({ method: m[1], pattern: m[2] }));

/**
 * Turn a route regex back into an OpenAPI path with named parameters.
 *
 * Walked segment by segment rather than by a global replace over the whole
 * string: naming a parameter needs to know the segment before it, and doing
 * that with indexOf on a string you are simultaneously rewriting gets the
 * second parameter wrong — which is how `/api/links/{linkId}/{([\w-]+)Id}`
 * appeared in the first version of this file.
 */
function toPath(pattern) {
  const raw = pattern
    .replace(/^\/\^/, '')
    .replace(/\$\/$/, '')
    .replace(/\\\//g, '/');

  const params = [];
  const segments = raw.split('/').map((seg, i, all) => {
    if (!/^\([^)]*\)$/.test(seg)) return seg;
    const group = seg.slice(1, -1);
    const previous = all.slice(0, i).reverse().find((s) => s && !/^\(/.test(s)) || 'param';
    const base = `${previous.replace(/s$/, '')}Id`;
    let name = base;
    for (let n = 2; params.some((x) => x.name === name); n++) name = `${base}${n}`;
    params.push({
      name,
      in: 'path',
      required: true,
      schema: { type: /\\d\+/.test(group) ? 'integer' : 'string' },
      description: `matched by \`${group}\``,
    });
    return `{${name}}`;
  });
  return { path: segments.join('/'), params };
}

// ------------------------------------------------------- the permissions --

/**
 * Ask the real resolver which permission a path needs.
 *
 * permFor() is a chain of conditionals over the path, so the honest way to
 * learn its answer is to run it. It is lifted out of the module and evaluated
 * with a couple of stubs rather than reimplemented here — a second copy of that
 * logic would be a second thing to keep in step, and it would be the one that
 * quietly disagreed.
 */
function permissionResolver() {
  const start = src.indexOf('function permFor');
  if (start < 0) return () => null;
  let depth = 0; let end = start;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const body = src.slice(start, end);
  try {
    // eslint-disable-next-line no-new-func
    return new Function(`${body}; return permFor;`)();
  } catch {
    return () => null;
  }
}

const permFor = permissionResolver();

// ------------------------------------------------------------- the output --

const paths = {};
let withPermission = 0;
for (const r of routes) {
  const { path: p, params } = toPath(r.pattern);
  // Ask with a concrete path: permFor matches on strings, not on patterns.
  const concrete = p.replace(/\{[^}]+\}/g, '1');
  let perm = null;
  try { perm = permFor(r.method, concrete); } catch { perm = null; }
  if (perm) withPermission++;

  paths[p] ||= {};
  paths[p][r.method.toLowerCase()] = {
    summary: `${r.method} ${p}`,
    tags: [p.split('/')[2] || 'api'],
    description: perm
      ? `Requires the \`${perm}\` permission.`
      : 'No permission beyond a valid session.',
    ...(params.length ? { parameters: params } : {}),
    ...(r.method === 'GET' ? {} : {
      requestBody: {
        required: false,
        content: {
          'application/json': {
            // Said plainly rather than invented. The handlers take plain
            // objects; describing a shape this script cannot see would be a
            // lie that tooling would then generate clients from.
            schema: { type: 'object', additionalProperties: true, description: 'Shape is defined by the handler; see src/api.js.' },
          },
        },
      },
    }),
    responses: {
      200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } },
      401: { description: 'No valid session or API key' },
      ...(perm ? { 403: { description: `Missing the \`${perm}\` permission` } } : {}),
      404: { description: 'No such record' },
      429: { description: 'Rate limited (API keys, and sign-in attempts)' },
    },
    security: [{ sessionToken: [] }, { apiKey: [] }],
  };
}

// The endpoints the server answers before the route table is ever consulted.
// They are not in api.js and would otherwise be missing — including the one
// that issues the token everything else needs, which would make the whole
// document unusable.
const handWritten = {
  '/api/ping': {
    get: {
      summary: 'Liveness', tags: ['ping'], security: [],
      description: 'The only endpoint that carries no credential. Says whether the process is alive and can read its own database, and nothing about the company.',
      responses: {
        200: { description: 'Alive', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, name: { type: 'string' }, version: { type: 'string' }, uptimeSeconds: { type: 'integer' } } } } } },
        503: { description: 'The process is up but the database is not readable' },
      },
    },
  },
  '/api/auth/login': {
    post: {
      summary: 'Sign in', tags: ['auth'], security: [],
      description: 'Rate limited per account and per address. Eight failures locks the account for fifteen minutes.',
      requestBody: {
        required: true,
        content: { 'application/json': { schema: {
          type: 'object', required: ['username', 'password'],
          properties: {
            username: { type: 'string' }, password: { type: 'string' },
            code: { type: 'string', description: 'A one-time code or a recovery code, when the account has a second factor.' },
          },
        } } },
      },
      responses: {
        200: { description: 'A token, or a request for the second factor', content: { 'application/json': { schema: { oneOf: [
          { type: 'object', properties: { token: { type: 'string' }, user: { type: 'object' } } },
          { type: 'object', properties: { secondFactorRequired: { const: true }, methods: { type: 'array', items: { type: 'string' } } } },
        ] } } } },
        401: { description: 'Invalid credentials — deliberately the same answer for a wrong password and a missing account' },
        429: { description: 'Too many attempts', headers: { 'retry-after': { schema: { type: 'integer' } } } },
      },
    },
  },
  '/api/auth/logout': { post: { summary: 'Sign out', tags: ['auth'], security: [{ sessionToken: [] }], responses: { 200: { description: 'OK' } } } },
  '/api/auth/me': { get: { summary: 'The signed-in account', tags: ['auth'], responses: { 200: { description: 'OK' }, 401: { description: 'No valid session' } } } },
  '/api/auth/password': {
    post: {
      summary: 'Change your own password', tags: ['auth'],
      description: 'Ends every session for the account, including the one making the request. An account still holding a generated password can reach nothing else until this succeeds.',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['current', 'next'], properties: { current: { type: 'string' }, next: { type: 'string', minLength: 10 } } } } } },
      responses: { 200: { description: 'Changed; sign in again' }, 400: { description: 'The current password is wrong, or the new one is too short' } },
    },
  },
  '/mcp': {
    post: {
      summary: 'Model Context Protocol', tags: ['mcp'],
      description: 'JSON-RPC 2.0. An outside agent drives the company with exactly the permissions the token\'s account holds.',
      responses: { 200: { description: 'A JSON-RPC response' } },
    },
  },
};

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'AlphaCore',
    version: pkg.version,
    description: [
      'The operations API of a company that runs itself.',
      '',
      'This document is generated from the server\'s own route table by',
      '`scripts/openapi.mjs`, so it cannot drift from what the server does.',
      'Request and response bodies are not described: they live in the handlers',
      'as plain JavaScript, and a spec that invented them would be a spec that',
      'tooling believed.',
      '',
      'Everything under /api requires a session token or an API key, except',
      '`GET /api/ping`, `POST /api/auth/login` and `POST /api/auth/logout`.',
      'Carrier callbacks under /webhooks are authenticated by the carrier\'s',
      'own signature instead.',
    ].join('\n'),
    license: { name: 'MIT', identifier: 'MIT' },
  },
  servers: [{ url: 'http://localhost:8484', description: 'A local install' }],
  components: {
    securitySchemes: {
      sessionToken: {
        type: 'apiKey', in: 'header', name: 'x-auth-token',
        description: 'From `POST /api/auth/login`. Idle-expires in 7 days, absolutely in 30.',
      },
      apiKey: {
        type: 'apiKey', in: 'header', name: 'x-api-key',
        description: 'Minted on the API keys page, shown once, scoped and rate-limited per minute.',
      },
    },
  },
  security: [{ sessionToken: [] }, { apiKey: [] }],
  paths: { ...handWritten, ...paths },
};

const out = path.join(root, 'public', 'openapi.json');
const text = `${JSON.stringify(spec, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (current !== text) {
    console.error('public/openapi.json is out of date — run: npm run openapi');
    process.exit(1);
  }
  console.log(`openapi.json is current: ${routes.length} routes, ${Object.keys(paths).length} paths`);
  process.exit(0);
}

fs.writeFileSync(out, text);
console.log(`${routes.length} routes → ${Object.keys(paths).length} paths, ${withPermission} of them permission-guarded`);
console.log(`written to public/openapi.json (${(text.length / 1024).toFixed(0)} kB)`);

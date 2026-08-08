// MCP — the Model Context Protocol, in both directions.
//
// Outward (client): any MCP server the owner registers becomes a set of tools
// the employees can call. One adapter, and a filesystem, a browser, a Postgres,
// a Figma, a Sentry — anything anybody has written a server for — is inside the
// company. This is the single cheapest way to multiply what the workforce can
// physically do.
//
// Inward (server): Crucible describes itself as an MCP server, so Claude Code,
// Claude Desktop or any other agent can drive the company from outside. That is
// what turns an application into a platform.
//
// The protocol is JSON-RPC 2.0 over either a child process's stdio or HTTP. No
// dependency is needed for either, so there is none.
import { spawn } from 'node:child_process';
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { getSecret } from './vault.js';

const parse = (s, f) => { try { return s ? JSON.parse(s) : f; } catch { return f; } };
const PROTOCOL = '2024-11-05';

// ---------------------------------------------------------------- client ---

/** One request/response cycle against a stdio server, process and all. */
function stdioCall(server, requests, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    for (const name of parse(server.env_names, [])) {
      const v = getSecret(name);
      if (v) env[name] = v;
    }
    const child = spawn(server.command, parse(server.args, []), { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const replies = new Map();
    let buffer = '';
    let stderr = '';
    const done = (err, val) => {
      clearTimeout(timer);
      try { child.kill(); } catch { /* already gone */ }
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => done(new Error(`${server.id} did not answer in time${stderr ? `: ${stderr.slice(0, 200)}` : ''}`)), timeoutMs);

    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (e) => done(new Error(`${server.id} could not start: ${e.message}`)));
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined) replies.set(msg.id, msg);
        } catch { /* servers sometimes log to stdout; ignore non-JSON */ }
        if (replies.size >= requests.filter((r) => r.id !== undefined).length) {
          done(null, requests.map((r) => replies.get(r.id)).filter(Boolean));
        }
      }
    });
    for (const r of requests) child.stdin.write(`${JSON.stringify(r)}\n`);
  });
}

async function httpCall(server, requests, timeoutMs = 20_000) {
  const out = [];
  for (const r of requests) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
      for (const name of parse(server.env_names, [])) {
        const v = getSecret(name);
        if (v && /TOKEN|KEY|AUTH/i.test(name)) headers.authorization = `Bearer ${v}`;
      }
      const res = await fetch(server.url, { method: 'POST', headers, body: JSON.stringify(r), signal: ctl.signal });
      const text = await res.text();
      // Streamable HTTP servers answer with SSE; take the last data frame.
      const payload = text.includes('data:') ? text.split(/\n/).filter((l) => l.startsWith('data:')).pop()?.slice(5) : text;
      out.push(payload ? JSON.parse(payload) : null);
    } finally { clearTimeout(timer); }
  }
  return out;
}

const rpc = (server, requests) => (server.transport === 'http' ? httpCall(server, requests) : stdioCall(server, requests));

const handshake = () => [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'crucible-core', version: '1.0' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
];

export function registerServer({ id, label, transport = 'stdio', command = null, args = [], url = null, envNames = [], actor = 'human:admin' }) {
  if (!id) throw new Error('a server needs an id');
  if (transport === 'stdio' && !command) throw new Error('a stdio server needs a command');
  if (transport === 'http' && !url) throw new Error('an http server needs a url');
  exec(
    `INSERT INTO mcp_servers (id, label, transport, command, args, url, env_names)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET label = excluded.label, transport = excluded.transport,
       command = excluded.command, args = excluded.args, url = excluded.url, env_names = excluded.env_names`,
    id, label || id, transport, command, JSON.stringify(args), url, JSON.stringify(envNames),
  );
  audit({ actorType: 'human', actorId: actor, action: 'mcp.registered', subjectType: 'mcp', subjectId: id, payload: { transport, command, url } });
  return one('SELECT * FROM mcp_servers WHERE id = ?', id);
}

/** Ask a server what it can do, and remember the answer. */
export async function syncServer(id) {
  const server = one('SELECT * FROM mcp_servers WHERE id = ?', id);
  if (!server) throw new Error('no such server');
  try {
    const replies = await rpc(server, [...handshake(), { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }]);
    const tools = replies.find((r) => r?.id === 2)?.result?.tools || [];
    exec(
      "UPDATE mcp_servers SET state = 'connected', tools_json = ?, last_sync = datetime('now'), last_error = NULL WHERE id = ?",
      JSON.stringify(tools), id,
    );
    audit({ actorType: 'system', actorId: 'system:mcp', action: 'mcp.synced', subjectType: 'mcp', subjectId: id, payload: { tools: tools.length } });
    return { ok: true, tools };
  } catch (err) {
    exec("UPDATE mcp_servers SET state = 'failed', last_error = ? WHERE id = ?", String(err.message).slice(0, 400), id);
    throw err;
  }
}

/** Call one tool. Recorded whether it works or not. */
export async function callTool({ serverId, tool, args = {}, agentId = null, runId = null }) {
  const server = one('SELECT * FROM mcp_servers WHERE id = ?', serverId);
  if (!server) throw new Error('no such server');
  const started = Date.now();
  try {
    const replies = await rpc(server, [
      ...handshake(),
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: tool, arguments: args } },
    ]);
    const answer = replies.find((r) => r?.id === 3);
    if (answer?.error) throw new Error(answer.error.message || 'the tool refused');
    const content = answer?.result?.content || [];
    const text = content.map((c) => c.text || '').join('\n').slice(0, 20_000);
    exec('INSERT INTO mcp_calls (server_id, tool, agent_id, run_id, args, result, ok, ms) VALUES (?,?,?,?,?,?,1,?)',
      serverId, tool, agentId, runId, JSON.stringify(args), text, Date.now() - started);
    return { ok: true, text, raw: answer?.result };
  } catch (err) {
    exec('INSERT INTO mcp_calls (server_id, tool, agent_id, run_id, args, result, ok, ms) VALUES (?,?,?,?,?,?,0,?)',
      serverId, tool, agentId, runId, JSON.stringify(args), String(err.message).slice(0, 500), Date.now() - started);
    throw err;
  }
}

/** Every tool the company can reach, flattened for a prompt or a picker. */
export function allTools() {
  return q("SELECT * FROM mcp_servers WHERE state = 'connected'").flatMap((s) =>
    parse(s.tools_json, []).map((t) => ({
      server: s.id, serverLabel: s.label, name: t.name,
      describe: t.description || '', schema: t.inputSchema || null,
    })));
}

export function mcpOverview() {
  const servers = q('SELECT * FROM mcp_servers ORDER BY state, id').map((s) => ({
    ...s, args: parse(s.args, []), envNames: parse(s.env_names, []),
    tools: parse(s.tools_json, []),
    calls: one('SELECT COUNT(*) AS n FROM mcp_calls WHERE server_id = ?', s.id).n,
  }));
  return {
    servers,
    counts: {
      registered: servers.length,
      connected: servers.filter((s) => s.state === 'connected').length,
      tools: servers.reduce((a, s) => a + s.tools.length, 0),
      calls: one('SELECT COUNT(*) AS n FROM mcp_calls').n,
    },
    recent: q('SELECT id, server_id, tool, agent_id, ok, ms, created_at FROM mcp_calls ORDER BY id DESC LIMIT 30'),
    suggestions: SUGGESTED,
  };
}

// Servers worth having, with the exact command that starts them. A list beats
// a search when somebody is setting this up for the first time.
const SUGGESTED = [
  { id: 'filesystem', label: 'Filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'], why: 'read and write files in a folder you name' },
  { id: 'memory', label: 'Knowledge graph memory', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], why: 'a second, portable memory the employees share' },
  { id: 'sequentialthinking', label: 'Sequential thinking', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], why: 'structured multi-step reasoning for hard problems' },
  { id: 'fetch', label: 'Fetch', command: 'npx', args: ['-y', '@modelcontextprotocol/server-fetch'], why: 'another route to the web, sandboxed by the server itself' },
  { id: 'git', label: 'Git', command: 'npx', args: ['-y', '@modelcontextprotocol/server-git', '--repository', '.'], why: 'history, diffs and blame on a local repository' },
];

// ---------------------------------------------------------------- server ---
// Crucible described as an MCP server. `handleMcp` answers JSON-RPC over the
// HTTP endpoint, so an outside agent gets the same view of the company that the
// dashboard has — through the same permission checks, because the caller must
// present a token that maps to a user.

export const CRUCIBLE_TOOLS = [
  { name: 'company_overview', description: 'The state of the whole company: queue, spend, decisions waiting, harmony score.', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_sections', description: 'Every department, its division and how many live records it holds.', inputSchema: { type: 'object', properties: {} } },
  { name: 'submit_request', description: 'Put a request on the desk. It is routed, planned and executed like any other order.', inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title', 'body'] } },
  { name: 'ask_employee', description: 'Ask a named employee to do something, and get the run id back.', inputSchema: { type: 'object', properties: { agentId: { type: 'string' }, taskType: { type: 'string' }, input: { type: 'object' } }, required: ['agentId', 'taskType'] } },
  { name: 'read_memory', description: 'Search what the company remembers.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, k: { type: 'number' } }, required: ['query'] } },
  { name: 'audit_tail', description: 'The last entries on the hash chain, newest first.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'post_to_floor', description: 'Say something in the company chat, where every employee can hear it.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, channel: { type: 'string' } }, required: ['text'] } },
];

export async function handleMcp(body, { user, tools }) {
  const reply = (result) => ({ jsonrpc: '2.0', id: body.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: body.id, error: { code, message } });

  switch (body.method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'crucible-core', version: '1.0.0' },
      });
    case 'notifications/initialized':
      return null;
    case 'tools/list':
      return reply({ tools: CRUCIBLE_TOOLS });
    case 'tools/call': {
      const name = body.params?.name;
      const fn = tools[name];
      if (!fn) return fail(-32601, `no tool called ${name}`);
      try {
        const out = await fn(body.params?.arguments || {}, user);
        audit({ actorType: 'human', actorId: `mcp:${user.username}`, action: 'mcp.tool_called', subjectType: 'tool', subjectId: name });
        return reply({ content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 1).slice(0, 40_000) }] });
      } catch (err) {
        return reply({ content: [{ type: 'text', text: `error: ${err.message}` }], isError: true });
      }
    }
    default:
      return fail(-32601, `unsupported method ${body.method}`);
  }
}

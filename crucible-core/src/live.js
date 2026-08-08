// Live presence — the company as it happens, not as it was five seconds ago.
//
// Every page polls today: a timer, a fetch, a re-render, whether or not
// anything changed. That is fine for a dashboard and wrong for a room where
// people and employees work together. This is a WebSocket server written
// against the raw protocol, because adding a dependency to send a few hundred
// bytes a second would be a poor trade.
//
// It broadcasts three things: what just landed on the audit chain, who is
// looking at what, and when an employee starts or finishes a piece of work.
// Nothing here is authoritative — the database is. A dropped socket costs a
// nicety, never a fact.
import { createHash } from 'node:crypto';
import { q, one } from './db.js';
import { userForToken } from './auth.js';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();
let lastSeq = 0;

/** RFC 6455 frame, server → client, text, unmasked, no fragmentation. */
function frame(payload) {
  const data = Buffer.from(payload, 'utf8');
  const len = data.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  head[0] = 0x81; // FIN + text
  return Buffer.concat([head, data]);
}

/** Client → server frames are masked; we only need to read close and pings. */
function readFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = Boolean(buf[1] & 0x80);
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); offset = 10; }
  const mask = masked ? buf.subarray(offset, offset + 4) : null;
  if (masked) offset += 4;
  const data = buf.subarray(offset, offset + len);
  if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
  return { opcode, text: data.toString('utf8') };
}

const send = (client, obj) => {
  try { client.socket.write(frame(JSON.stringify(obj))); }
  catch { drop(client); }
};

function drop(client) {
  clients.delete(client);
  try { client.socket.destroy(); } catch { /* already gone */ }
  broadcastPresence();
}

/** Who is here and what they are looking at. */
function presence() {
  const seen = new Map();
  for (const c of clients) {
    const key = `${c.kind}:${c.who}`;
    const at = seen.get(key) || { who: c.who, kind: c.kind, pages: new Set() };
    if (c.page) at.pages.add(c.page);
    seen.set(key, at);
  }
  return [...seen.values()].map((x) => ({ who: x.who, kind: x.kind, pages: [...x.pages] }));
}

function broadcastPresence() {
  const who = presence();
  for (const c of clients) send(c, { type: 'presence', who });
}

export function broadcast(obj) {
  for (const c of clients) send(c, obj);
}

/** Upgrade an HTTP request into a socket, once it proves who it is. */
export function handleUpgrade(req, socket, head) {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  const user = token ? userForToken(token) : null;
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  const key = req.headers['sec-websocket-key'];
  const accept = createHash('sha1').update(key + GUID).digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '\r\n',
  ].join('\r\n'));
  socket.setNoDelay(true);

  const client = { socket, who: user.display_name || user.username, kind: 'human', page: null };
  clients.add(client);

  socket.on('data', (buf) => {
    const f = readFrame(buf);
    if (!f) return;
    if (f.opcode === 0x8) return drop(client);           // close
    if (f.opcode === 0x9) return socket.write(Buffer.from([0x8a, 0x00])); // ping → pong
    try {
      const msg = JSON.parse(f.text);
      if (msg.type === 'at') { client.page = msg.page; broadcastPresence(); }
    } catch { /* not our message */ }
  });
  socket.on('error', () => drop(client));
  socket.on('close', () => { clients.delete(client); broadcastPresence(); });

  // Say hello with enough state that the page does not need a first fetch.
  send(client, {
    type: 'hello',
    you: client.who,
    who: presence(),
    tip: one('SELECT seq FROM audit_log ORDER BY seq DESC LIMIT 1')?.seq || 0,
  });
  broadcastPresence();
}

/**
 * The chain is the event source: anything worth telling anyone about was
 * written there first. Reading forward from the last sequence number means the
 * feed can never invent an event that did not happen.
 */
export function liveTick() {
  if (!clients.size) {
    lastSeq = one('SELECT seq FROM audit_log ORDER BY seq DESC LIMIT 1')?.seq || lastSeq;
    return 0;
  }
  const rows = q(
    'SELECT seq, occurred_at, actor_type, actor_id, action, subject_type, subject_id FROM audit_log WHERE seq > ? ORDER BY seq ASC LIMIT 40',
    lastSeq,
  );
  if (!rows.length) return 0;
  lastSeq = rows[rows.length - 1].seq;
  broadcast({ type: 'chain', entries: rows });
  return rows.length;
}

export const liveStats = () => ({ connected: clients.size, watching: presence(), tip: lastSeq });

// Slack — the bridge between The Floor and wherever the humans already are.
// Posting into a channel is cheap and reversible, so it is not gated; the
// allowlist decides which channels exist at all as far as this company is
// concerned.
import { wire, need } from './wire.js';

const API = 'https://slack.com/api';
const call = async (method, token, body, get = false) => {
  const data = get
    ? await wire(`${API}/${method}?${new URLSearchParams(body)}`, { headers: { authorization: `Bearer ${token}` }, service: 'slack' })
    : await wire(`${API}/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body, service: 'slack' });
  if (data && data.ok === false) throw new Error(`slack: ${data.error}`);
  return data;
};

export default {
  id: 'slack',
  label: 'Slack',
  docs: 'https://api.slack.com/methods',
  auth: { kind: 'token', note: 'bot token (xoxb-…) with chat:write, channels:read, channels:history' },
  capabilities: ['chat.post', 'chat.read', 'channels.list', 'user.lookup'],
  quotaDay: 1000,
  ops: {
    'chat.post': {
      target: (a) => a.channel,
      run: ({ channel, text, thread = null }, ctx) =>
        call('chat.postMessage', need(ctx, 'bot token'), { channel, text, ...(thread ? { thread_ts: thread } : {}) })
          .then((r) => ({ ts: r.ts, channel: r.channel })),
    },
    'chat.read': {
      target: (a) => a.channel,
      run: ({ channel, limit = 20 }, ctx) =>
        call('conversations.history', need(ctx, 'bot token'), { channel, limit: String(limit) }, true)
          .then((r) => ({ messages: (r.messages || []).map((m) => ({ ts: m.ts, user: m.user, text: String(m.text || '').slice(0, 3000) })) })),
    },
    'channels.list': {
      run: (_a, ctx) => call('conversations.list', need(ctx, 'bot token'), { limit: '200' }, true)
        .then((r) => ({ channels: (r.channels || []).map((c) => ({ id: c.id, name: c.name, members: c.num_members })) })),
    },
    'user.lookup': {
      run: ({ email }, ctx) => call('users.lookupByEmail', need(ctx, 'bot token'), { email }, true)
        .then((r) => ({ id: r.user?.id, name: r.user?.real_name })),
    },
  },
};

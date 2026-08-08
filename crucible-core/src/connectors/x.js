// X (Twitter) — publishing only. Reading a timeline is a research problem the
// web capability already solves; what this connector adds is the ability to
// speak in the company's own name, which is exactly the part that needs a gate
// standing in front of it.
import { wire, need } from './wire.js';

export default {
  id: 'x',
  label: 'X (Twitter)',
  docs: 'https://developer.x.com/en/docs/x-api',
  auth: { kind: 'oauth2', provider: 'x', scopes: ['tweet.read', 'tweet.write', 'users.read', 'offline.access'] },
  capabilities: ['post.publish', 'post.delete', 'me'],
  quotaDay: 100,
  ops: {
    'post.publish': {
      target: () => 'x.com',
      run: ({ text, replyTo = null }, ctx) => {
        if (!text || text.length > 280) throw new Error('a post must be between 1 and 280 characters');
        return wire('https://api.x.com/2/tweets', {
          method: 'POST', headers: { authorization: `Bearer ${need(ctx, 'access token')}` },
          body: { text, ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}) }, service: 'x',
        }).then((r) => ({ id: r.data?.id, text: r.data?.text }));
      },
    },
    'post.delete': {
      target: () => 'x.com',
      run: ({ id }, ctx) => wire(`https://api.x.com/2/tweets/${id}`, {
        method: 'DELETE', headers: { authorization: `Bearer ${need(ctx, 'access token')}` }, service: 'x',
      }),
    },
    me: {
      run: (_a, ctx) => wire('https://api.x.com/2/users/me', {
        headers: { authorization: `Bearer ${need(ctx, 'access token')}` }, service: 'x',
      }),
    },
  },
};

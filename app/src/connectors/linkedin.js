// LinkedIn — where B2B outreach actually happens for an oil-and-gas customer
// base. Publishing needs the author URN, which comes back from /userinfo, so
// the driver fetches it rather than asking a person to paste it in.
import { wire, need } from './wire.js';

export default {
  id: 'linkedin',
  label: 'LinkedIn',
  docs: 'https://learn.microsoft.com/linkedin/marketing/',
  auth: { kind: 'oauth2', provider: 'linkedin', scopes: ['openid', 'profile', 'w_member_social'] },
  capabilities: ['post.publish', 'me'],
  quotaDay: 60,
  ops: {
    me: {
      run: (_a, ctx) => wire('https://api.linkedin.com/v2/userinfo', {
        headers: { authorization: `Bearer ${need(ctx, 'access token')}` }, service: 'linkedin',
      }),
    },
    'post.publish': {
      target: () => 'linkedin.com',
      async run({ text, visibility = 'PUBLIC' }, ctx) {
        const token = need(ctx, 'access token');
        const who = await wire('https://api.linkedin.com/v2/userinfo', { headers: { authorization: `Bearer ${token}` }, service: 'linkedin' });
        const author = `urn:li:person:${who.sub}`;
        const r = await wire('https://api.linkedin.com/v2/ugcPosts', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'x-restli-protocol-version': '2.0.0' },
          body: {
            author,
            lifecycleState: 'PUBLISHED',
            specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text }, shareMediaCategory: 'NONE' } },
            visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': visibility },
          },
          service: 'linkedin',
        });
        return { id: r.id, author };
      },
    },
  },
};

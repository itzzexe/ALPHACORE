// Notion — somewhere to put documents that people outside this app can read
// without being handed a login to it.
import { wire, need } from './wire.js';

const H = (token) => ({ authorization: `Bearer ${token}`, 'notion-version': '2022-06-28' });

export default {
  id: 'notion',
  label: 'Notion',
  docs: 'https://developers.notion.com/reference',
  auth: { kind: 'token', note: 'internal integration secret, or OAuth for a whole workspace' },
  capabilities: ['page.create', 'page.append', 'db.query', 'search'],
  quotaDay: 300,
  ops: {
    'page.create': {
      target: (a) => a.parent,
      run: ({ parent, title, text = '' }, ctx) => wire('https://api.notion.com/v1/pages', {
        method: 'POST', headers: H(need(ctx, 'token')),
        body: {
          parent: { page_id: parent },
          properties: { title: { title: [{ text: { content: title } }] } },
          children: text ? [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: String(text).slice(0, 1900) } }] } }] : [],
        },
        service: 'notion',
      }).then((r) => ({ id: r.id, url: r.url })),
    },
    'page.append': {
      target: (a) => a.page,
      run: ({ page, text }, ctx) => wire(`https://api.notion.com/v1/blocks/${page}/children`, {
        method: 'PATCH', headers: H(need(ctx, 'token')),
        body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: String(text).slice(0, 1900) } }] } }] },
        service: 'notion',
      }),
    },
    'db.query': {
      target: (a) => a.database,
      run: ({ database, filter = null, size = 25 }, ctx) => wire(`https://api.notion.com/v1/databases/${database}/query`, {
        method: 'POST', headers: H(need(ctx, 'token')), body: { page_size: size, ...(filter ? { filter } : {}) }, service: 'notion',
      }).then((r) => ({ count: r.results?.length || 0, results: r.results })),
    },
    search: {
      run: ({ query }, ctx) => wire('https://api.notion.com/v1/search', {
        method: 'POST', headers: H(need(ctx, 'token')), body: { query, page_size: 20 }, service: 'notion',
      }).then((r) => ({ results: (r.results || []).map((x) => ({ id: x.id, url: x.url, type: x.object })) })),
    },
  },
};

// Stripe — real invoices in real currency, beside the crypto treasury that
// already exists. Reading is free; anything that moves money is in the gate's
// always-gated list, so a person releases it or it does not happen.
import { wire, need } from './wire.js';

const API = 'https://api.stripe.com/v1';
const auth = (key) => ({ authorization: `Bearer ${key}` });
const form = (obj, prefix = '') => Object.entries(obj).reduce((acc, [k, v]) => {
  if (v === null || v === undefined) return acc;
  const key = prefix ? `${prefix}[${k}]` : k;
  if (typeof v === 'object' && !Array.isArray(v)) return { ...acc, ...form(v, key) };
  return { ...acc, [key]: String(v) };
}, {});

export default {
  id: 'stripe',
  label: 'Stripe',
  docs: 'https://docs.stripe.com/api',
  auth: { kind: 'token', note: 'restricted API key — read plus invoice write, never a full secret key' },
  capabilities: ['customer.create', 'invoice.create', 'invoice.send', 'balance.read', 'payments.list'],
  quotaDay: 300,
  ops: {
    'customer.create': {
      target: (a) => a.email,
      run: ({ email, name = null }, ctx) => wire(`${API}/customers`, {
        method: 'POST', headers: auth(need(ctx, 'API key')), form: form({ email, name }), service: 'stripe',
      }).then((c) => ({ id: c.id, email: c.email })),
    },
    'invoice.create': {
      target: (a) => a.customer,
      value: (a) => Number(a.amountUsd || 0),
      async run({ customer, amountUsd, description = 'Services', currency = 'usd' }, ctx) {
        const key = need(ctx, 'API key');
        await wire(`${API}/invoiceitems`, {
          method: 'POST', headers: auth(key), service: 'stripe',
          form: form({ customer, amount: Math.round(Number(amountUsd) * 100), currency, description }),
        });
        const inv = await wire(`${API}/invoices`, {
          method: 'POST', headers: auth(key), service: 'stripe',
          form: form({ customer, collection_method: 'send_invoice', days_until_due: 14 }),
        });
        return { id: inv.id, total: inv.amount_due / 100, status: inv.status };
      },
    },
    'invoice.send': {
      target: (a) => a.invoice,
      value: (a) => Number(a.amountUsd || 0),
      run: ({ invoice }, ctx) => wire(`${API}/invoices/${invoice}/send`, {
        method: 'POST', headers: auth(need(ctx, 'API key')), service: 'stripe',
      }).then((i) => ({ id: i.id, status: i.status, url: i.hosted_invoice_url })),
    },
    'balance.read': {
      run: (_a, ctx) => wire(`${API}/balance`, { headers: auth(need(ctx, 'API key')), service: 'stripe' })
        .then((b) => ({ available: b.available, pending: b.pending })),
    },
    'payments.list': {
      run: ({ limit = 20 }, ctx) => wire(`${API}/payment_intents?limit=${limit}`, { headers: auth(need(ctx, 'API key')), service: 'stripe' })
        .then((r) => ({ payments: (r.data || []).map((p) => ({ id: p.id, amount: p.amount / 100, currency: p.currency, status: p.status, created: p.created })) })),
    },
  },
};

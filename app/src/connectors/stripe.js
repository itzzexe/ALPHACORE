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

    // The rest of the lifecycle. Taking money is the easy half; the half that
    // decides whether a business is solvent or in trouble is what happens
    // afterwards, and none of it existed here.

    // A refund moves money outward, so it carries a value and lands on the
    // same gate a payout does. Nothing about "we are giving it back" makes it
    // less of a payment.
    'refund.create': {
      target: (a) => a.paymentIntent,
      value: (a) => Number(a.amountUsd || 0),
      run: ({ paymentIntent, amountUsd = null, reason = 'requested_by_customer' }, ctx) => wire(`${API}/refunds`, {
        method: 'POST',
        headers: auth(need(ctx, 'API key')),
        form: form({
          payment_intent: paymentIntent,
          ...(amountUsd ? { amount: Math.round(Number(amountUsd) * 100) } : {}),
          reason,
        }),
        service: 'stripe',
      }).then((r) => ({ id: r.id, status: r.status, amount: r.amount / 100, currency: r.currency })),
    },

    // Disputes have a deadline, and missing it loses the money by default.
    // Reading them is the only way anybody finds out in time.
    'disputes.list': {
      run: ({ limit = 20 }, ctx) => wire(`${API}/disputes?limit=${limit}`, { headers: auth(need(ctx, 'API key')), service: 'stripe' })
        .then((r) => ({
          disputes: (r.data || []).map((d) => ({
            id: d.id, amount: d.amount / 100, currency: d.currency, reason: d.reason, status: d.status,
            // The date the company loses by default if nobody answers.
            evidenceDueBy: d.evidence_details?.due_by || null,
            hasEvidence: Boolean(d.evidence_details?.submission_count),
          })),
        })),
    },

    // Contesting one is a statement made on the company's behalf to a bank, so
    // it is a write and it goes through the gate like any other.
    'dispute.respond': {
      target: (a) => a.dispute,
      run: ({ dispute, evidence = {} }, ctx) => wire(`${API}/disputes/${dispute}`, {
        method: 'POST', headers: auth(need(ctx, 'API key')),
        form: form(Object.fromEntries(Object.entries(evidence).map(([k, v]) => [`evidence[${k}]`, v]))),
        service: 'stripe',
      }).then((d) => ({ id: d.id, status: d.status })),
    },

    // Tax is not optional and not the same everywhere. Reading the calculated
    // amount beats inventing one, and an invoice with the wrong tax on it is a
    // correction to every downstream report as well.
    'tax.calculate': {
      target: (a) => a.country,
      run: ({ amountUsd, country, postalCode = null, currency = 'usd' }, ctx) => wire(`${API}/tax/calculations`, {
        method: 'POST', headers: auth(need(ctx, 'API key')),
        form: form({
          currency,
          'line_items[0][amount]': Math.round(Number(amountUsd) * 100),
          'line_items[0][reference]': 'services',
          'customer_details[address][country]': country,
          ...(postalCode ? { 'customer_details[address][postal_code]': postalCode } : {}),
          'customer_details[address_source]': 'billing',
        }),
        service: 'stripe',
      }).then((t) => ({
        id: t.id, taxAmount: (t.tax_amount_exclusive || 0) / 100,
        total: (t.amount_total || 0) / 100, currency: t.currency,
      })),
    },
  },
};

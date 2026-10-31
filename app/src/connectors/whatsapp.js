// WhatsApp — the Cloud API, which is how a business sends from its own number.
//
// Two kinds of message, because WhatsApp itself draws the line: a free reply
// inside the twenty-four hours after the customer last wrote, and outside that
// window only a template WhatsApp has approved in advance. The token is the
// connector's credential in the vault; the number's id is the connector config.
import { wire, need } from './wire.js';

const VERSION = 'v20.0';
const endpoint = (ctx, args) => {
  const id = args.phoneNumberId || ctx.config?.phoneNumberId;
  if (!/^\d{5,20}$/.test(String(id || ''))) throw new Error('set the WhatsApp phone number id on the connector');
  return `https://graph.facebook.com/${VERSION}/${id}/messages`;
};
const send = (ctx, args, body) => wire(endpoint(ctx, args), {
  method: 'POST', headers: { authorization: `Bearer ${need(ctx, 'access token')}` }, body: { messaging_product: 'whatsapp', to: String(args.to), ...body }, service: 'whatsapp',
}).then((r) => ({ messageId: r.messages?.[0]?.id || null, to: args.to }));

export default {
  id: 'whatsapp',
  label: 'WhatsApp Business',
  docs: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
  auth: { kind: 'token', note: 'a permanent access token for the WhatsApp Business app; the phone number id goes on the connector config' },
  capabilities: ['message.send', 'template.send'],
  quotaDay: 1000,
  ops: {
    'message.send': {
      target: (a) => String(a.to),
      run: (args, ctx) => send(ctx, args, { type: 'text', text: { body: String(args.text).slice(0, 4096), preview_url: false } }),
    },
    'template.send': {
      target: (a) => String(a.to),
      run: (args, ctx) => send(ctx, args, {
        type: 'template',
        template: {
          name: args.name, language: { code: args.lang || 'ar' },
          ...(args.params?.length ? { components: [{ type: 'body', parameters: args.params.map((p) => ({ type: 'text', text: String(p).slice(0, 1000) })) }] } : {}),
        },
      }),
    },
  },
};

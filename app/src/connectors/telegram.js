// Telegram — the cheapest real channel to reach a person in this part of the
// world: a bot token, no review process, and it works on any phone.
import { wire, need } from './wire.js';

const api = (token, method) => `https://api.telegram.org/bot${token}/${method}`;

export default {
  id: 'telegram',
  label: 'Telegram',
  docs: 'https://core.telegram.org/bots/api',
  auth: { kind: 'token', note: 'bot token from @BotFather' },
  capabilities: ['message.send', 'message.read', 'chat.info'],
  quotaDay: 2000,
  ops: {
    'message.send': {
      target: (a) => String(a.chatId),
      run: ({ chatId, text, silent = false }, ctx) =>
        wire(api(need(ctx, 'bot token'), 'sendMessage'), {
          method: 'POST', body: { chat_id: chatId, text, disable_notification: silent }, service: 'telegram',
        }).then((r) => ({ messageId: r.result?.message_id, chatId })),
    },
    'message.read': {
      run: ({ offset = 0, limit = 20 }, ctx) =>
        wire(`${api(need(ctx, 'bot token'), 'getUpdates')}?offset=${offset}&limit=${limit}`, { service: 'telegram' })
          .then((r) => ({
            updates: (r.result || []).map((u) => ({
              id: u.update_id, chatId: u.message?.chat?.id, from: u.message?.from?.username,
              text: String(u.message?.text || '').slice(0, 3000), date: u.message?.date,
            })),
          })),
    },
    'chat.info': {
      target: (a) => String(a.chatId),
      run: ({ chatId }, ctx) => wire(`${api(need(ctx, 'bot token'), 'getChat')}?chat_id=${chatId}`, { service: 'telegram' })
        .then((r) => ({ id: r.result?.id, title: r.result?.title, type: r.result?.type })),
    },
  },
};

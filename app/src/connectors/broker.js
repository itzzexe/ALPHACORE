// The broker — Alpaca's trading API, paper endpoint unless told otherwise.
//
// Alpaca because it is the one broker with a free, fully featured paper
// account behind the same API as the real one: an install can run the whole
// order path against real market hours and real fills for months before a
// single dollar is at stake. Switching config.live on is a separate, recorded
// decision, and the connector still has to be armed by a person.
//
// The credential is "KEY_ID:SECRET" — one vault entry, split here.
import { wire, need } from './wire.js';

const DATA = 'https://data.alpaca.markets';
const base = (ctx) => (ctx.config?.live === true ? 'https://api.alpaca.markets' : 'https://paper-api.alpaca.markets');

function headers(ctx) {
  const [id, secret] = String(need(ctx, 'Alpaca key (KEY_ID:SECRET)')).split(':');
  if (!id || !secret) throw new Error('the Alpaca credential must be KEY_ID:SECRET');
  return { 'APCA-API-KEY-ID': id, 'APCA-API-SECRET-KEY': secret };
}

export default {
  id: 'broker',
  label: 'Broker — Alpaca (paper by default)',
  auth: { kind: 'api_key' },
  docs: 'Paste KEY_ID:SECRET from alpaca.markets. Orders go to paper-api unless config.live is true.',
  quotaDay: 500,
  // Capabilities added after the first release, offered to installs seeded before them.
  added: ['clock.read', 'bars.intraday', 'position.close'],
  capabilities: ['account.read', 'positions.list', 'orders.list', 'order.place', 'order.cancel', 'clock.read', 'bars.intraday', 'position.close'],
  ops: {
    'account.read': { target: () => 'alpaca', run: (_a, ctx) => wire(`${base(ctx)}/v2/account`, { headers: headers(ctx), service: 'alpaca' }) },
    'positions.list': { target: () => 'alpaca', run: (_a, ctx) => wire(`${base(ctx)}/v2/positions`, { headers: headers(ctx), service: 'alpaca' }) },
    'orders.list': { target: () => 'alpaca', run: (_a, ctx) => wire(`${base(ctx)}/v2/orders?status=all&limit=50`, { headers: headers(ctx), service: 'alpaca' }) },
    'order.place': {
      target: (a) => a.symbol,
      value: (a) => Number(a.estValue) || 0,
      run: (a, ctx) => wire(`${base(ctx)}/v2/orders`, {
        method: 'POST',
        headers: headers(ctx),
        service: 'alpaca',
        body: {
          symbol: a.symbol, qty: String(a.qty), side: a.side,
          type: a.type === 'limit' ? 'limit' : 'market',
          time_in_force: 'day',
          ...(a.type === 'limit' ? { limit_price: String(a.limitPrice) } : {}),
          // A day trade's exits travel with its entry: the stop and the target
          // sit at the broker from the moment it fills, so a dropped
          // connection here never leaves a position without its stop.
          ...(a.stopPrice && a.takeProfit ? {
            order_class: 'bracket',
            take_profit: { limit_price: String(a.takeProfit) },
            stop_loss: { stop_price: String(a.stopPrice) },
          } : {}),
          // Our id on their side, so an order can be matched without guessing.
          client_order_id: `alphacore-${a.orderId}`,
        },
      }),
    },
    // The exchange's own clock, for the days the calendar here does not know.
    'clock.read': { target: () => 'alpaca', run: (_a, ctx) => wire(`${base(ctx)}/v2/clock`, { headers: headers(ctx), service: 'alpaca' }) },
    // Five-minute bars from the IEX feed the free account carries: the
    // broker's own prices, so the trigger and the fill read the same market.
    'bars.intraday': {
      target: (a) => a.symbol,
      run: async (a, ctx) => {
        const start = new Date(Date.now() - (Number(a.days) || 5) * 86_400_000).toISOString();
        const d = await wire(`${DATA}/v2/stocks/${encodeURIComponent(a.symbol)}/bars?timeframe=5Min&start=${encodeURIComponent(start)}&limit=10000&adjustment=raw&feed=iex`, { headers: headers(ctx), service: 'alpaca-data' });
        return { symbol: a.symbol, source: 'alpaca-iex', interval: '5m', bars: (d?.bars || []).map((b) => ({ t: Math.floor(Date.parse(b.t) / 1000), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })) };
      },
    },
    // Closing a whole position is a sell, and a sell is an order.
    'position.close': {
      target: (a) => a.symbol,
      value: (a) => Number(a.estValue) || 0,
      run: (a, ctx) => wire(`${base(ctx)}/v2/positions/${encodeURIComponent(a.symbol)}`, { method: 'DELETE', headers: headers(ctx), service: 'alpaca' }),
    },
    'order.cancel': {
      target: (a) => a.brokerRef,
      run: (a, ctx) => wire(`${base(ctx)}/v2/orders/${encodeURIComponent(a.brokerRef)}`, { method: 'DELETE', headers: headers(ctx), service: 'alpaca' }),
    },
  },
};

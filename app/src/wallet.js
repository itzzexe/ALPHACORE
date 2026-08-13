// Treasury — the company gets paid in crypto, on its own.
//
// The autonomous half is the receiving half, and that is deliberate:
//
//   • Addresses are WATCH-ONLY. No private key, seed or mnemonic is stored in
//     this database or asked for anywhere in this platform. Reading a chain
//     needs no key; spending does, and a key sitting next to an unattended
//     decision loop is how companies lose money they cannot get back.
//   • Agents may invoice, watch, reconcile and report — the whole
//     money-arrives path — without a human touching it.
//   • Money LEAVING is prepared here and signed somewhere else. A payout row
//     is a request, not a transfer, and autonomy mode cannot release it.
//     Blockchain transfers are irreversible; that is the entire reason.
//
// Balances and transactions come from public block explorers, which need no
// account for Bitcoin and take an optional key for the others. With no network
// configured the whole thing runs on a deterministic simulator, so invoicing,
// matching and reconciliation are demonstrable at zero cost — same pattern as
// the model router's mock mode.
import { q, one, exec } from './db.js';
import { audit } from './audit.js';
import { notify } from './notify.js';
import { getSecret, getSetting } from './settings.js';

const lastId = () => one('SELECT last_insert_rowid() AS id').id;
const now = () => new Date().toISOString();

export const CHAINS = {
  bitcoin: { label: 'Bitcoin', asset: 'BTC', decimals: 8, explorer: 'https://blockstream.info/address/' },
  ethereum: { label: 'Ethereum', asset: 'ETH', decimals: 18, explorer: 'https://etherscan.io/address/' },
  tron: { label: 'Tron (USDT-TRC20)', asset: 'USDT', decimals: 6, explorer: 'https://tronscan.org/#/address/' },
  mock: { label: 'Simulator', asset: 'TEST', decimals: 2, explorer: null },
};

const isSimulated = () => String(getSetting('WALLET_MODE') || 'simulated') !== 'live';

/** Address shapes, checked before anything is stored. A typo here costs money. */
const VALID = {
  bitcoin: /^(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/,
  ethereum: /^0x[a-fA-F0-9]{40}$/,
  tron: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  mock: /^[A-Za-z0-9:_-]{4,64}$/,
};

export function addWallet({ label, chain, address, asset = null, kind = 'receiving', actor }) {
  if (!CHAINS[chain]) throw new Error(`chain must be one of: ${Object.keys(CHAINS).join(', ')}`);
  const addr = String(address || '').trim();
  if (!VALID[chain].test(addr)) throw new Error(`that does not look like a ${CHAINS[chain].label} address`);
  if (/^(xprv|zprv|yprv)|^[a-z]+( [a-z]+){11,}$/i.test(addr)) throw new Error('that is a private key or seed phrase — this platform stores watch-only addresses and nothing else');
  const a = asset || CHAINS[chain].asset;
  exec('INSERT INTO wallets (label, chain, asset, address, kind, created_by) VALUES (?,?,?,?,?,?)',
    String(label).trim(), chain, a, addr, kind, actor);
  const id = lastId();
  audit({ actorType: 'human', actorId: actor, action: 'wallet.added', subjectType: 'wallet', subjectId: id, payload: { chain, asset: a, address: addr, watchOnly: true } });
  return id;
}

export function retireWallet(id, { actor }) {
  if (!one('SELECT id FROM wallets WHERE id = ?', id)) throw new Error('no such wallet');
  exec("UPDATE wallets SET state = 'retired' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'wallet.retired', subjectType: 'wallet', subjectId: id });
}

// ---------- reading the chain ----------
async function fetchJson(url, ms = 9000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Live balance + incoming transactions for one address. */
async function readChain(w) {
  if (isSimulated() || w.chain === 'mock') return null;
  if (w.chain === 'bitcoin') {
    const s = await fetchJson(`https://blockstream.info/api/address/${w.address}`);
    const sats = (s.chain_stats.funded_txo_sum - s.chain_stats.spent_txo_sum);
    const txs = await fetchJson(`https://blockstream.info/api/address/${w.address}/txs`);
    return {
      balance: sats / 1e8,
      incoming: txs.slice(0, 25).flatMap((t) => t.vout
        .filter((o) => o.scriptpubkey_address === w.address)
        .map((o) => ({ hash: t.txid, amount: o.value / 1e8, confirmations: t.status?.confirmed ? 1 : 0 }))),
    };
  }
  if (w.chain === 'ethereum') {
    const key = getSecret('ETHERSCAN_API_KEY');
    if (!key) throw new Error('ethereum reading needs ETHERSCAN_API_KEY in Settings');
    const b = await fetchJson(`https://api.etherscan.io/api?module=account&action=balance&address=${w.address}&tag=latest&apikey=${key}`);
    const list = await fetchJson(`https://api.etherscan.io/api?module=account&action=txlist&address=${w.address}&sort=desc&apikey=${key}`);
    return {
      balance: Number(b.result || 0) / 1e18,
      incoming: (Array.isArray(list.result) ? list.result : []).slice(0, 25)
        .filter((t) => String(t.to).toLowerCase() === w.address.toLowerCase())
        .map((t) => ({ hash: t.hash, amount: Number(t.value) / 1e18, confirmations: Number(t.confirmations || 0) })),
    };
  }
  if (w.chain === 'tron') {
    const d = await fetchJson(`https://apilist.tronscanapi.com/api/account?address=${w.address}`);
    const usdt = (d.trc20token_balances || []).find((t) => t.tokenAbbr === 'USDT');
    return { balance: usdt ? Number(usdt.balance) / 1e6 : 0, incoming: [] };
  }
  return null;
}

/** The simulator: payments arrive for open invoices the way they would live. */
function simulateIncoming(w) {
  const inv = q("SELECT * FROM invoices WHERE wallet_id = ? AND state = 'open' AND created_at <= datetime('now','-20 seconds')", w.id);
  return {
    balance: (one('SELECT COALESCE(SUM(amount),0) AS s FROM wallet_tx WHERE wallet_id = ? AND direction = ?', w.id, 'in')?.s || 0),
    incoming: inv.map((i) => ({ hash: `sim-${i.ref.toLowerCase()}`, amount: i.amount, confirmations: 3 })),
  };
}

// ---------- invoicing ----------
export function createInvoice({ description, amount, chain = null, walletId = null, customerId = null, dealId = null, expiresHours = 72, actor }) {
  const amt = Number(amount);
  if (!description?.trim()) throw new Error('an invoice needs a description');
  if (!(amt > 0)) throw new Error('amount must be greater than zero');
  const w = walletId
    ? one("SELECT * FROM wallets WHERE id = ? AND state = 'active'", walletId)
    : one("SELECT * FROM wallets WHERE state = 'active' AND kind = 'receiving' AND (? IS NULL OR chain = ?) ORDER BY id LIMIT 1", chain, chain);
  if (!w) throw new Error('no receiving wallet — add one first');
  const seq = (one('SELECT COUNT(*) AS n FROM invoices').n || 0) + 1;
  const ref = `INV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
  // A unique dust-level suffix makes the amount itself the matching key, so a
  // payment can be attributed without asking the payer to attach a memo.
  const unique = Number((amt + seq / 10 ** (CHAINS[w.chain].decimals > 6 ? 6 : 4)).toFixed(8));
  exec(`INSERT INTO invoices (ref, customer_id, deal_id, wallet_id, description, amount, asset, chain, memo, expires_at, created_by)
        VALUES (?,?,?,?,?,?,?,?,?, datetime('now', ?), ?)`,
    ref, customerId, dealId, w.id, description.trim(), unique, w.asset, w.chain, ref, `+${Number(expiresHours) || 72} hours`, actor);
  const id = lastId();
  audit({ actorType: actor.startsWith('human') ? 'human' : 'agent', actorId: actor, action: 'invoice.created', subjectType: 'invoice', subjectId: id, payload: { ref, amount: unique, asset: w.asset, chain: w.chain } });
  return getInvoice(id);
}

export function getInvoice(id) {
  const i = one('SELECT * FROM invoices WHERE id = ?', id);
  if (!i) return null;
  const w = one('SELECT * FROM wallets WHERE id = ?', i.wallet_id);
  return {
    ...i,
    address: w?.address,
    walletLabel: w?.label,
    explorer: CHAINS[i.chain]?.explorer ? `${CHAINS[i.chain].explorer}${w?.address}` : null,
    payUri: i.chain === 'bitcoin' ? `bitcoin:${w?.address}?amount=${i.amount}&label=${encodeURIComponent(i.ref)}`
      : i.chain === 'ethereum' ? `ethereum:${w?.address}?value=${i.amount}`
        : `${w?.address}`,
  };
}

export function cancelInvoice(id, { actor }) {
  const i = one('SELECT * FROM invoices WHERE id = ?', id);
  if (!i) throw new Error('no such invoice');
  if (i.state === 'paid') throw new Error('that one is already paid');
  exec("UPDATE invoices SET state = 'cancelled' WHERE id = ?", id);
  audit({ actorType: 'human', actorId: actor, action: 'invoice.cancelled', subjectType: 'invoice', subjectId: id });
}

// ---------- the tick: watch, match, reconcile ----------
export async function walletTick() {
  for (const w of q("SELECT * FROM wallets WHERE state = 'active'")) {
    let data = null;
    try { data = w.chain === 'mock' || isSimulated() ? simulateIncoming(w) : await readChain(w); }
    catch (e) {
      audit({ actorType: 'system', actorId: 'treasury', action: 'wallet.read_failed', subjectType: 'wallet', subjectId: w.id, payload: { error: String(e.message).slice(0, 160) } });
      continue;
    }
    if (!data) continue;
    exec('UPDATE wallets SET balance = ?, balance_at = ? WHERE id = ?', data.balance, now(), w.id);

    for (const tx of data.incoming || []) {
      const seen = one('SELECT id FROM wallet_tx WHERE wallet_id = ? AND tx_hash = ? AND amount = ?', w.id, tx.hash, tx.amount);
      if (seen) continue;
      // Match on the exact amount: that is what the unique suffix is for.
      const inv = one("SELECT * FROM invoices WHERE wallet_id = ? AND state = 'open' AND ABS(amount - ?) < 0.00000001 ORDER BY id LIMIT 1", w.id, tx.amount);
      exec('INSERT INTO wallet_tx (wallet_id, tx_hash, direction, amount, asset, confirmations, invoice_id) VALUES (?,?,?,?,?,?,?)',
        w.id, tx.hash, 'in', tx.amount, w.asset, tx.confirmations || 0, inv?.id || null);
      if (inv) {
        exec("UPDATE invoices SET state = 'paid', paid_amount = ?, paid_at = ?, tx_hash = ? WHERE id = ?", tx.amount, now(), tx.hash, inv.id);
        audit({ actorType: 'system', actorId: 'treasury', action: 'invoice.paid', subjectType: 'invoice', subjectId: inv.id, payload: { ref: inv.ref, amount: tx.amount, asset: w.asset, txHash: tx.hash } });
        notify({ level: 'info', source: 'treasury', message: `Payment received: ${inv.ref} — ${tx.amount} ${w.asset} for "${inv.description}".`, subjectType: 'invoice', subjectId: inv.id });
        // A paid invoice is commercial truth: the customer becomes active and
        // the deal is won without anybody re-typing it.
        if (inv.customer_id) {
          try { exec("UPDATE customers SET state = 'active' WHERE id = ? AND state != 'active'", inv.customer_id); } catch { /* customer may be gone */ }
        }
        if (inv.deal_id) {
          try { exec("UPDATE deals SET stage = 'won' WHERE id = ? AND stage != 'won'", inv.deal_id); } catch { /* deal may be gone */ }
        }
      } else {
        audit({ actorType: 'system', actorId: 'treasury', action: 'wallet.unmatched_payment', subjectType: 'wallet', subjectId: w.id, payload: { amount: tx.amount, asset: w.asset, txHash: tx.hash } });
        notify({ level: 'warn', source: 'treasury', message: `${tx.amount} ${w.asset} arrived with no matching invoice — someone needs to attribute it.`, subjectType: 'wallet', subjectId: w.id });
      }
    }
  }
  // Invoices nobody paid stop pretending to be open.
  for (const i of q("SELECT id, ref FROM invoices WHERE state = 'open' AND expires_at IS NOT NULL AND expires_at < datetime('now')")) {
    exec("UPDATE invoices SET state = 'expired' WHERE id = ?", i.id);
    audit({ actorType: 'system', actorId: 'treasury', action: 'invoice.expired', subjectType: 'invoice', subjectId: i.id, payload: { ref: i.ref } });
  }
}

// ---------- money leaving: prepared here, signed elsewhere ----------
export function preparePayout({ toAddress, chain, asset, amount, reason, actor }) {
  if (!CHAINS[chain]) throw new Error('unknown chain');
  if (!VALID[chain].test(String(toAddress || '').trim())) throw new Error('that destination address is not valid for this chain');
  if (!(Number(amount) > 0)) throw new Error('amount must be greater than zero');
  if (!reason?.trim()) throw new Error('a payout needs a stated reason');
  exec('INSERT INTO payouts (to_address, chain, asset, amount, reason, created_by) VALUES (?,?,?,?,?,?)',
    String(toAddress).trim(), chain, asset || CHAINS[chain].asset, Number(amount), reason.trim(), actor);
  const id = lastId();
  audit({ actorType: actor.startsWith('human') ? 'human' : 'agent', actorId: actor, action: 'payout.prepared', subjectType: 'payout', subjectId: id, payload: { chain, amount, reason } });
  notify({ level: 'warn', source: 'treasury', message: `A payout of ${amount} ${asset || CHAINS[chain].asset} is prepared and waiting for a person to sign it — the platform cannot send it.`, subjectType: 'payout', subjectId: id });
  return id;
}

/**
 * Approving a payout records a human decision; it does not move anything. The
 * transfer is signed in the owner's own wallet, and the hash is pasted back
 * here so the ledger and the chain agree.
 */
export function resolvePayout(id, { state, txHash = null, actor, isHuman }) {
  if (!isHuman) throw new Error('only a person can release money — autonomy mode does not reach this');
  if (!['approved', 'rejected', 'sent'].includes(state)) throw new Error('state: approved|rejected|sent');
  const p = one('SELECT * FROM payouts WHERE id = ?', id);
  if (!p) throw new Error('no such payout');
  if (state === 'sent' && !txHash) throw new Error('paste the transaction hash you signed, so the record matches the chain');
  exec('UPDATE payouts SET state = ?, approved_by = ?, tx_hash = COALESCE(?, tx_hash) WHERE id = ?', state, actor, txHash, id);
  audit({ actorType: 'human', actorId: actor, action: `payout.${state}`, subjectType: 'payout', subjectId: id, payload: { amount: p.amount, asset: p.asset, txHash } });
}

// ---------- the view ----------
export function treasuryOverview() {
  const wallets = q("SELECT * FROM wallets WHERE state = 'active' ORDER BY id").map((w) => ({
    ...w,
    explorer: CHAINS[w.chain]?.explorer ? `${CHAINS[w.chain].explorer}${w.address}` : null,
    received: one("SELECT COALESCE(SUM(amount),0) AS s FROM wallet_tx WHERE wallet_id = ? AND direction = 'in'", w.id).s,
    invoices: one('SELECT COUNT(*) AS n FROM invoices WHERE wallet_id = ?', w.id).n,
  }));
  const byAsset = q(`SELECT i.asset, COUNT(*) AS n, ROUND(SUM(i.paid_amount), 8) AS total
                     FROM invoices i WHERE i.state = 'paid' GROUP BY i.asset`);
  return {
    mode: isSimulated() ? 'simulated' : 'live',
    chains: CHAINS,
    wallets,
    invoices: q('SELECT * FROM invoices ORDER BY id DESC LIMIT 60').map((i) => getInvoice(i.id)),
    transactions: q(`SELECT t.*, w.label AS wallet, w.chain FROM wallet_tx t JOIN wallets w ON w.id = t.wallet_id
                     ORDER BY t.id DESC LIMIT 40`),
    payouts: q('SELECT * FROM payouts ORDER BY id DESC LIMIT 30'),
    revenue: byAsset,
    stats: {
      open: one("SELECT COUNT(*) AS n FROM invoices WHERE state = 'open'").n,
      paid: one("SELECT COUNT(*) AS n FROM invoices WHERE state = 'paid'").n,
      awaitingSignature: one("SELECT COUNT(*) AS n FROM payouts WHERE state IN ('prepared','approved')").n,
      unmatched: one('SELECT COUNT(*) AS n FROM wallet_tx WHERE invoice_id IS NULL AND direction = ?', 'in').n,
    },
  };
}

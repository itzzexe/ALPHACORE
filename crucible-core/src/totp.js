// Time-based one-time passwords — RFC 6238 over RFC 4226, on node:crypto.
//
// Six digits from a shared secret and a thirty-second window. The whole
// algorithm is about twenty lines; the parts worth thinking about are the ones
// around it, and those are the ones that get skipped:
//
//   - a window either side, because two clocks are never quite the same
//   - single use, because a code read over somebody's shoulder is valid for
//     thirty seconds and that is long enough to be used twice
//   - recovery codes, because a lost phone must not mean a lost company
//   - constant-time comparison, because timing tells you how many digits were
//     right if you let it
import { createHmac, randomBytes, timingSafeEqual, scryptSync } from 'node:crypto';

const DIGITS = 6;
const PERIOD = 30;

// RFC 4648 base32, which is what every authenticator app expects. No padding:
// the apps accept it, and it keeps the string short enough to type by hand.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  let bits = 0; let value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase().replace(/[\s=-]/g, '')) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('that is not a valid base32 secret');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

/** A fresh secret, 160 bits, which is what RFC 4226 recommends for HMAC-SHA1. */
export function newSecret() {
  return base32Encode(randomBytes(20));
}

/** The code for one counter value. */
function hotp(secret, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', base32Decode(secret)).update(buf).digest();
  // Dynamic truncation, RFC 4226 §5.3: the low nibble of the last byte picks
  // where to read the four bytes from, so the whole digest contributes.
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

export function codeFor(secret, at = Date.now()) {
  return hotp(secret, Math.floor(at / 1000 / PERIOD));
}

/**
 * Check a code against a small window either side.
 *
 * One step of tolerance, not five. Every extra step multiplies the number of
 * codes that work at any instant, and the reason people widen it — "my phone's
 * clock is off" — is a problem to fix rather than to accommodate.
 *
 * Returns the counter that matched, so the caller can refuse to accept it
 * twice.
 */
export function verifyCode(secret, code, { at = Date.now(), window = 1 } = {}) {
  const given = String(code || '').replace(/\D/g, '');
  if (given.length !== DIGITS) return null;
  const now = Math.floor(at / 1000 / PERIOD);
  for (let drift = -window; drift <= window; drift++) {
    const expect = hotp(secret, now + drift);
    const a = Buffer.from(expect);
    const b = Buffer.from(given);
    if (a.length === b.length && timingSafeEqual(a, b)) return now + drift;
  }
  return null;
}

/** What the QR code encodes. */
export function otpauthUrl({ secret, account, issuer = 'AlphaCore' }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(PERIOD) });
  return `otpauth://totp/${label}?${params}`;
}

// ------------------------------------------------------------- recovery ---

/**
 * Ten single-use codes, shown once.
 *
 * A phone is lost, stolen, wiped or replaced far more often than a password is
 * guessed. Without these, switching on 2FA is how somebody locks themselves
 * out of their own company — and the fix would have to be a back door, which is
 * a worse thing to own than the risk it removes.
 *
 * Stored as scrypt hashes: a recovery code is a password, not a token.
 */
export function newRecoveryCodes(n = 10) {
  return Array.from({ length: n }, () => {
    const raw = base32Encode(randomBytes(10)).toLowerCase().slice(0, 16);
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  });
}

export function hashRecovery(code) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(normaliseRecovery(code), salt, 64).toString('hex')}`;
}

export function checkRecovery(code, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = scryptSync(normaliseRecovery(code), salt, 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Typed by hand from paper, so spacing and case are not the user's problem. */
const normaliseRecovery = (code) => String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');

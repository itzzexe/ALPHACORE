// Identity hardening: the lock on the door handle.
//
// A password check alone is an offline cracker with better uptime than the
// attacker's own hardware. These tests drive the three things that close that:
// rate limiting per account and per address, lockout, and a second factor that
// is single-use and recoverable.
//
// Time is passed in explicitly everywhere it matters. A test that generates a
// code with `Date.now() + 31000` passes almost always and fails when it runs
// near a period boundary, which is the worst kind of test there is.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.ALPHACORE_MOCK = 'true';
process.env.ALPHACORE_DB = 'data/test-identity.db';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const s of ['', '-wal', '-shm']) {
  try { fs.rmSync(path.join(root, 'data', `test-identity.db${s}`)); } catch { /* first run */ }
}

const auth = await import('../src/auth.js');
const totp = await import('../src/totp.js');
const { one, exec, q } = await import('../src/db.js');

const PERIOD = 30_000;
/** A time on a period boundary, so a code's counter is never ambiguous. */
const T0 = 1_800_000_000_000 - (1_800_000_000_000 % PERIOD);

function makeUser(username, password) {
  exec(
    'INSERT INTO users (username, display_name, pass, role, perms, must_change) VALUES (?,?,?,?,?,0)',
    username, username, auth.hashPassword(password), 'member', JSON.stringify(['dashboard.view']),
  );
  return one('SELECT id FROM users WHERE username = ?', username).id;
}

// -------------------------------------------------------------------- TOTP --

test('the code generator agrees with the RFC 6238 reference vectors', () => {
  // RFC 6238 Appendix B, SHA-1, seed "12345678901234567890".
  const secret = totp.base32Encode(Buffer.from('12345678901234567890', 'ascii'));
  for (const [seconds, expected] of [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']]) {
    assert.equal(totp.codeFor(secret, seconds * 1000), expected, `at t=${seconds}`);
  }
});

test('base32 survives a round trip, and rejects rubbish', () => {
  const secret = totp.newSecret();
  assert.equal(totp.base32Decode(secret).length, 20, '160 bits, as RFC 4226 recommends');
  assert.equal(totp.base32Encode(totp.base32Decode(secret)), secret);
  assert.throws(() => totp.base32Decode('not-valid-1809!'), /not a valid base32/);
});

test('a code is accepted one step either side, and no further', () => {
  const secret = totp.newSecret();
  const code = totp.codeFor(secret, T0);
  assert.ok(totp.verifyCode(secret, code, { at: T0 }) !== null, 'now');
  assert.ok(totp.verifyCode(secret, code, { at: T0 + PERIOD }) !== null, 'one period late');
  assert.ok(totp.verifyCode(secret, code, { at: T0 - PERIOD }) !== null, 'one period early');
  // Every extra step multiplies the codes that work at any instant.
  assert.equal(totp.verifyCode(secret, code, { at: T0 + 3 * PERIOD }), null, 'three periods late is not tolerance, it is a hole');
  assert.equal(totp.verifyCode(secret, 'abcdef', { at: T0 }), null, 'letters are not a code');
  assert.equal(totp.verifyCode(secret, '12345', { at: T0 }), null, 'five digits are not a code');
});

// ------------------------------------------------------------ rate limiting --

test('an account locks after enough failures, and the right password does not help', () => {
  makeUser('alice', 'alice-password-here');
  for (let i = 0; i < 8; i++) {
    assert.throws(() => auth.login('alice', 'wrong', { ip: '10.0.0.1' }), /invalid credentials/);
  }
  const locked = one("SELECT locked_until FROM users WHERE username = 'alice'").locked_until;
  assert.ok(locked, 'eight failures should lock it');

  try {
    auth.login('alice', 'alice-password-here', { ip: '10.0.0.1' });
    assert.fail('a locked account must refuse even the correct password');
  } catch (e) {
    assert.ok(e instanceof auth.TooManyAttempts, `expected TooManyAttempts, got ${e.message}`);
    assert.ok(e.retryAfterSeconds > 0, 'and it should say how long to wait');
  }
});

test('the lock lifts, and a good sign-in clears it', () => {
  exec("UPDATE users SET locked_until = datetime('now', '-1 minute') WHERE username = 'alice'");
  const r = auth.login('alice', 'alice-password-here', { ip: '10.0.0.1' });
  assert.ok(r.token);
  assert.equal(one("SELECT locked_until FROM users WHERE username = 'alice'").locked_until, null);
});

test('one address spraying many usernames is stopped even though no account locks', () => {
  exec('DELETE FROM login_attempts');
  // Twenty-five different names from one address: no single account comes near
  // its own limit, which is exactly the attack a per-account counter misses.
  for (let i = 0; i < 25; i++) {
    assert.throws(() => auth.login(`ghost${i}`, 'guess', { ip: '203.0.113.9' }), /invalid credentials/);
  }
  assert.throws(() => auth.login('ghost99', 'guess', { ip: '203.0.113.9' }), auth.TooManyAttempts);
  // …and a different address is unaffected.
  assert.throws(() => auth.login('ghost99', 'guess', { ip: '198.51.100.4' }), /invalid credentials/);
});

test('a missing account and a wrong password are indistinguishable', () => {
  exec('DELETE FROM login_attempts');
  let missing; let wrong;
  try { auth.login('nobody-at-all', 'x', { ip: '10.0.0.5' }); } catch (e) { missing = e.message; }
  try { auth.login('alice', 'x', { ip: '10.0.0.5' }); } catch (e) { wrong = e.message; }
  assert.equal(missing, wrong, 'telling them apart hands over the list of real usernames');
});

test('every attempt is on the record, successful or not', () => {
  // Self-contained: an earlier test truncates this table, and a test that
  // depends on what ran before it is a test that fails for the wrong reason.
  exec('DELETE FROM login_attempts');
  assert.throws(() => auth.login('alice', 'wrong', { ip: '10.0.0.42' }));
  assert.ok(auth.login('alice', 'alice-password-here', { ip: '10.0.0.42' }).token);

  const rows = q("SELECT ok, ip, reason FROM login_attempts WHERE username = 'alice' ORDER BY id");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].ok, 0);
  assert.equal(rows[0].reason, 'wrong password');
  assert.equal(rows[1].ok, 1);
  // The address is kept on both: "somebody tried you four hundred times last
  // night, from here" is the sentence this table exists to be able to say.
  assert.ok(rows.every((r) => r.ip === '10.0.0.42'));
});

// ----------------------------------------------------------- second factor --

test('setting up a second factor: unconfirmed until a code proves it', () => {
  exec('DELETE FROM login_attempts');
  const id = makeUser('bob', 'bob-password-here');
  const { secret, otpauth } = auth.beginTotp(id);
  assert.match(otpauth, /^otpauth:\/\/totp\/AlphaCore%3Abob\?/);
  assert.match(otpauth, /algorithm=SHA1/);
  assert.equal(auth.totpEnabled(id), false, 'an unproved secret must not gate anything yet');

  assert.throws(() => auth.confirmTotp(id, '000000'), /not right/);
  const conf = auth.confirmTotp(id, totp.codeFor(secret));
  assert.equal(auth.totpEnabled(id), true);
  assert.equal(conf.recoveryCodes.length, 10, 'a lost phone must not mean a lost company');
  // Recovery codes are handed over only after the factor is proved to work.
  assert.equal(one('SELECT COUNT(*) AS n FROM user_recovery WHERE user_id = ?', id).n, 10);
});

test('the password alone stops being enough', () => {
  try {
    auth.login('bob', 'bob-password-here', { ip: '10.0.0.7' });
    assert.fail('should have asked for a code');
  } catch (e) {
    assert.ok(e instanceof auth.SecondFactorRequired);
    assert.deepEqual(e.methods, ['totp', 'recovery']);
  }
});

test('a code works once, and says so plainly when it is spent', () => {
  const id = one("SELECT id FROM users WHERE username = 'bob'").id;
  // Move the stored counter back so a fresh code is unmistakably newer than
  // the one that confirmed the setup.
  exec('UPDATE user_totp SET last_counter = ? WHERE user_id = ?', Math.floor(Date.now() / 1000 / 30) - 5, id);
  const secret = one('SELECT secret FROM user_totp WHERE user_id = ?', id).secret;
  const code = totp.codeFor(secret);

  assert.ok(auth.login('bob', 'bob-password-here', { code, ip: '10.0.0.7' }).token);

  try {
    auth.login('bob', 'bob-password-here', { code, ip: '10.0.0.7' });
    assert.fail('the same code must not work twice');
  } catch (e) {
    // "Already used" and "wrong" are different facts. Told only that a correct
    // code is wrong, people re-scan the QR and eventually switch it off.
    assert.match(e.message, /already been used/);
  }
});

test('a recovery code is a one-shot, and the count goes down', () => {
  const id = one("SELECT id FROM users WHERE username = 'bob'").id;
  exec('DELETE FROM user_recovery WHERE user_id = ?', id);
  const codes = totp.newRecoveryCodes(3);
  for (const c of codes) exec('INSERT INTO user_recovery (user_id, code) VALUES (?,?)', id, totp.hashRecovery(c));

  // Typed off paper: spacing and case are not the user's problem.
  assert.ok(auth.login('bob', 'bob-password-here', { code: codes[0].toUpperCase().replace(/-/g, ' '), ip: '10.0.0.7' }).token);
  assert.equal(auth.securityOverview(id).recoveryRemaining, 2);
  assert.throws(() => auth.login('bob', 'bob-password-here', { code: codes[0], ip: '10.0.0.7' }), /not right/);
});

test('turning it off needs the password, so a stolen session cannot', () => {
  const id = one("SELECT id FROM users WHERE username = 'bob'").id;
  assert.throws(() => auth.disableTotp(id, 'not-the-password'), /password is not right/);
  assert.equal(auth.disableTotp(id, 'bob-password-here').ok, true);
  assert.equal(auth.totpEnabled(id), false);
  assert.equal(one('SELECT COUNT(*) AS n FROM user_recovery WHERE user_id = ?', id).n, 0, 'the codes go with it');
});

// ----------------------------------------------------------------- sessions --

test('a session has an absolute ceiling as well as an idle one', () => {
  const id = one("SELECT id FROM users WHERE username = 'bob'").id;
  const { token } = auth.login('bob', 'bob-password-here', { ip: '10.0.0.8' });
  assert.ok(auth.userForToken(token), 'valid now');

  // A token that leaks is good forever if something keeps touching it — unless
  // there is a second clock that sliding cannot move.
  exec("UPDATE sessions SET absolute_expires_at = datetime('now', '-1 second') WHERE token = ?", token);
  assert.equal(auth.userForToken(token), null, 'past its absolute expiry, however recently it was used');
});

test('signing out everywhere else keeps the session doing it', () => {
  const id = one("SELECT id FROM users WHERE username = 'bob'").id;
  exec('DELETE FROM sessions WHERE user_id = ?', id);
  const mine = auth.login('bob', 'bob-password-here', { ip: '10.0.0.9' }).token;
  auth.login('bob', 'bob-password-here', { ip: '10.0.0.10' });
  auth.login('bob', 'bob-password-here', { ip: '10.0.0.11' });

  const r = auth.endOtherSessions(id, mine);
  assert.equal(r.ended, 2);
  assert.ok(auth.userForToken(mine), 'the one being used survives');
});

test('the security page never shows a token, not even to its owner', () => {
  const id = one("SELECT id FROM users WHERE username = 'bob'").id;
  const view = auth.securityOverview(id);
  const full = q('SELECT token FROM sessions WHERE user_id = ?', id).map((s) => s.token);
  const shown = JSON.stringify(view);
  for (const t of full) assert.ok(!shown.includes(t), 'this list gets read on shared screens');
  assert.ok(view.sessions.every((s) => s.id.length === 8));
});

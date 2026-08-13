// Where the master key comes from, and how to change it.
//
// Everything the company keeps secret — provider keys, OAuth tokens, webhook
// signing secrets, and every person's crypto-shredding key — is sealed under
// one key. That makes two questions load-bearing, and the platform had an
// answer to neither:
//
//   Where does it live?  A file on the same disk as the database, which is
//                        honest for one machine and wrong for anything else.
//                        Anybody with a real secret manager should be able to
//                        use it without patching the source.
//
//   How is it changed?   It was not. A key that cannot be rotated is a key you
//                        keep after the laptop it was copied to went missing,
//                        because the alternative is losing every credential.
//
// Three sources, tried in order. The interface below does not change when the
// source does, which is the whole reason it exists.
import { scryptSync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.js';

const KEY_FILE = path.join(ROOT, 'data', 'master.key');

/**
 * Raw key material, before it is stretched.
 *
 * `ALPHACORE_MASTER_KEY_COMMAND` is the KMS door: any command that prints the
 * material on stdout works — `vault read`, `aws kms decrypt`, `op read`,
 * `gcloud kms decrypt`, a script that talks to an HSM. The platform never sees
 * the credential that fetched it, only the answer, and the answer never
 * touches the disk.
 */
function material({ create = true } = {}) {
  const cmd = process.env.ALPHACORE_MASTER_KEY_COMMAND;
  if (cmd) {
    // Split on spaces rather than going through a shell: a key-fetching
    // command is the last place to introduce shell interpolation.
    const [bin, ...args] = cmd.split(/\s+/);
    const out = execFileSync(bin, args, { encoding: 'utf8', timeout: 15_000, windowsHide: true }).trim();
    if (!out) throw new Error('ALPHACORE_MASTER_KEY_COMMAND produced nothing');
    return { source: 'command', raw: Buffer.from(out, 'base64') };
  }

  if (process.env.ALPHACORE_MASTER_KEY) {
    return { source: 'environment', raw: Buffer.from(process.env.ALPHACORE_MASTER_KEY.trim(), 'base64') };
  }

  if (!fs.existsSync(KEY_FILE)) {
    if (!create) return null;
    const fresh = Buffer.concat([randomBytes(16), randomBytes(32)]);
    fs.writeFileSync(KEY_FILE, fresh.toString('base64'), { mode: 0o600 });
  }
  return { source: 'file', raw: Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64') };
}

/** salt ‖ material → a 32-byte key. */
function stretch(raw) {
  if (!raw || raw.length < 48) throw new Error('the master key material is too short to be a master key');
  return scryptSync(raw.subarray(16), raw.subarray(0, 16), 32);
}

export function masterKey() {
  return stretch(material().raw);
}

/**
 * Which key sealed a given ciphertext.
 *
 * A short fingerprint of the key, not the key. Stored beside each sealed value
 * so "this was sealed under a key I no longer have" can be told apart from
 * "this is corrupt" — two problems with completely different answers, and
 * before this they produced the same unhelpful decryption error.
 */
export function keyId(key = masterKey()) {
  return scryptSync(key, 'alphacore-key-id', 8).toString('hex');
}

export function keySource() {
  const m = material({ create: false });
  return {
    source: m?.source || 'not created yet',
    keyId: m ? keyId(stretch(m.raw)) : null,
    // Said plainly on the page, because "encrypted at rest" means very little
    // when the key is in the next file along.
    external: m?.source === 'command',
    note: m?.source === 'file'
      ? 'the key sits beside the database — theft of the disk is theft of both. ALPHACORE_MASTER_KEY_COMMAND moves it to a secret manager.'
      : m?.source === 'environment'
        ? 'from the environment: better than the disk, and still visible to anything that can read this process.'
        : m?.source === 'command'
          ? 'fetched from outside on every use; nothing is written to disk.'
          : null,
  };
}

// ---------------------------------------------------------------- rotation --

/**
 * Make a new key and hand back both, without installing anything.
 *
 * Installing is the caller's job and happens only after every secret has been
 * re-sealed and read back, because a rotation that swaps the key first and
 * fails halfway is indistinguishable from destroying the vault.
 */
export function proposeKey() {
  const raw = Buffer.concat([randomBytes(16), randomBytes(32)]);
  const key = stretch(raw);
  return { raw, key, id: keyId(key) };
}

/**
 * Put the new key where the old one was — the last step, once everything else
 * has been proved.
 *
 * The old file is kept, renamed with the time it was retired. Deleting it in
 * the same breath as installing its replacement leaves nothing to go back to
 * if a backup taken an hour ago is later restored, and that backup's secrets
 * are still sealed under the old key.
 */
export function installKey(raw) {
  const m = material({ create: false });
  if (m && m.source !== 'file') {
    throw new Error(
      `the master key comes from the ${m.source}, so rotation belongs there: `
      + 'change it in your secret manager, then re-seal with npm run rotate-key -- --reseal-only',
    );
  }
  let retired = null;
  if (fs.existsSync(KEY_FILE)) {
    retired = `${KEY_FILE}.retired-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(KEY_FILE, retired);
  }
  // Write beside it and rename: a half-written key file is a lost company.
  const tmp = `${KEY_FILE}.new`;
  fs.writeFileSync(tmp, raw.toString('base64'), { mode: 0o600 });
  fs.renameSync(tmp, KEY_FILE);
  return { installed: keyId(stretch(raw)), retiredFile: retired };
}

export { KEY_FILE };

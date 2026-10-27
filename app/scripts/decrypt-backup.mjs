// Open an encrypted offsite backup on any machine with Node — no database, no
// running AlphaCore, no master key: only the file and the passphrase.
//
//   node scripts/decrypt-backup.mjs alphacore-2026-10-27-scheduled.db.acbk restored.db
//
// The passphrase is read from BACKUP_PASSPHRASE, or asked for, so it does not
// end up in the shell's history.
import process from 'node:process';
import readline from 'node:readline';
import { decryptFile } from '../src/backupcrypt.js';

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error('usage: node scripts/decrypt-backup.mjs <file.acbk> <restored.db>');
  process.exit(2);
}
const ask = () => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  rl.question('Backup passphrase: ', (a) => { rl.close(); resolve(a); });
});
const pass = process.env.BACKUP_PASSPHRASE || await ask();
try {
  const r = await decryptFile(src, dst, pass);
  console.log(`restored ${r.bytes} bytes to ${dst}`);
} catch (e) {
  console.error(`could not open it: ${e.message}`);
  process.exit(1);
}

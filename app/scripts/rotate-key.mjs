// Rotate the master key from the command line.
//
//   npm run rotate-key -- --dry-run     # what would move, without moving it
//   npm run rotate-key                  # do it
//
// From the console rather than the browser on purpose. This re-encrypts every
// credential the company holds and every person's shredding key; the authority
// it needs is filesystem access to the key file, which is exactly the authority
// somebody at a terminal already has and a signed-in browser session does not.
import { rotateMasterKey, keyHealth } from '../src/vault.js';

const dryRun = process.argv.includes('--dry-run');
const rule = '─'.repeat(64);

const health = keyHealth();
console.log(`\n${rule}`);
console.log(`  master key: ${health.keyId || '(none yet)'}   from the ${health.source}`);
if (health.note) console.log(`  ${health.note}`);
console.log(`  ${health.readable} of ${health.sealedValues} sealed values are readable`);
if (health.retiredKeys.length) console.log(`  retired keys kept: ${health.retiredKeys.length}`);
console.log(rule);

if (health.failing.length) {
  console.error('\n  Some values cannot be read with the current key:');
  for (const f of health.failing) console.error(`    ${f.where}: ${f.error}`);
  console.error('\n  Rotating now would make that permanent. Fix or remove them first.\n');
  process.exit(1);
}

const r = rotateMasterKey({ actor: 'human:console', dryRun });

if (!r.ok) {
  console.error(`\n  ✗ ${r.reason}`);
  if (r.unreadable) for (const u of r.unreadable) console.error(`    ${u}`);
  if (r.urgent) {
    // The one case where the database and the key file disagree. Say exactly
    // what to do, at the moment it happens, rather than leaving it to be
    // discovered at the next restart.
    console.error(`\n  URGENT: ${r.urgent}`);
    console.error(`  material: ${r.material}`);
  }
  console.error('');
  process.exit(1);
}

if (r.dryRun) {
  console.log(`\n  A rotation would re-seal ${r.wouldReseal} value(s) from key ${r.from}.`);
  console.log('  Nothing was changed.\n');
  process.exit(0);
}

console.log(`\n  ✓ ${r.from} → ${r.to}, ${r.resealed} value(s) re-sealed`);
if (r.retiredFile) console.log(`  the old key is kept at ${r.retiredFile}`);
console.log(`\n  ${r.note}\n`);

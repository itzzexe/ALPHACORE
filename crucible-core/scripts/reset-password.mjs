// Issue a new password for an account, from the machine the company runs on.
//
// This exists because the first-run password is printed exactly once and stored
// only as a hash. Miss that line — close the window, scroll past it, start the
// server from a service manager that swallows stdout — and there was no way
// back in short of deleting the database, which deletes the company with it.
//
// The authority this asks for is filesystem access to data/alphacore.db, which
// is the same authority needed to delete that file. So it grants nothing new;
// it just makes the recoverable case recoverable. Anyone who can run this could
// already have taken everything.
//
//   npm run reset-password            # the owner account
//   npm run reset-password -- alice   # somebody else
import { randomBytes } from 'node:crypto';
import { one, exec } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { audit } from '../src/audit.js';

const username = (process.argv[2] || 'owner').trim().toLowerCase();
const user = one('SELECT id, username, role FROM users WHERE username = ?', username);

if (!user) {
  const all = one('SELECT COUNT(*) AS n FROM users').n;
  console.error(`\n  There is no account called "${username}".`);
  console.error(all
    ? `  ${all} account(s) exist. Name one of them: npm run reset-password -- <username>\n`
    : '  This database has no accounts at all. Start the server and it will create one.\n');
  process.exit(1);
}

const password = randomBytes(9).toString('base64url');
exec('UPDATE users SET pass = ?, must_change = 1 WHERE id = ?', hashPassword(password), user.id);
// Every existing session dies with the old password. If this reset happened
// because somebody else got in, leaving their session alive defeats it.
const killed = exec('DELETE FROM sessions WHERE user_id = ?', user.id).changes;

audit({
  actorType: 'human',
  actorId: 'human:console',
  action: 'user.password_reset',
  subjectType: 'user',
  subjectId: String(user.id),
  payload: { username: user.username, by: 'command line', sessionsEnded: killed },
});

const rule = '─'.repeat(58);
console.log(`\n${rule}
  A new password has been issued for "${user.username}".

    username   ${user.username}
    password   ${password}

  ${killed ? `${killed} open session(s) were signed out.` : 'No sessions were open.'}
  You will be asked to replace this the moment you sign in.
  It is shown once; it is not stored anywhere in readable form.
${rule}
`);

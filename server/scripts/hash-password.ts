import { hashPassword } from '../src/http/password.js';
import { ask } from './prompt.js';

const a = await ask('Password: ', true);
if (a.length < 8) {
  console.error('Use at least 8 characters.');
  process.exit(1);
}
if (a !== (await ask('Again: ', true))) {
  console.error('Passwords do not match.');
  process.exit(1);
}
// single quotes: docker compose would otherwise expand the $ parts as variables
console.log(`\nAPP_PASSWORD_HASH='${await hashPassword(a)}'\n`);
console.log('Keep the single quotes when pasting into .env.');

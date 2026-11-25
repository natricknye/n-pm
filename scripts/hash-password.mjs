import { hashPassword } from '../server/auth.js';

function askHidden(query) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let value = '';
      stdin.setEncoding('utf8');
      stdin.on('data', chunk => { value += chunk; });
      stdin.on('end', () => resolve(value.trim()));
      stdin.on('error', reject);
      return;
    }
    process.stdout.write(query);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = chunk => {
      if (chunk === '\r' || chunk === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
        return;
      }
      if (chunk === '\u0003') {
        stdin.setRawMode(false);
        process.stdout.write('\n');
        process.exit(1);
      }
      if (chunk === '\u007f') {
        if (value) {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      value += chunk;
      process.stdout.write('*');
    };
    stdin.on('data', onData);
  });
}

const password = process.env.PM_PASSWORD || await askHidden('PM password: ');
if (password.length < 10) {
  console.error('Use at least 10 characters.');
  process.exit(1);
}
const hash = hashPassword(password);
console.log('\nAdd this to Vercel Production as PM_PASSWORD_HASH:\n');
console.log(hash);
console.log('\nUse the same password as your blog. This hash and PM_SESSION_SECRET stay separate.\n');

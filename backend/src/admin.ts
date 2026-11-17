import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import bcrypt from 'bcryptjs';
import { Store, id, now } from './db.js';
import { userSchema } from './schemas.js';
async function hiddenPassword(): Promise<string> {
  if (!stdin.isTTY) throw new Error('Use ADMIN_PASSWORD for noninteractive setup.');
  stdout.write('Password (12–72 characters; hidden): ');
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let password = '';
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          cleanup();
          resolve(password);
          return;
        }
        if (c === '\u0003') {
          cleanup();
          reject(new Error('Cancelled'));
          return;
        }
        if (c === '\u007f' || c === '\b') password = password.slice(0, -1);
        else password += c;
      }
    };
    stdin.on('data', onData);
  });
}
const rl = createInterface({ input: stdin, output: stdout });
const email = process.env.ADMIN_EMAIL ?? (await rl.question('Admin email: '));
const name = process.env.ADMIN_NAME ?? (await rl.question('Admin display name: '));
rl.close();
const password = process.env.ADMIN_PASSWORD ?? (await hiddenPassword());
const b = userSchema.parse({ email, name, password, role: 'admin' });
const s = new Store(process.env.DATABASE_URL ?? process.env.DATABASE_PATH ?? './data/utb.sqlite');
try {
  if (await s.get('SELECT 1 FROM users WHERE email=? COLLATE NOCASE', b.email))
    throw new Error('Account already exists. No account was changed.');
  const passwordHash = await bcrypt.hash(b.password, 12);
  const userId = id();
  await s.tx(async () => {
    await s.run(
      'INSERT INTO users VALUES (?,?,?,?,?,?,?)',
      userId,
      b.email,
      b.name,
      passwordHash,
      'admin',
      1,
      now(),
    );
    await s.audit(userId, 'bootstrap-admin', 'user', userId, { email: b.email });
  });
  console.info('Administrator created. No inventory or sales data was seeded.');
} finally {
  await s.close();
}

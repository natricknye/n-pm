import assert from 'node:assert/strict';
import test from 'node:test';
import { hashPassword, signSession, verifyPassword, verifySession } from '../server/auth.js';

test('password hash verifies only the right password', () => {
  const hash = hashPassword('correct horse battery staple');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(verifyPassword('correct horse battery staple', hash), true);
  assert.equal(verifyPassword('wrong password', hash), false);
  assert.equal(verifyPassword('', hash), false);
  assert.equal(verifyPassword('anything', 'not-a-hash'), false);
});

test('session signature detects tampering and expiry', () => {
  const secret = 'a'.repeat(32);
  const token = signSession(secret, { exp: Date.now() + 60_000 });
  assert.equal(verifySession(token, secret)?.sub, 'owner');
  assert.equal(verifySession(`${token}x`, secret), null);
  assert.equal(verifySession(token, 'b'.repeat(32)), null);
  const expired = signSession(secret, { exp: Date.now() - 1 });
  assert.equal(verifySession(expired, secret), null);
});

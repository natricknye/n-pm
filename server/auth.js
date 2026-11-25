import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const COOKIE = 'pm_session';
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const MAX_AGE = 60 * 60 * 24 * 30;

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

export function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 10) {
    throw new Error('password_too_short');
  }
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${b64url(salt)}$${b64url(hash)}`;
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  try {
    const expected = Buffer.from(hash, 'base64url');
    const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function signSession(secret, payload = {}) {
  if (!secret) throw new Error('session_secret_missing');
  const body = b64url(JSON.stringify({
    sub: 'owner',
    iat: Date.now(),
    exp: Date.now() + MAX_AGE * 1000,
    ...payload,
  }));
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifySession(token, secret) {
  if (!token || !secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest();
  let actual;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || payload.sub !== 'owner') return null;
    if (!Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const chunk of String(header).split(';')) {
    const index = chunk.indexOf('=');
    if (index <= 0) continue;
    const key = chunk.slice(0, index).trim();
    const value = chunk.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function sessionCookie(token) {
  const secure = process.env.NODE_ENV === 'production' || process.env.PM_SECURE_COOKIE === '1';
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function readSession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return verifySession(cookies[COOKIE], process.env.PM_SESSION_SECRET || '');
}

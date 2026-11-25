export const config = { runtime: 'edge' };

const encoder = new TextEncoder();

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret, body) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return hex(signature);
}

function equalHex(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'webhook_not_configured' }, 503);

  const raw = await request.text();
  if (raw.length > 2_000_000) return json({ error: 'too_large' }, 413);
  const signature = request.headers.get('x-hub-signature-256') || '';
  if (!signature.startsWith('sha256=')) return json({ error: 'invalid_signature' }, 401);
  const expected = await hmacHex(secret, raw);
  if (!equalHex(signature.slice(7), expected)) return json({ error: 'invalid_signature' }, 401);

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_payload' }, 400);
  }

  const event = request.headers.get('x-github-event') || '';
  const target = new URL('/api/internal/github-webhook', request.url);
  const response = await fetch(target, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-webhook': secret,
    },
    body: JSON.stringify({ payload, event }),
  });
  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

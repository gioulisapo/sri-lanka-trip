import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const sessionSeconds = 30 * 24 * 60 * 60;
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const signature = (expires, password) => createHmac('sha256', password).update('sri-lanka-session:' + expires).digest('hex');
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

function loginPage(incorrect = false) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in | Sri Lanka</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:#f5f6f3;color:#182b2b;font:16px/1.6 system-ui,sans-serif}main{width:100%;max-width:400px;border-top:5px solid #146c61;padding:32px;background:white;border-radius:12px}h1{font:normal 44px Georgia,serif;margin:0 0 12px}p{color:#637371}label{display:block;margin-top:24px}input,button{width:100%;font:inherit;border-radius:7px;padding:12px;margin-top:8px}input{border:1px solid #a2b9af}button{border:0;background:#146c61;color:white;cursor:pointer;margin-top:16px}:focus-visible{outline:3px solid #c68c21;outline-offset:3px}[role=alert]{color:#a12622}</style>
<main><h1>Sri Lanka</h1><p>Enter the trip password to sign in.</p>${incorrect ? '<p role="alert">Incorrect password. Try again.</p>' : ''}<form method="post" action="/login"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Sign in</button></form></main></html>`, {
    status: incorrect ? 401 : 200,
    headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" }
  });
}

export async function authenticate(request, password) {
  if (!password) return new Response('Site password is not configured', { status: 503, headers });
  const url = new URL(request.url);
  if (url.pathname === '/login' && request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin) return new Response(null, { status: 403, headers });
    if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) {
      return new Response(null, { status: 415, headers });
    }
    const chunks = [];
    let size = 0;
    if (request.body) {
      for await (const chunk of request.body) {
        size += chunk.byteLength;
        if (size > 65536) return new Response(null, { status: 413, headers });
        chunks.push(chunk);
      }
    }
    const body = await new Response(new Blob(chunks)).text();
    const supplied = new URLSearchParams(body).get('password') || '';
    if (!equal(supplied, password)) return loginPage(true);
    const expires = String(Date.now() + sessionSeconds * 1000);
    return new Response(null, { status: 303, headers: {
      ...headers, Location: '/',
      'Set-Cookie': `trip_session=${expires}.${signature(expires, password)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${sessionSeconds}${url.protocol === 'https:' ? '; Secure' : ''}`
    } });
  }
  const cookie = request.headers.get('Cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith('trip_session='))?.slice('trip_session='.length);
  const match = cookie?.match(/^(\d{13})\.([a-f0-9]{64})$/);
  if (match && Number(match[1]) > Date.now() && equal(match[2], signature(match[1], password))) return null;
  if (url.pathname.startsWith('/api/')) return new Response(null, { status: 401, headers });
  return loginPage();
}

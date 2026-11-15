import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import worker from './cloudflare.mjs';
import app from './worker.mjs';

const origin = 'https://sri-lanka.giouliscloud.gr';
const password = 'x';
const env = { SITE_PASSWORD: password };
const request = (path = '/', options = {}) => new Request(origin + path, options);
async function login(settings = env, supplied = settings.SITE_PASSWORD) {
  const response = await worker.fetch(request('/login', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: supplied })
  }), settings);
  assert.equal(response.status, 303);
  return response.headers.get('Set-Cookie').split(';')[0];
}
const cookie = await login();

test('requires a configured password', async () => {
  for (const SITE_PASSWORD of [undefined, '']) {
    assert.equal((await worker.fetch(request(), { SITE_PASSWORD })).status, 503);
  }
});

test('shows a password-only form and protects APIs against forged identity headers', async () => {
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /name="password"/);
  assert.doesNotMatch(html, /name="username"|minlength|pattern=/);
  for (const path of ['/api/answers', '/api/comments?section=flights']) {
    const denied = await worker.fetch(request(path, { headers: {
      Cookie: cookie + 'tampered', 'oai-authenticated-user-id': 'forged'
    } }), env);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('Cache-Control'), 'no-store');
  }
});

test('login pages preserve the browser form Origin header', async () => {
  for (const response of [
    await worker.fetch(request(), env),
    await worker.fetch(request('/login', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: 'wrong' })
    }), env)
  ]) {
    // no-referrer makes native form submissions send Origin: null and fail CSRF checks.
    assert.equal(response.headers.get('Referrer-Policy'), 'same-origin');
  }
  const denied = await worker.fetch(request('/login', {
    method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password })
  }), env);
  assert.equal(denied.status, 403);
});

test('serves the page after password-only authentication with a one-character password', async () => {
  const response = await worker.fetch(request('/', { headers: { Cookie: cookie } }), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Day-by-day/);
});

test('rejects wrong passwords, cross-origin logins, oversized forms, and cookies from an old password', async () => {
  for (const [supplied, source, status] of [['wrong', origin, 401], [password, 'https://other.example', 403], ['x'.repeat(65537), origin, 413]]) {
    const response = await worker.fetch(request('/login', {
      method: 'POST', headers: { Origin: source, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ password: supplied })
    }), env);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('Set-Cookie'), null);
  }
  assert.equal((await worker.fetch(request('/api/answers', { headers: { Cookie: cookie } }), { SITE_PASSWORD: 'changed' })).status, 401);
});

test('sets a signed, expiring, secure session cookie without the password', async () => {
  const response = await worker.fetch(request('/login', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: 'cookie-test-password' })
  }), { SITE_PASSWORD: 'cookie-test-password' });
  const value = response.headers.get('Set-Cookie');
  assert.match(value, /HttpOnly/);
  assert.match(value, /SameSite=Strict/);
  assert.match(value, /Secure/);
  assert.match(value, /Max-Age=/);
  assert.doesNotMatch(value, /cookie-test-password/);
  assert.equal(response.headers.get('Location'), '/');
});

test('accepts spaces and Unicode in passwords without complexity rules', async () => {
  const settings = { SITE_PASSWORD: ' 日本 : ' };
  const session = await login(settings);
  assert.equal((await worker.fetch(request('/', { headers: { Cookie: session } }), settings)).status, 200);
});

test('rejects expired session cookies', async t => {
  const future = Date.now() + 31 * 24 * 60 * 60 * 1000;
  t.mock.method(Date, 'now', () => future);
  assert.equal((await worker.fetch(request('/api/answers', { headers: { Cookie: cookie } }), env)).status, 401);
});

test('rejects oversized authenticated bodies', async () => {
  const response = await worker.fetch(request('/api/answers', {
    method: 'POST', headers: { Cookie: cookie, Origin: origin }, body: 'x'.repeat(65537)
  }), env);
  assert.equal(response.status, 413);
});

test('uses Supabase REST and an atomic save function without exposing the key', async t => {
  const calls = [];
  const responses = [Response.json([]), Response.json(1), Response.json(null),
    new Response(null, { status: 201 }), Response.json([{ author: 'Maria', body: 'Hi', quote: '' }])];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: new URL(url), ...options });
    return responses.shift();
  });
  const settings = { ...env, SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' };
  const call = (path, body) => worker.fetch(request(path, {
    method: body ? 'POST' : 'GET',
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  }), settings);
  assert.deepEqual(await (await call('/api/answers')).json(), { answers: {}, revision: 0 });
  const answers = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, 'Answer']));
  assert.deepEqual(await (await call('/api/answers', { answers, revision: 0 })).json(), { revision: 1 });
  assert.equal((await call('/api/answers', { answers, revision: 0 })).status, 409);
  assert.equal((await call('/api/comments?section=flights', { author: 'Maria', body: 'Hi' })).status, 201);
  assert.deepEqual(await (await call('/api/comments?section=flights')).json(), [{ author: 'Maria', body: 'Hi', quote: '' }]);
  assert.equal(calls[0].url.pathname, '/rest/v1/sri_lanka_answers');
  assert.equal(calls[1].url.pathname, '/rest/v1/rpc/sri_lanka_save_answers');
  assert.deepEqual(JSON.parse(calls[1].body), { new_answers: answers, expected_revision: 0 });
  assert.equal(calls[3].url.pathname, '/rest/v1/sri_lanka_comments');
  assert.deepEqual(JSON.parse(calls[3].body), { section: 'flights', author: 'Maria', body: 'Hi', quote: '' });
  assert.equal(calls[4].url.searchParams.get('section'), 'eq.flights');
  for (const call of calls) {
    assert.equal(call.url.origin, settings.SUPABASE_URL);
    assert.equal(call.headers.apikey, settings.SUPABASE_SECRET_KEY);
    assert.equal(call.headers.Authorization, undefined);
  }
});

test('returns a generic error when Supabase fails', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('private database details', { status: 500 }));
  t.mock.method(console, 'error', () => {});
  const response = await worker.fetch(request('/api/answers', { headers: { Cookie: cookie } }), {
    ...env, SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test'
  });
  assert.equal(response.status, 500);
  assert.equal(await response.text(), 'Server error');
});

test('persists comments and answers and preserves origin and revision checks', async () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync('migrations/' + file, 'utf8'));
    }
    const DB = { prepare(sql) {
      const statement = sqlite.prepare(sql);
      const bound = (values = []) => ({
        bind: (...args) => bound(args),
        first: async () => statement.get(...values),
        all: async () => ({ results: statement.all(...values) }),
        run: async () => ({ meta: { changes: statement.run(...values).changes } })
      });
      return bound();
    } };
    const call = (path, body, source = origin) => app.fetch(request(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'oai-authenticated-user-id': 'test', Origin: source, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }), { ...env, DB });
    const comment = { author: 'Maria', body: 'Test comment', quote: 'Flights' };
    assert.equal((await call('/api/comments?section=flights', comment, 'https://other.example')).status, 403);
    assert.equal((await call('/api/comments?section=flights', comment)).status, 201);
    assert.deepEqual(await (await call('/api/comments?section=flights')).json(), [comment]);
    const payload = { revision: 0, answers: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i, 'Answer'])) };
    assert.equal((await call('/api/answers', payload, 'https://other.example')).status, 403);
    assert.equal((await call('/api/answers', payload)).status, 200);
    assert.deepEqual(await (await call('/api/answers')).json(), { ...payload, revision: 1 });
    assert.equal((await call('/api/answers', payload)).status, 409);
  } finally {
    sqlite.close();
  }
});

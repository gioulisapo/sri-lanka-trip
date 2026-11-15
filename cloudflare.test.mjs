import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import worker from './cloudflare.mjs';
import app from './worker.mjs';

const origin = 'https://sri-lanka.giouliscloud.gr';
const password = 'a-long-test-password';
const authorization = 'Basic ' + Buffer.from('traveller:' + password).toString('base64');
const env = { SITE_PASSWORD: password };
const request = (path = '/', options = {}) => new Request(origin + path, options);

test('requires a configured strong password', async () => {
  for (const SITE_PASSWORD of [undefined, '', 'short']) {
    assert.equal((await worker.fetch(request(), { SITE_PASSWORD })).status, 503);
  }
});

test('protects the page and APIs, including forged identity headers', async () => {
  for (const path of ['/', '/api/answers', '/api/comments?section=flights']) {
    for (const supplied of ['', 'Basic invalid', 'Bearer token']) {
      const response = await worker.fetch(request(path, { headers: {
        authorization: supplied, 'oai-authenticated-user-id': 'forged'
      } }), env);
      assert.equal(response.status, 401);
      assert.match(response.headers.get('WWW-Authenticate'), /^Basic /);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
    }
  }
});

test('serves the page after authentication', async () => {
  const response = await worker.fetch(request('/', { headers: { authorization } }), env);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Sri Lanka/);
});

test('supports configured usernames', async () => {
  const headers = { authorization: 'Basic ' + Buffer.from('family:' + password).toString('base64') };
  assert.equal((await worker.fetch(request('/', { headers }), { ...env, SITE_USER: 'family' })).status, 200);
  assert.equal((await worker.fetch(request('/', { headers: { authorization } }), { ...env, SITE_USER: 'family' })).status, 401);
});

test('rejects oversized authenticated bodies', async () => {
  const response = await worker.fetch(request('/api/answers', {
    method: 'POST', headers: { authorization, Origin: origin }, body: 'x'.repeat(65537)
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
    headers: { authorization, Origin: origin, 'Content-Type': 'application/json' },
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
  const response = await worker.fetch(request('/api/answers', { headers: { authorization } }), {
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

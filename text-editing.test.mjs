import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import app from './worker.mjs';
import hosted from './cloudflare.mjs';
import { supabaseStore } from './storage.mjs';

const origin = 'https://trip.example';
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync('migrations/' + file, 'utf8'));
  const DB = { prepare(sql) {
    const stmt = sqlite.prepare(sql);
    const bound = (args = []) => ({
      bind: (...values) => bound(values), first: async () => stmt.get(...args),
      run: async () => ({ meta: { changes: stmt.run(...args).changes } })
    });
    return bound();
  } };
  return { sqlite, DB };
}
const call = (DB, payload, source = origin) => app.fetch(new Request(origin + '/api/text', {
  method: payload === undefined ? 'GET' : 'POST',
  headers: { 'oai-authenticated-user-id': 'test', Origin: source },
  body: payload === undefined ? undefined : JSON.stringify(payload)
}), { DB });

test('shared text saves persist patches without losing other text and reject stale revisions', async () => {
  const { sqlite, DB } = database();
  try {
    assert.deepEqual(await (await call(DB)).json(), { edits: {}, revision: 0 });
    const first = { edits: { 'todo-documents-1': '<img src=x onerror=alert(1)>' }, revision: 0 };
    assert.equal((await call(DB, first, 'https://other.example')).status, 403);
    assert.deepEqual(await (await call(DB, first)).json(), { revision: 1 });
    assert.equal((await call(DB, first)).status, 409);
    assert.deepEqual(await (await call(DB, { edits: { 'todo-documents-2': 'Book tonight' }, revision: 1 })).json(), { revision: 2 });
    assert.deepEqual(await (await call(DB)).json(), {
      edits: { ...first.edits, 'todo-documents-2': 'Book tonight' }, revision: 2
    });
    assert.equal((await call(DB)).headers.get('Cache-Control'), 'no-store');
  } finally { sqlite.close(); }
});

test('text editing validates keys, values, revisions and authentication', async () => {
  const { sqlite, DB } = database();
  try {
    for (const payload of [null, {}, { revision: -1, edits: {} }, { revision: 0, edits: [] },
      { revision: 0, edits: { '__proto__': 'bad', unknown: 'text' } },
      { revision: 0, edits: { 'todo-documents-1': null } },
      { revision: 0, edits: { 'todo-documents-1': 'x'.repeat(5001) } }]) {
      assert.equal((await call(DB, payload)).status, 400, JSON.stringify(payload));
    }
    assert.equal((await app.fetch(new Request(origin + '/api/text'), { DB })).status, 401);
    assert.equal((await hosted.fetch(new Request(origin + '/api/text', {
      headers: { 'oai-authenticated-user-id': 'forged' }
    }), { SITE_PASSWORD: 'x' })).status, 401);
  } finally { sqlite.close(); }
});

test('Supabase text adapter uses the existing secret and atomic revision RPC', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: new URL(url), options });
    return Response.json(calls.length === 1 ? [] : calls.length === 2 ? 1 : null);
  });
  const store = supabaseStore({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' });
  assert.deepEqual(await store.getText(), { edits: {}, revision: 0 });
  assert.equal(await store.saveText({ 'todo-documents-1': 'Updated' }, 0), 1);
  assert.equal(await store.saveText({ 'todo-documents-1': 'Stale' }, 0), null);
  assert.equal(calls[0].url.pathname, '/rest/v1/sri_lanka_text');
  assert.equal(calls[1].url.pathname, '/rest/v1/rpc/sri_lanka_save_text');
  assert.deepEqual(JSON.parse(calls[1].options.body), { new_edits: { 'todo-documents-1': 'Updated' }, expected_revision: 0 });
});

async function editor(responses, original = 'Original') {
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync('site.html', 'utf8').match(/\/\/ Shared text editing\.[\s\S]*?\/\/ End shared text editing\./)?.[0];
  assert.ok(source, 'Missing text editor');
  const node = (text = '') => ({
    textContent: text, hidden: false, disabled: false, dataset: {}, attrs: {}, events: {},
    get innerText() { return this.textContent; },
    set innerText(value) { this.textContent = value; },
    setAttribute(key, value) { this.attrs[key] = value; },
    removeAttribute(key) { delete this.attrs[key]; },
    addEventListener(type, handler) { this.events[type] = handler; }, focus() {}
  });
  const text = node(original); text.dataset.editId = 'todo-documents-1';
  const nodes = Object.fromEntries(['#text-editor', '#edit-text', '#save-text', '#cancel-text', '#text-edit-status'].map(key => [key, node()]));
  const controls = [node(), node()];
  const calls = [], listeners = {};
  const document = {
    querySelector: key => nodes[key],
    querySelectorAll: key => key === '[data-edit-id]' ? [text] : controls,
    createElement: () => node(),
    body: { classList: { toggle() {} } }
  };
  runInNewContext(source, {
    document, window: { addEventListener: (name, cb) => { listeners[name] = cb; } },
    Object, TextEncoder, AbortSignal,
    fetch: async (path, options) => {
      calls.push({ path, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    }
  });
  await new Promise(setImmediate);
  return { nodes, controls, text, calls, listeners };
}

test('editor restores cancelled text and renders saved markup literally', async () => {
  const saved = { edits: { 'todo-documents-1': '<img src=x onerror=alert(1)>' }, revision: 3 };
  const e = await editor([Response.json(saved), Response.json(saved)]);
  assert.equal(e.text.textContent, saved.edits['todo-documents-1']);
  await e.nodes['#edit-text'].events.click();
  assert.equal(e.text.attrs.contenteditable, 'plaintext-only');
  assert.ok(e.controls.every(control => control.disabled));
  e.text.textContent = 'Unsaved';
  let blocked = false;
  e.listeners.beforeunload({ preventDefault() { blocked = true; } });
  assert.ok(blocked);
  e.nodes['#cancel-text'].events.click();
  assert.equal(e.text.textContent, saved.edits['todo-documents-1']);
  assert.ok(e.controls.every(control => !control.disabled));
});

test('save sends only changed text and keeps drafts after conflicts and network errors', async () => {
  const saved = { edits: {}, revision: 0 };
  const e = await editor([Response.json(saved), Response.json(saved), new Response(null, { status: 409 }), new Error('Offline'), Response.json({ revision: 1 })]);
  await e.nodes['#edit-text'].events.click();
  e.text.textContent = 'New task';
  await e.nodes['#save-text'].events.click();
  assert.equal(e.text.textContent, 'New task');
  assert.equal(e.nodes['#cancel-text'].hidden, false);
  assert.match(e.nodes['#text-edit-status'].textContent, /Someone else/);
  await e.nodes['#save-text'].events.click();
  assert.equal(e.text.textContent, 'New task');
  assert.match(e.nodes['#text-edit-status'].textContent, /failed/);
  await e.nodes['#save-text'].events.click();
  assert.deepEqual(JSON.parse(e.calls.at(-1).options.body), { edits: { 'todo-documents-1': 'New task' }, revision: 0 });
  assert.equal(e.nodes['#edit-text'].hidden, false);
  assert.match(e.nodes['#text-edit-status'].textContent, /Saved/);
});

test('failed initial load does not enable editing over missing shared state', async () => {
  const e = await editor([new Error('Offline'), new Error('Offline')]);
  await e.nodes['#edit-text'].events.click();
  assert.equal(e.text.attrs.contenteditable, undefined);
  assert.equal(e.nodes['#save-text'].hidden, true);
  assert.match(e.nodes['#text-edit-status'].textContent, /Could not load/);
});

test('formatted HTML whitespace is collapsed while saved line breaks are preserved', async () => {
  const e = await editor([Response.json({ edits: {}, revision: 0 })], 'A formatted\n    paragraph');
  assert.equal(e.text.textContent, 'A formatted paragraph');
  const saved = await editor([Response.json({ edits: { 'todo-documents-1': 'Line one\nLine two' }, revision: 1 })]);
  assert.equal(saved.text.textContent, 'Line one\nLine two');
});

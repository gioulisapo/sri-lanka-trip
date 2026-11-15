import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import worker from './worker.mjs';

test('hides answered questions and preserves their original keys when saving new answers', async () => {
  const html = await (await worker.fetch(new Request('https://trip.example/'), {})).text();
  const script = html.match(/const questions=\[[\s\S]*?loadAnswers\(\);/)[0];
  const fields = new Map();
  const form = {
    elements: { namedItem: key => fields.get(key) },
    replaceChildren: () => fields.clear(),
    append: label => label.children.forEach(field => fields.set(field.name, field))
  };
  const buttons = Object.fromEntries(['#save-answers', '#copy-answers'].map(id => [id, {
    addEventListener(type, callback) { this.click = callback; }
  }]));
  const elements = { '#questionnaire': form, '#answer-status': {}, '#copy-output': {}, ...buttons };
  const previous = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [String(i), '']));
  Object.assign(previous, { 2: 'Surfing and scuba diving', 5: 'Yes, independent transfer', 6: 'No Horton Plains' });
  let payload;
  const context = {
    document: {
      querySelector: selector => elements[selector],
      createElement: () => ({ children: [], append(child) { this.children.push(child); } })
    },
    FormData: class { constructor() { return new Map([...fields].map(([key, field]) => [key, field.value])); } },
    fetch: async (url, options) => {
      if (!options) return Response.json({ answers: previous, revision: 7 });
      payload = JSON.parse(options.body);
      return Response.json({ revision: 8 });
    },
    navigator: { clipboard: { writeText: async () => {} } }
  };
  runInNewContext(script, context);
  await new Promise(setImmediate);
  assert.deepEqual([...fields.keys()], ['8', '9', '10', '11']);
  fields.get('9').value = 'Driver budget: 100';
  await buttons['#save-answers'].click();
  assert.equal(payload.revision, 7);
  assert.equal(Object.keys(payload.answers).length, 12);
  assert.equal(payload.answers['5'], previous['5']);
  assert.equal(payload.answers['6'], previous['6']);
  assert.equal(payload.answers['9'], 'Driver budget: 100');
  assert.equal(payload.answers['2'], 'One day of scuba diving; no surfing.');
  assert.deepEqual([...fields.keys()], ['8', '10', '11']);
});

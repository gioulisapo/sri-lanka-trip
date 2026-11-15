import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext, Script } from 'node:vm';
import worker from './worker.mjs';

test('conditional culture stops and optional coastal routes are represented on the map', async () => {
  const html = await (await worker.fetch(new Request('https://trip.example/'), {})).text();
  for (const [, source] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(source);
  assert.ok(html.includes('id="culture-select"'));
  assert.ok(html.includes('id="hike-select"'));
  const script = html.slice(html.indexOf('const points=['), html.indexOf('function choosePlan(){'));
  const lines = [];
  const controls = { '#culture-select': { value: 'polonnaruwa' }, '#hike-select': { value: 'stage13' }, '#map-state': {} };
  const context = {
    lines, document: { querySelector: query => controls[query] },
    L: { polyline: (coordinates, options) => { lines.push({ coordinates, options }); return { addTo() {} }; } }
  };
  runInNewContext(script + '; mainMap={}; routeLayers={clearLayers(){lines.length=0}}; globalThis.mapPoints=points;', context);
  const contains = (line, name) => {
    const point = context.mapPoints.find(point => point[0].includes(name));
    assert.ok(point, 'Missing map point: ' + name);
    return line.coordinates.some(coord => coord[0] === point[2] && coord[1] === point[3]);
  };
  for (const plan of ['A', 'B', 'C']) {
    context.drawRoutes(plan);
    assert.ok(lines.some(line => contains(line, 'Polonnaruwa') && line.options.dashArray));
    assert.ok(lines.some(line => contains(line, 'Colombo culture') && line.options.dashArray));
    assert.ok(lines.some(line => contains(line, 'Mirissa') && line.options.dashArray));
  }
  controls['#culture-select'].value = 'dambulla';
  controls['#hike-select'].value = 'ella';
  context.drawRoutes('A');
  assert.ok(!lines.some(line => contains(line, 'Polonnaruwa')));
  assert.ok(lines.some(line => contains(line, 'Ella Rock') && !line.options.dashArray));
  assert.ok(lines.some(line => contains(line, 'Haputale') && line.options.dashArray));
});

test('every trip day has a proposed breakdown and plan switching shows the matching tracks', async () => {
  const html = await (await worker.fetch(new Request('https://trip.example/'), {})).text();
  for (let day = 4; day <= 17; day++) {
    assert.ok(html.includes('data-schedule-day="' + day + '"'), 'Missing schedule for ' + day + ' December');
  }
  const choosePlan = html.match(/function choosePlan\(\)\{[\s\S]*?\n\}/)[0];
  const tracks = [
    { plans: 'ABC' }, { plans: 'AB', hike: 'stage13' }, { plans: 'AB', hike: 'ella' },
    { plans: 'C' }, { plans: 'ABC', culture: 'polonnaruwa' }, { plans: 'ABC', culture: 'dambulla' }
  ].map(dataset => ({ dataset, hidden: false }));
  const cards = new Map();
  for (const day of ['6', '9', '10', '11', '12']) {
    const fields = Object.fromEntries(['.date', 'h3', '.sub', '.travel-links', '.day-highlights'].map(key => [key, {
      dataset: { a: 'Default', b: 'Together', c: 'Diving' }, textContent: '', hidden: false
    }]));
    cards.set(day, { fields, querySelector: selector => fields[selector] });
  }
  const controls = {
    '#culture-select': { value: 'polonnaruwa' }, '#hike-select': { value: 'stage13' },
    '#hike-choice': { hidden: false }, '#plan-detail': {}
  };
  const selector = { value: 'A' };
  const context = {
    selector, planTexts: { A: 'Default', B: 'Together', C: 'Diving' }, drawRoutes() {},
    document: {
      querySelector: query => controls[query] || cards.get(query.match(/data-date="(\d+)"/)[1]),
      querySelectorAll: query => query === '.schedule-track[data-plans]' ? tracks : []
    }
  };
  runInNewContext(choosePlan, context);
  for (const culture of ['polonnaruwa', 'dambulla']) for (const hike of ['stage13', 'ella']) for (const plan of ['B', 'C', 'A']) {
    controls['#culture-select'].value = culture;
    controls['#hike-select'].value = hike;
    selector.value = plan;
    context.choosePlan();
    const effectiveHike = plan === 'C' ? 'ella' : hike;
    assert.equal(controls['#plan-detail'].textContent, context.planTexts[plan]);
    assert.equal(controls['#hike-choice'].hidden, plan === 'C');
    for (const track of tracks) {
      const visible = track.dataset.plans.includes(plan) && (!track.dataset.hike || track.dataset.hike === effectiveHike) && (!track.dataset.culture || track.dataset.culture === culture);
      assert.equal(track.hidden, !visible, 'Wrong track visibility for ' + [plan, culture, hike]);
    }
    if (plan !== 'C') assert.match(cards.get('10').fields.h3.textContent, new RegExp(hike === 'stage13' ? 'Pekoe Stage 13' : 'Ella Rock'));
  }
  const comments = await worker.fetch(new Request('https://trip.example/api/comments?section=dec-4', {
    headers: { 'oai-authenticated-user-id': 'test' }
  }), { STORE: { getComments: async section => { assert.equal(section, 'dec-4'); return []; } } });
  assert.equal(comments.status, 200);
});

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

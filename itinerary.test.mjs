import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext, Script } from 'node:vm';
import worker from './worker.mjs';

test('required Polonnaruwa and optional coastal routes are represented on the map', async () => {
  const html = await (await worker.fetch(new Request('https://trip.example/'), {})).text();
  for (const [, source] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(source);
  assert.ok(!html.includes('id="culture-select"'));
  assert.ok(html.includes('Sigiriya + Polonnaruwa · required'));
  assert.ok(html.includes('id="hike-select"'));
  const script = html.slice(html.indexOf('const points=['), html.indexOf('function choosePlan(){'));
  const lines = [];
  const controls = { '#hike-select': { value: 'stage13' }, '#map-state': {} };
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
    assert.ok(lines.some(line => contains(line, 'Polonnaruwa') && !line.options.dashArray));
    assert.ok(lines.some(line => contains(line, 'Colombo culture') && line.options.dashArray));
    assert.ok(lines.some(line => contains(line, 'Mirissa') && line.options.dashArray));
  }
  controls['#hike-select'].value = 'ella';
  context.drawRoutes('A');
  assert.ok(lines.some(line => contains(line, 'Polonnaruwa') && !line.options.dashArray));
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
    { plans: 'C' }
  ].map(dataset => ({ dataset, hidden: false }));
  const cards = new Map();
  for (const day of ['6', '9', '10', '11', '12']) {
    const fields = Object.fromEntries(['.date', 'h3', '.sub', '.travel-links', '.day-highlights'].map(key => [key, {
      dataset: { a: 'Default', b: 'Together', c: 'Diving' }, textContent: '', hidden: false
    }]));
    cards.set(day, { fields, querySelector: selector => fields[selector] });
  }
  const controls = {
    '#hike-select': { value: 'stage13' },
    '#hike-choice': { hidden: false }, '#plan-detail': {}
  };
  const selector = { value: 'A' };
  const context = {
    selector, planTexts: { A: 'Default', B: 'Together', C: 'Diving' }, drawRoutes() {}, dailyMaps: new Map(), drawDailyRoute() {},
    document: {
      querySelector: query => controls[query] || cards.get(query.match(/data-date="(\d+)"/)[1]),
      querySelectorAll: query => query === '.schedule-track[data-plans]' ? tracks : []
    }
  };
  runInNewContext(choosePlan, context);
  for (const hike of ['stage13', 'ella']) for (const plan of ['B', 'C', 'A']) {
    controls['#hike-select'].value = hike;
    selector.value = plan;
    context.choosePlan();
    const effectiveHike = plan === 'C' ? 'ella' : hike;
    assert.equal(controls['#plan-detail'].textContent, context.planTexts[plan]);
    assert.equal(controls['#hike-choice'].hidden, plan === 'C');
    for (const track of tracks) {
      const visible = track.dataset.plans.includes(plan) && (!track.dataset.hike || track.dataset.hike === effectiveHike);
      assert.equal(track.hidden, !visible, 'Wrong track visibility for ' + [plan, hike]);
    }
    if (plan !== 'C') assert.match(cards.get('10').fields.h3.textContent, new RegExp(hike === 'stage13' ? 'Pekoe Stage 13' : 'Ella Rock'));
  }
  const comments = await worker.fetch(new Request('https://trip.example/api/comments?section=dec-4', {
    headers: { 'oai-authenticated-user-id': 'test' }
  }), { STORE: { getComments: async section => { assert.equal(section, 'dec-4'); return []; } } });
  assert.equal(comments.status, 200);
});

test('daily maps follow the selected day, traveller split and hike, including return legs', async () => {
  const html = await (await worker.fetch(new Request('https://trip.example/'), {})).text();
  const script = html.slice(html.indexOf('const points=['), html.indexOf('function choosePlan(){'));
  const context = {};
  runInNewContext(script + ';globalThis.mapPoints=points;', context);
  const routes = (day, plan='A', hike='stage13') => JSON.parse(JSON.stringify(context.dailyRoutes(day, plan, hike)));
  const has = (routes, ids, optional=false) => routes.some(route => JSON.stringify(route.ids) === JSON.stringify(ids) && route.optional === optional);
  for (const plan of ['A','B','C']) for (const hike of ['stage13','ella']) {
    for (let day=4; day<=17; day++) assert.ok(routes(day,plan,hike).length, 'Missing route for '+day);
    assert.ok(has(routes(6,plan,hike), [1,14,1]), 'Required Polonnaruwa return route');
    assert.ok(!routes(6,plan,hike).some(route=>route.ids.includes(2)), 'No Dambulla fallback on 6 Dec');
    assert.ok(has(routes(7,plan,hike), [1,3,4]));
    assert.ok(has(routes(8,plan,hike), [4,5,4]));
    assert.ok(has(routes(15,plan,hike), [10,11,10]), 'Galle returns to coast accommodation');
    assert.ok(has(routes(16,plan,hike), [10,15,12], true));
    assert.ok(has(routes(17,plan,hike), [12,13]));
  }
  assert.ok(has(routes(5), [0,2,1], true));
  assert.ok(has(routes(9), [4,9]));
  assert.ok(!routes(9,'B').some(route=>route.ids.includes(9)));
  assert.ok(has(routes(10), [6,7,18,6]), 'Stage 13 is point-to-point with finish pickup');
  assert.ok(has(routes(10,'B','ella'), [6,17,6]));
  assert.ok(has(routes(10,'C'), [6,17,6,10]));
  assert.ok(has(routes(11), [6,17,6], true));
  assert.ok(has(routes(11,'B','ella'), [6,7,18,6], true));
  assert.ok(has(routes(12), [6,8]));
  assert.ok(has(routes(12,'C'), [10,8]));
  assert.ok(has(routes(13), [8,10], true), 'Park overnight shifts transfer to next day');
  const rendered = [];
  const layer = { clearLayers() { rendered.length=0; } };
  const map = { fitBounds(coords, options) { this.bounds=coords; this.options=options; } };
  const caption = {};
  Object.assign(context, {
    selector: { value:'A' },
    document: { querySelector: () => ({ value:'stage13' }) },
    L: {
      polyline(coords, options) { rendered.push({coords,options}); return { addTo() { return this; }, bindPopup() { return this; } }; },
      circleMarker() { return { addTo() { return this; }, bindPopup() { return this; } }; }
    }
  });
  const view = { day:10, map, layer, caption };
  context.drawDailyRoute(view);
  assert.ok(rendered.some(line => line.coords.some(coord=>coord[0]===context.mapPoints[18][2])));
  context.selector.value='C';
  context.drawDailyRoute(view);
  assert.ok(!rendered.some(line=>line.coords.some(coord=>coord[0]===context.mapPoints[18][2])), 'Old hike removed on plan switch');
  assert.ok(rendered.some(line=>line.coords.some(coord=>coord[0]===context.mapPoints[10][2])));
  assert.match(caption.textContent, /Ella/);
  assert.equal(map.options.maxZoom,12);
  assert.ok(!html.includes('const prev=cards[i-1]'));
});

test('Apostolos return ticket and airport clock times replace the provisional flight', async () => {
  const html = await (await worker.fetch(new Request('https://trip.example/'), {})).text();
  const flights = html.match(/<section[^>]*id="flights"[\s\S]*?<\/section>/)[0];
  assert.match(flights, /RETURN · 17–18 DEC/);
  assert.match(flights, /17 Dec · 6E 1170 CMB 20:05 → DEL 23:55/);
  assert.match(flights, /18 Dec · 6E 1901 DEL 07:20 → ATH 11:55/);
  assert.match(flights, /Delhi layover · 7 h 25 min/);
  assert.ok(!html.includes('Expected departure from Sri Lanka on 17 December'));
  assert.ok(html.includes('datetime="14:30"'));
  assert.ok(html.includes('datetime="16:00"'));
  assert.ok(!html.includes('relative to the unconfirmed return flight'));
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

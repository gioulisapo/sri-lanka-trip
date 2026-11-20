import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext, Script } from 'node:vm';
import worker from './worker.mjs';

const page = async () => (await worker.fetch(new Request('https://trip.example/'), {})).text();
const mapScript = html => html.match(/const points\s*=\s*\[[\s\S]*?(?=function chooseHike\s*\()/)[0];

test('ordinary days retain an 08:00 start and every day has a schedule', async () => {
  const html = await page();
  const schedules = [...html.matchAll(/data-schedule-day="(\d+)"/g)];
  assert.equal(schedules.length, 14);
  for (let i=0; i<schedules.length; i++) {
    const day=Number(schedules[i][1]);
    if ([4,5,8,17].includes(day)) continue;
    const section=html.slice(schedules[i].index,schedules[i+1]?.index??html.indexOf('id="plans"'));
    for (const [,time] of section.matchAll(/<time datetime="(\d\d:\d\d)">/g)) assert.ok(time>='08:00',day+' starts at '+time);
  }
});

test('both hike choices keep shared bridge and safari routes before Maria flies', async () => {
  const html=await page(), context={};
  for(const [,source] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Script(source);
  runInNewContext(mapScript(html),context);
  for(const hike of ['stage13','ella']) {
    const base=hike==='ella'?6:7;
    for(let day=4;day<=17;day++) assert.ok(context.dailyRoutes(day,hike).length,'Missing route '+day);
    const bridgeDay=context.dailyRoutes(9,hike);
    assert.equal(bridgeDay.length,1);
    assert.ok(bridgeDay[0].ids.includes(22),'Shared Nine Arch Bridge visit');
    assert.equal(bridgeDay[0].ids.at(-1),base);
    for(const day of [9,10,11]) for(const route of context.dailyRoutes(day,hike)) assert.equal(route.color,'#146c61','Together on '+day);
    const safari=context.dailyRoutes(11,hike);
    assert.equal(safari.length,1);
    assert.deepEqual(Array.from(safari[0].ids),[base,8]);
    assert.ok(!context.dailyRoutes(10,hike).some(r=>r.ids.includes(10)),'No Maria coast/dive detour');
    assert.ok(context.dailyRoutes(12,hike).some(r=>r.ids[0]===8&&r.ids.at(-1)===13));
    assert.ok(context.dailyRoutes(12,hike).some(r=>r.ids[0]===8&&r.ids.at(-1)===10));
    assert.ok(context.dailyRoutes(14,hike).some(r=>r.ids.includes(10)),'Apostolos keeps diving');
    assert.ok(context.dailyRoutes(6,hike).some(r=>r.ids.includes(14)),'Keep Polonnaruwa');
    assert.ok(context.dailyRoutes(15,hike).some(r=>r.ids.includes(11)),'Keep Galle');
  }
});

test('hike control switches only the hike tracks and matching maps', async () => {
  const html=await page();
  const source=html.match(/function chooseHike\s*\(\)\s*\{[\s\S]*?(?=\n\s*document.querySelector\('#hike-select'\).addEventListener)/)[0];
  const tracks=['stage13','ella'].map(hike=>({dataset:{hike},hidden:false}));
  const heading={}, control={value:'stage13'}, transport={value:'road'};
  const context={document:{querySelector:q=>q==='#hike-select'?control:q==='#transport-select'?transport:heading,querySelectorAll:q=>q.includes('data-hike')?tracks:[]},drawRoutes(){},dailyMaps:new Map(),drawDailyRoute(){}};
  runInNewContext(source,context);
  for(const hike of ['ella','stage13']) {
    control.value=hike;context.chooseHike();
    for(const track of tracks)assert.equal(track.hidden,track.dataset.hike!==hike);
    assert.match(heading.textContent,new RegExp(hike==='ella'?'Ella Rock':'Pekoe Stage 13'));
  }
});

test('daily maps still draw selected hikes without captions', async () => {
  const html=await page(),rendered=[],control={value:'stage13'};
  const context={document:{querySelector:()=>control},L:{
    polyline(coords){rendered.push(coords);return{addTo(){return this},bindPopup(){return this}}},
    circleMarker(){return{addTo(){return this},bindPopup(){return this}}}
  }};
  runInNewContext(mapScript(html)+';globalThis.mapPoints=routePoints;',context);
  const view={day:10,layer:{clearLayers(){rendered.length=0}},map:{fitBounds(){}}};
  context.drawDailyRoute(view);
  assert.ok(rendered.some(line=>line.some(p=>p[0]===context.mapPoints[18][2])));
  control.value='ella';context.drawDailyRoute(view);
  assert.ok(rendered.some(line=>line.some(p=>p[0]===context.mapPoints[17][2])));
  assert.ok(!rendered.some(line=>line.some(p=>p[0]===context.mapPoints[18][2])));
  assert.ok(!html.includes('daily-route-caption'));
});

test('Apostolos return ticket and airport clock times replace the provisional flight', async () => {
  const html = await (await worker.fetch(new Request('https://trip.example/'), {})).text();
  const flights = html.match(/<section[^>]*id="flights"[\s\S]*?<\/section>/)[0].replace(/\s+/g, ' ');
  assert.match(flights, /RETURN · 17–18 DEC/);
  assert.match(flights, /17 Dec · 6E 1170 CMB 20:05 → DEL 23:55/);
  assert.match(flights, /18 Dec · 6E 1901 DEL 07:20 → ATH 11:55/);
  assert.match(flights, /Delhi layover · 7 h 25 min/);
  assert.ok(!html.includes('Expected departure from Sri Lanka on 17 December'));
  assert.ok(html.includes('datetime="14:30"'));
  assert.ok(html.includes('datetime="16:00"'));
  assert.ok(!html.includes('relative to the unconfirmed return flight'));
});

test('removed overview and questionnaire are absent from the page and navigation', async () => {
  const html = await (await worker.fetch(new Request('https://trip.example/'), {})).text();
  for (const removed of ['id="route"', 'href="#route"', 'id="questions"', 'href="#questions"', 'id="questionnaire"', 'loadAnswers', '/api/answers']) {
    assert.ok(!html.includes(removed), 'Still includes ' + removed);
  }
});

test('quick reference links reach the trip sections and the new guides follow the itinerary', async () => {
  const html = await (await worker.fetch(new Request('https://trip.example/'), {})).text();
  const toc = html.match(/<nav[^>]*id="quick-reference"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(toc, 'Missing top table of contents');
  for (const id of ['flights','itinerary','plans','hiking','diving','practical','sources','todo','history','culture','food']) {
    assert.ok(toc.includes('href="#'+id+'"'), 'Missing TOC entry: '+id);
    assert.ok(html.includes('id="'+id+'"'), 'Missing TOC destination: '+id);
  }
  assert.ok(html.indexOf('id="quick-reference"') < html.indexOf('<main>'));
  assert.ok(html.indexOf('id="todo"') > html.indexOf('id="sources"'));
  assert.ok(html.indexOf('id="history"') < html.indexOf('id="culture"'));
  assert.ok(html.indexOf('id="culture"') < html.indexOf('id="food"'));
  assert.match(html, /LKR 100,000 total for both travellers/);
  assert.match(html.replace(/\s+/g, ' '), /Hotels, private drivers, guides, safari and diving are excluded/);
  assert.match(html, /illustration, not a live exchange quote/);
});

test('checklist restores and saves ticks locally, and remains usable if storage fails', async () => {
  const html = await (await worker.fetch(new Request('https://trip.example/'), {})).text();
  const script = html.match(/const todoBoxes\s*=[\s\S]*?\/\/ End trip checklist\./)?.[0];
  assert.ok(script, 'Missing checklist script');
  const setup = (saved, failure) => {
    const boxes = ['todo-cash','todo-driver'].map(id => ({ id, checked:false, addEventListener(type,callback) { this.change=callback; } }));
    const status = {};
    let stored;
    const context = {
      document: { querySelectorAll: () => boxes, querySelector: () => status },
      localStorage: {
        getItem() { if(failure==='read')throw Error('Blocked');return saved; },
        setItem(key,value) { if(failure==='write')throw Error('Full');stored={key,value}; }
      }
    };
    runInNewContext(script, context);
    return {boxes,status,get stored(){return stored;}};
  };
  const state=setup('["todo-cash","unknown"]');
  assert.equal(state.boxes[0].checked,true);
  assert.equal(state.boxes[1].checked,false);
  state.boxes[1].checked=true;
  state.boxes[1].change();
  assert.deepEqual(JSON.parse(state.stored.value),['todo-cash','todo-driver']);
  assert.match(state.status.textContent,/browser only/);
  state.boxes[0].checked=false;
  state.boxes[0].change();
  assert.deepEqual(JSON.parse(state.stored.value),['todo-driver']);
  for(const saved of ['{broken','{}','null'])assert.doesNotThrow(()=>setup(saved));
  const denied=setup(null,'read');
  assert.match(denied.status.textContent,/not be restored/);
  const full=setup(null,'write');full.boxes[0].checked=true;
  assert.doesNotThrow(()=>full.boxes[0].change());
  assert.equal(full.boxes[0].checked,true);
  assert.match(full.status.textContent,/not saved/);
});

test('one shared itinerary includes the bridge and safari with no Maria diving', async () => {
  const html=await page();
  for(const removed of ['id="plan-select"','data-plans=','Maria misses','B/C','Maria dives','independent coast','before splitting','one dive day']) assert.ok(!html.includes(removed),'Stale plan: '+removed);
  assert.match(html,/Nine Arch Bridge · together/);
  assert.match(html,/Maria has no diving scheduled/);
  assert.match(html,/Together · afternoon safari and Udawalawe overnight/);
  assert.match(html,/Shared transfer to Udawalawe/);
});

test('shared scenic train option crosses Nine Arch Bridge before Demodara without changing the safari', async () => {
  const html=await page(),context={};runInNewContext(mapScript(html),context);
  for(const hike of ['stage13','ella']) {
    const train=context.dailyRoutes(9,hike,'train')[0];
    assert.equal(train.color,'#146c61');
    assert.deepEqual(Array.from(train.ids).slice(0,5),[4,23,6,22,24]);
    assert.equal(train.ids.at(-1),hike==='ella'?6:7);
    assert.ok(!context.dailyRoutes(9,hike,'road')[0].ids.includes(23));
    assert.equal(context.dailyRoutes(11,hike,'train')[0].ids.at(-1),8);
  }
  assert.match(html,/id="transport-select"/);
  assert.match(html,/Nanu Oya → Ella alone ends before Nine Arch Bridge/);
  assert.match(html,/arrival by 14:00/);
});

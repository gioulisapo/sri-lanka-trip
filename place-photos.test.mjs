import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const html = readFileSync('site.html', 'utf8');

test('sightseeing rows have destination photos without changing editable text or meal rows', () => {
  for (const key of ['sigiriya','polonnaruwa','horton','haputale','ella','udawalawe','galle']) {
    assert.ok(html.includes('data-place-photo="'+key+'"'), 'Missing '+key+' photo');
  }
  assert.match(html, /<dialog[^>]*aria-labelledby="place-photo-title"/);
  assert.match(html, /<form method="dialog">/);
  assert.match(html, /id="place-photo-close"[^>]*autofocus/);
  assert.match(html, /data-edit-id="dec-6-7">Sigiriya fortress and gardens/);
});

function preview() {
  const source = html.match(/\/\/ Destination photo previews\.[\s\S]*?\/\/ End destination photo previews\./)?.[0];
  assert.ok(source, 'Missing photo preview script');
  const node = () => ({
    dataset: {}, events: {}, children: [], hidden: false,
    classList: { add() {} },
    setAttribute(key,value) { this[key] = value; },
    addEventListener(type,fn) { this.events[type] = fn; },
    append(...children) { this.children.push(...children); }
  });
  const targets = ['sigiriya','udawalawe','ella'].map(key => Object.assign(node(), { dataset: { placePhoto: key } }));
  const nodes = Object.fromEntries(['#place-photo-dialog','#place-photo-image','#place-photo-title','#place-photo-credit','#place-photo-license','#place-photo-source','#place-photo-error'].map(key => [key,node()]));
  nodes['#place-photo-dialog'].showModal = function() { this.open = true; };
  const document = {
    querySelector: key => nodes[key], querySelectorAll: () => targets,
    createElement: () => node()
  };
  runInNewContext(source, { document });
  return { targets, nodes };
}

test('thumbnail opens its own enlarged image and credit, and another destination replaces it', () => {
  const { targets, nodes } = preview();
  const button = targets[0].children.at(-1);
  assert.equal(button.type, 'button');
  assert.match(button['aria-label'], /Sigiriya/);
  const thumbnail = button.children[0];
  assert.equal(thumbnail.loading, 'lazy');
  assert.ok(thumbnail.width && thumbnail.height);
  button.events.click();
  assert.ok(nodes['#place-photo-dialog'].open);
  assert.match(nodes['#place-photo-image'].src, /1280px/);
  assert.match(nodes['#place-photo-title'].textContent, /Sigiriya/);
  assert.match(nodes['#place-photo-source'].href, /commons.wikimedia.org/);
  targets[1].children.at(-1).events.click();
  assert.match(nodes['#place-photo-title'].textContent, /Udawalawe/);
  assert.match(nodes['#place-photo-image'].src, /Udawalawe/);
});

test('failed images retain a source link and a usable photo control', () => {
  const { targets, nodes } = preview();
  const button = targets[0].children.at(-1);
  button.children[0].events.error();
  assert.equal(button.children[0].hidden, true);
  assert.equal(button.children[1].textContent, 'View photo');
  button.events.click();
  nodes['#place-photo-image'].events.error();
  assert.equal(nodes['#place-photo-error'].hidden, false);
  assert.equal(nodes['#place-photo-image'].hidden, true);
  assert.match(nodes['#place-photo-source'].href, /commons.wikimedia.org/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the real JS interop callbacks without a browser, network or .NET host.
class Element {
  constructor(id = '') {
    this.id = id; this.children = []; this.style = { position: '', visibility: '' };
    this.attributes = {}; this.classes = new Set();
    this.classList = { remove: (...names) => names.forEach(name => this.classes.delete(name)) };
    this.clientTop = 0; this.clientLeft = 0; this.scrollTop = 0; this.scrollLeft = 0;
    this.rect = { top: 0, left: 0, width: 200, height: 200 };
  }
  get childNodes() { return this.children; }
  getBoundingClientRect() { return this.rect; }
  appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); }
  insertBefore(child, next) {
    child.remove(); const index = this.children.indexOf(next);
    child.parentElement = this; this.children.splice(index < 0 ? this.children.length : index, 0, child);
  }
  remove() {
    if (this.parentElement) {
      const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1);
      this.parentElement = null;
    }
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { if (name === 'id') this.id = ''; else delete this.attributes[name]; }
  querySelectorAll(selector) {
    assert.equal(selector, '[id]');
    return this.children.flatMap(child => [...(child.id ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  cloneNode() {
    const copy = new Element(this.id); Object.assign(copy.style, this.style);
    copy.classes = new Set(this.classes); copy.rect = { ...this.rect };
    for (const child of this.children) copy.appendChild(child.cloneNode(true));
    return copy;
  }
}
let active;
globalThis.window = { Sortable: class {
  constructor(element, options) { this.element = element; this.options = options; active = this; }
  destroy() { this.destroyed = true; }
} };
globalThis.getComputedStyle = element => ({ position: element.style.position || 'static' });
const source = await readFile(new URL('../../src/BlazorBlueprint.Primitives/wwwroot/js/primitives/sortable.js', import.meta.url), 'utf8');
const sortable = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

async function fixture(callback = () => Promise.resolve()) {
  const parent = new Element(), list = new Element('route-order');
  parent.rect = { top: 100, left: 20, width: 220, height: 400 }; parent.clientTop = 1; parent.clientLeft = 1;
  parent.scrollTop = 30; parent.scrollLeft = 5;
  list.rect = { top: 140, left: 30, width: 200, height: 600 }; list.scrollTop = 20;
  parent.appendChild(list);
  const first = new Element('first'), second = new Element('second');
  first.style.transform = 'translateY(44px)'; first.style.transition = 'transform 150ms';
  first.classes.add('sortable-chosen'); list.appendChild(second); list.appendChild(first);
  globalThis.document = { getElementById: id => id === list.id ? list : null };
  const calls = [];
  await sortable.init(list.id, '', false, false, true, '.grip', null,
    { invokeMethodAsync: (...args) => { calls.push(args); return callback(); } }, true);
  return { parent, list, first, second, instance: active, calls,
    event: { item: first, to: list, from: list, oldIndex: 0, oldDraggableIndex: 0, newDraggableIndex: 1 } };
}

test('drop snapshot retains styled/clipped ancestors, exact bounds and scrolling without copied animation offsets', async () => {
  let finish; const f = await fixture(() => new Promise(resolve => { finish = resolve; }));
  f.instance.options.onUpdate(f.event);
  const clone = f.parent.children[1];
  assert.ok(clone); assert.equal(clone.parentElement, f.parent);
  assert.equal(clone.style.position, 'absolute'); assert.equal(clone.style.top, '69px'); assert.equal(clone.style.left, '14px');
  assert.equal(clone.style.width, '200px'); assert.equal(clone.style.height, '600px'); assert.equal(clone.scrollTop, 20);
  assert.equal(clone.attributes['aria-hidden'], 'true'); assert.equal(clone.inert, true);
  assert.equal(clone.style.pointerEvents, 'none'); assert.deepEqual(clone.querySelectorAll('[id]'), []);
  assert.equal(clone.children[1].style.transform, 'none'); assert.equal(clone.children[1].style.transition, 'none');
  assert.equal(clone.children[1].classes.has('sortable-chosen'), false);
  assert.equal(f.list.style.visibility, 'hidden'); assert.deepEqual(f.list.children, [f.first, f.second]);
  assert.deepEqual(f.calls, [['OnUpdateJS', 0, 1]]);
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.parent.children, [f.list]); assert.equal(f.list.style.visibility, ''); assert.equal(f.parent.style.position, '');
  sortable.destroy(f.list.id);
});

test('failed server update restores the real list and removes its snapshot', async () => {
  const expected = new Error('Disconnected'), errors = [], log = console.error;
  const f = await fixture(() => Promise.reject(expected));
  try {
    console.error = (...args) => errors.push(args);
    f.instance.options.onUpdate(f.event);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.parent.children, [f.list]); assert.equal(f.list.style.visibility, '');
    assert.equal(errors[0][1], expected);
  } finally { console.error = log; sortable.destroy(f.list.id); }
});

test('destroy during an update restores prior styles and delayed completion is harmless', async () => {
  let finish; const f = await fixture(() => new Promise(resolve => { finish = resolve; }));
  f.parent.style.position = 'relative'; f.list.style.visibility = 'visible';
  f.instance.options.onUpdate(f.event); sortable.destroy(f.list.id);
  assert.equal(f.instance.destroyed, true); assert.equal(f.parent.style.position, 'relative');
  assert.equal(f.list.style.visibility, 'visible'); assert.deepEqual(f.parent.children, [f.list]);
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.parent.children, [f.list]);
});

for (const [event, method] of [['onRemove', 'OnRemoveJS'], ['onAdd', 'OnAddJS']]) {
  test(`${event} uses the same bounded snapshot and cleans up`, async () => {
    const f = await fixture(); f.instance.options[event](f.event);
    assert.equal(f.parent.children[1].parentElement, f.parent);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.calls, [[method, 0, 1]]); assert.deepEqual(f.parent.children, [f.list]);
    assert.equal(f.list.style.visibility, ''); sortable.destroy(f.list.id);
  });
}

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { Element } = require('./helpers/dom.cjs');
const M = require('../reel-motion.js');
function fixture(height, reduce = false) {
    let time = 0, resize; const root = new Element(); root.parentElement = new Element(); root.parentElement.clientHeight = height * 2;
    const frames = new Map(); let serial = 0; const errors = [];
    let preferenceChanged;
    const preference = { matches: reduce, addEventListener(event, fn) { preferenceChanged = fn; }, removeEventListener() { preferenceChanged = null; } };
    const window = { LotteryMotion: M, matchMedia: () => preference };
    vm.runInNewContext(fs.readFileSync(require.resolve('../reel-player.js'), 'utf8'), { window,
        document: { createElement() { const el = new Element(); el.height = height; return el; } },
        getComputedStyle: () => ({ fontSize: '24px' }), ResizeObserver: class { constructor(fn) { resize = fn; } observe() {} disconnect() {} },
        requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; }, cancelAnimationFrame(id) { frames.delete(id); } });
    const player = window.createLotteryReelPlayer(root, 'prize', { now: () => time }, error => errors.push(error));
    return { root, player, errors, frames,
        reduceMotion(value) { preference.matches = value; preferenceChanged?.(); },
        time(t) { time = t; for (const [id, fn] of [...frames]) { frames.delete(id); fn(); } },
        resize(h) { for (const node of root.children) node.height = h; root.parentElement.clientHeight = h * 2; resize(); },
        center() { return root.children.find(node => Math.abs(parseFloat(node.style.transform.slice(11)) - root.parentElement.clientHeight / 2 + node.height / 2) < 1e-5); } };
}
test('shared player has bounded nodes, identical logical positions at different sizes, and ends centered on target identity', () => {
    const order = Array.from({ length: 10 }, (_, i) => ({ optionId: 'id' + i, name: '同名' }));
    const p = M.start(order, 0, 'plan'); p.stop = M.stopping(p, 'id7', 10000000);
    const desktop = fixture(80), phone = fixture(39.3);
    desktop.player.update(p, order); phone.player.update(p, order);
    for (const t of [0, 500, 8000000, p.stop.brakeAt, p.stop.brakeAt + 1234]) {
        desktop.time(t); phone.time(t);
        assert.equal(desktop.player.position(), phone.player.position());
        assert.equal(desktop.root.children.length, 9); assert.equal(phone.root.children.length, 9);
    }
    const before = phone.player.position(); phone.resize(57.8); assert.equal(phone.player.position(), before);
    desktop.time(p.stop.stopAt); phone.time(p.stop.stopAt);
    assert.equal(desktop.center().dataset.optionId, 'id7'); assert.equal(phone.center().dataset.optionId, 'id7');
    assert.equal(desktop.frames.size, 0); assert.equal(phone.frames.size, 0); assert.deepEqual(desktop.errors, []);
});
test('late join and background return resume current time without replay; stale plan cannot undo stopping', () => {
    const order = [{ optionId: '1', name: '1' }, { optionId: '2', name: '1' }];
    const initial = M.start(order, 0, 'plan'); const stopped = { ...initial, planVersion: 2, stop: M.stopping(initial, '2', 500) };
    const f = fixture(80); f.time(1500); f.player.update(stopped, order);
    assert.equal(f.player.position(), M.position(stopped, 1500));
    f.player.update(initial, order); f.time(100000);
    assert.equal(f.center().dataset.optionId, '2'); assert.equal(f.frames.size, 0);
    f.player.refresh(); assert.equal(f.center().dataset.optionId, '2');
});

test('all visible cells stay identical between previous stop, next idle and next start, before smoothly moving', () => {
    const order = Array.from({ length: 5 }, (_, i) => ({ optionId: 'id' + i, name: '獎項' + i }));
    const previous = M.start(order, 0, 'first'); previous.stop = M.stopping(previous, 'id3', 500);
    const f = fixture(80); f.time(5000); f.player.update(previous, order);
    const visible = () => f.root.children.map(node => [node.dataset.optionId, node.style.transform,
        node.firstElementChild.style.transform, node.firstElementChild.style.opacity, node.firstElementChild.style.filter]);
    const before = visible();
    const origin = M.mod(previous.stop.target, order.length);
    f.player.update(null, order, origin); assert.deepEqual(visible(), before);
    const next = M.start(order, 6000, 'next', origin);
    f.player.update(next, order); assert.deepEqual(visible(), before);
    f.time(6000); assert.deepEqual(visible(), before);
    f.time(6001); assert.ok(f.player.position() > origin && f.player.position() < origin + 0.001);
    next.stop = M.stopping(next, 'id1', 6500); next.planVersion = 2;
    f.player.update(next, order); f.time(next.stop.stopAt);
    assert.equal(f.center().dataset.optionId, 'id1'); assert.deepEqual(f.errors, []);
});
test('renaming an existing option updates idle text even when its identity stays the same', () => {
    const f = fixture(80);
    f.player.update(null, [{ optionId: 'same', name: '舊名稱' }]);
    f.player.update(null, [{ optionId: 'same', name: '新名稱' }]);
    assert.equal(f.center().textContent, '新名稱');
});

test('curvature affects labels symmetrically while the centered result keeps its proportions and cell geometry', () => {
    const f = fixture(80);
    f.player.update(null, Array.from({ length: 5 }, (_, i) => ({ optionId: String(i), name: '獎項' + i })));
    const [above, middle, below] = f.root.children.slice(3, 6);
    assert.equal(middle.firstElementChild.style.transform, 'scaleY(1.0000)');
    assert.equal(middle.firstElementChild.style.opacity, '1.0000');
    assert.equal(middle.firstElementChild.style.filter, 'none');
    assert.equal(above.firstElementChild.style.transform, below.firstElementChild.style.transform);
    const scale = Number(above.firstElementChild.style.transform.match(/scaleY\((.+)\)/)[1]);
    assert.ok(scale > 0 && scale < 1);
    assert.match(above.firstElementChild.style.filter, /brightness/);
    assert.equal(above.height, middle.height);
    assert.equal(f.center(), middle);
    assert.equal(f.player.position(), 0);
});

test('blur follows acceleration and braking, scales for small screens, and is cleared at stop and late join', () => {
    const order = Array.from({ length: 5 }, (_, i) => ({ optionId: String(i), name: '獎項' + i }));
    const plan = M.start(order, 0, 'effects'); plan.stop = M.stopping(plan, '2', 1500);
    const desktop = fixture(160), phone = fixture(50);
    const maxBlur = f => Math.max(...f.root.children.map(node => Number(node.firstElementChild.style.filter.match(/blur\(([\d.]+)px\)/)?.[1] || 0)));
    for (const f of [desktop, phone]) f.player.update(plan, order);
    assert.equal(maxBlur(desktop), 0);
    desktop.time(50); const startingBlur = maxBlur(desktop);
    desktop.time(1125); phone.time(1125);
    const fastBlur = maxBlur(desktop);
    assert.ok(fastBlur > startingBlur && fastBlur <= 1.2);
    assert.ok(maxBlur(phone) > 0 && maxBlur(phone) < fastBlur);
    assert.equal(desktop.player.position(), phone.player.position());
    desktop.time(plan.stop.brakeAt + plan.stop.durationMs * .75);
    assert.ok(maxBlur(desktop) > 0 && maxBlur(desktop) < fastBlur);
    desktop.time(plan.stop.stopAt);
    assert.equal(maxBlur(desktop), 0);
    assert.equal(desktop.center().dataset.optionId, '2');
    assert.equal(desktop.center().firstElementChild.style.filter, 'none');
    assert.equal(desktop.frames.size, 0);
    const late = fixture(80); late.time(plan.stop.stopAt + 100); late.player.update(plan, order);
    assert.equal(maxBlur(late), 0);
    assert.equal(late.center().dataset.optionId, '2');
    assert.deepEqual(desktop.errors, []);
});

test('reduced-motion preference disables effects without changing position and is cleaned up on dispose', () => {
    const f = fixture(80, true), order = [{ optionId: '1', name: '咖啡' }];
    f.player.update(M.start(order, 0, 'reduced'), order); f.time(1000);
    const position = f.player.position();
    for (const node of f.root.children) {
        assert.equal(node.firstElementChild.style.transform, 'scaleY(1.0000)');
        assert.equal(node.firstElementChild.style.filter, 'none');
    }
    f.reduceMotion(false);
    assert.ok(f.root.children.some(node => node.firstElementChild.style.filter.includes('blur')));
    assert.equal(f.player.position(), position);
    f.reduceMotion(true);
    assert.ok(f.root.children.every(node => node.firstElementChild.style.filter === 'none'));
    f.player.dispose(); assert.equal(f.frames.size, 0);
    f.reduceMotion(false);
    assert.ok(f.root.children.every(node => node.firstElementChild.style.filter === 'none'));
});

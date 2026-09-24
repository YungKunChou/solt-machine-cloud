const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const History = require('../history-store.js');

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
const room = (id, winners = []) => ({ activityId: id, id: 'room_' + id, createdAt: 1000,
    settingsRevision: 0, prizes: [{ name: '<script>literal</script>' }], quantities: [{ name: '2' }], winners });

function fixture(t, options = {}) {
    class Element {
        constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.dataset = {}; this.attributes = {}; this.open = false; this.disabled = false; }
        set textContent(text) { this.text = String(text); this.children = []; }
        get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
        append(...children) { this.children.push(...children); }
        prepend(...children) { this.children.unshift(...children); }
        replaceChildren(...children) { this.text = ''; this.children = children; }
        addEventListener(event, fn) { this.events[event] = fn; }
        setAttribute(name, value) { this.attributes[name] = value; }
        insertAdjacentHTML() { /* Static SVG icon; no layout needed. */ }
        focus() { document.activeElement = this; }
        showModal() { this.open = true; }
        close() { this.open = false; this.events.close?.(); }
        click() { if (!this.disabled) return this.events.click?.(); }
        remove() {}
    }
    const elements = new Map();
    const document = { body: new Element('body'), activeElement: null,
        createElement: tag => new Element(tag),
        getElementById(id) { if (!elements.has(id)) elements.set(id, new Element('button')); return elements.get(id); },
        addEventListener(event, fn) { if (event === 'DOMContentLoaded') fn(); } };
    const map = new Map();
    const localStorage = { get length() { return map.size; }, key: i => [...map.keys()][i],
        getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) };
    const events = {};
    const backend = randomUUID();
    const store = History.create(() => localStorage, backend);
    const window = { LotteryHistoryStore: History, LOTTERY_CONFIG: { backendUrl: backend },
        localStorage, navigator: { locks: options.noLocks ? undefined : navigator.locks },
        addEventListener(event, fn) { events[event] = fn; } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../history-ui.js'), 'utf8'), {
        window, document, Intl, URL, Blob, setTimeout, setInterval() {}, console
    });
    t.after(async () => { window.LOTTERY_HISTORY.stop(); await flush(); });
    const dialog = document.body.children.find(element => element.tag === 'dialog');
    const all = element => [element, ...element.children.flatMap(all)];
    const findButton = label => all(dialog).find(element => element.tag === 'button' && element.textContent === label);
    return { store, window, events, dialog, document, localStorage,
        element: id => document.getElementById(id),
        async open() { document.getElementById('history-entry').click(); await flush(); },
        async click(label) { const button = findButton(label); assert.ok(button, label); await button.click(); await flush(); },
        button: findButton };
}

test('history empty/list/detail views work, cancellation preserves records and literal names stay text', async t => {
    const f = fixture(t);
    await f.open();
    assert.match(f.dialog.textContent, /尚無歷史活動/);
    f.store.save(room('one', [{ name: '<img onerror=alert(1)>', prize: '咖啡', quantity: '2' }]));
    await f.open();
    assert.equal(f.element('history-entry').textContent, '歷史活動（1）');
    await f.click('查看紀錄');
    assert.match(f.dialog.textContent, /<img onerror=alert\(1\)>/);
    assert.match(f.dialog.textContent, /<script>literal<\/script>/);
    await f.click('← 返回清單');
    await f.click('清除歷史紀錄');
    assert.equal(f.document.activeElement.textContent, '取消');
    await f.click('取消');
    assert.equal(f.store.list().records.length, 1);
});

test('clear excludes a host in another tab, preserves credentials, and clears after host page closes', async t => {
    const f = fixture(t);
    f.store.save(room('old'));
    f.localStorage.setItem('unrelated', 'keep');
    f.localStorage.setItem('lottery:dealer:credential', 'keep-token');
    f.window.LOTTERY_HISTORY.track(room('live'), true);
    await flush();
    await f.open();
    assert.match(f.dialog.textContent, /使用中/);
    await f.click('清除歷史紀錄');
    assert.match(f.dialog.textContent, /1 場歷史活動/);
    await f.click('確認清除 1 場紀錄');
    assert.deepEqual(f.store.list().records.map(r => r.id), ['live']);
    assert.equal(f.button('清除歷史紀錄').disabled, true);
    assert.equal(f.localStorage.getItem('unrelated'), 'keep');
    assert.equal(f.localStorage.getItem('lottery:dealer:credential'), 'keep-token');
    f.events.pagehide(); await flush();
    await f.open(); await f.click('清除歷史紀錄'); await f.click('確認清除 1 場紀錄');
    assert.equal(f.store.list().records.length, 0);
});

test('a room activated or updated after confirmation opens is not deleted', async t => {
    const f = fixture(t);
    f.store.save(room('one')); f.store.save(room('two'));
    await f.open(); await f.click('清除歷史紀錄');
    f.window.LOTTERY_HISTORY.track(room('one'), true);
    f.store.save(room('two', [{ name: '小明', prize: '咖啡', quantity: '2' }]));
    await flush(); await f.click('確認清除 2 場紀錄');
    assert.equal(f.store.list().records.length, 2);
    assert.match(f.dialog.textContent, /已清除 0 場/);
});

test('storage failures are visible and unsupported locking disables destructive controls', async t => {
    const f = fixture(t, { noLocks: true });
    f.window.LOTTERY_HISTORY.track(room('one'), true);
    await f.open();
    assert.equal(f.button('清除歷史紀錄').disabled, true);
    f.localStorage.setItem = () => { throw Object.assign(Error('full'), { name: 'QuotaExceededError' }); };
    f.window.LOTTERY_HISTORY.track(room('two'), true);
    assert.equal(f.element('history-save-status').dataset.error, 'true');
    assert.match(f.element('history-save-status').textContent, /儲存空間不足/);
    assert.equal(f.store.list().records.length, 1);
    f.events.pagehide();
    assert.equal(f.store.list().records.length, 1);
});

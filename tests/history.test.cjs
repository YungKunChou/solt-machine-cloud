const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create, csv } = require('../history-store.js');
const { roomFixture } = require('./helpers/room.cjs');
function storage() {
    const map = new Map();
    return { map, get length() { return map.size; }, key: i => [...map.keys()][i],
        getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
}
const room = (id = 'one', overrides = {}) => ({ activityId: id, id: 'room_a', createdAt: 100,
    settingsRevision: 0, prizes: [{ name: '咖啡' }], quantities: [{ name: '2' }], winners: [winner], ...overrides });
const winner = { name: '小明', prize: '咖啡', quantity: '2' };

test('zero-result activities do not touch storage; first result creates an archive and delayed empty updates preserve it', () => {
    const s = storage();
    let accesses = 0;
    const store = create(() => { accesses++; return s; }, 'local');
    assert.equal(store.save(room('one', { winners: [] })), null);
    assert.equal(accesses, 0);
    assert.equal(s.length, 0);
    store.save(room());
    const saved = s.getItem(store.prefix + 'one');
    store.save(room('one', { winners: [], settingsRevision: 9 }));
    assert.equal(s.getItem(store.prefix + 'one'), saved);
    assert.equal(store.list().records.length, 1);
});

test('legacy zero-result archives are excluded without deleting or marking them damaged', () => {
    const s = storage();
    const store = create(() => s, 'local');
    const record = store.save(room());
    const legacy = JSON.stringify({ ...record, id: 'empty', winners: [] });
    s.setItem(store.prefix + 'empty', legacy);
    assert.deepEqual(store.list().records.map(row => row.id), ['one']);
    assert.equal(store.list().damaged, 0);
    assert.equal(s.getItem(store.prefix + 'empty'), legacy);
    store.save(room('empty'));
    assert.equal(store.list().records.length, 2);
});

test('activities survive reload, stay separate even with reused room IDs, and contain no credentials', () => {
    const s = storage(); let now = 100;
    const store = create(() => s, 'local', () => ++now);
    store.save(room('one', { dealerToken: 'secret', players: { private: {} }, queue: ['private'] }));
    store.save(room('two'));
    const reloaded = create(() => s, 'local');
    assert.deepEqual(reloaded.list().records.map(r => r.id), ['two', 'one']);
    assert.equal(create(() => s, 'cloud').list().records.length, 0);
    assert.doesNotMatch([...s.map.values()].join(''), /secret|players|queue|dealer/);
});
test('confirmed settings and winners update in place; incidental or stale updates preserve saved data', () => {
    const s = storage(); let now = 100;
    const store = create(() => s, 'local', () => ++now);
    store.save(room());
    const updated = room('one', { settingsRevision: 1, prizes: [{ name: '茶' }], winners: [winner] });
    const saved = store.save(updated);
    assert.equal(store.save({ ...updated, queue: ['a'] }).savedAt, saved.savedAt);
    store.save(room());
    assert.equal(store.list().records.length, 1);
    assert.equal(store.list().records[0].winners.length, 1);
    assert.equal(store.list().records[0].prizes[0].name, '茶');
});
test('clear only removes unchanged selected records and never other local or session keys', () => {
    const s = storage(); const store = create(() => s, 'local');
    s.setItem('unrelated', 'keep'); s.setItem('lottery:dealer:local:room_a', 'token');
    store.save(room()); const snapshot = store.list().records[0];
    store.save(room('one', { winners: [winner, { ...winner, name: '小華' }] }));
    store.save(room('new'));
    assert.equal(store.removeUnchanged(snapshot), false);
    const latest = store.list().records.find(r => r.id === 'one');
    assert.equal(store.removeUnchanged(latest), true);
    assert.deepEqual(store.list().records.map(r => r.id), ['new']);
    assert.equal(s.getItem('unrelated'), 'keep');
    assert.equal(s.getItem('lottery:dealer:local:room_a'), 'token');
});
test('damaged records are reported and preserved; unavailable/full storage does not erase archives', () => {
    const s = storage(); const store = create(() => s, 'local');
    s.setItem(store.prefix + 'one', '{broken');
    assert.equal(store.list().damaged, 1);
    assert.throws(() => store.save(room()), /無法讀取/);
    assert.equal(s.getItem(store.prefix + 'one'), '{broken');
    store.save(room('two'));
    const original = s.getItem(store.prefix + 'two');
    s.setItem = () => { throw Object.assign(Error('full'), { name: 'QuotaExceededError' }); };
    assert.throws(() => store.save(room('two', { winners: [winner, { ...winner, name: '小華' }] })), /full/);
    assert.equal(s.getItem(store.prefix + 'two'), original);
    assert.throws(() => create(() => { throw Error('blocked'); }, 'local').list(), /blocked/);
});
test('CSV preserves Chinese, commas, quotes and newlines, and neutralizes spreadsheet formulas', () => {
    assert.equal(csv([{ name: '王,小"明', prize: '第一行\n第二行', quantity: '2' }]),
        '\uFEFF得獎人,獎項,數量\r\n"王,小""明","第一行\n第二行","2"\r\n');
    assert.match(csv([{ name: '=1+1', prize: ' @SUM(1)', quantity: '1' }]), /"'=1\+1","' @SUM\(1\)"/);
});
test('server supplies stable public activity identity without revealing dealer credentials', () => {
    const f = roomFixture();
    assert.match(f.state.activityId, /^[a-f0-9]{32}$/);
    assert.ok(Number.isFinite(f.state.createdAt));
    const id = f.state.activityId;
    f.player.send('joinRoom', f.roomId);
    assert.equal(f.state.activityId, id);
    assert.equal(f.state.dealerToken, undefined);
    assert.notEqual(roomFixture().state.activityId, id);
});

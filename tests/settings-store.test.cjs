const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../settings-store.js');
const rules = require('../settings-rules.js');
const { createLotteryServer } = require('../index.js');
function storage() {
    const data = new Map();
    return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}
test('latest settings replace one record, survive reload, keep duplicates and omit activity metadata', () => {
    const s = storage(); const store = create(() => s, 'backend');
    s.setItem('lottery:history:old', 'untouched');
    assert.equal(store.read(), null);
    store.save({ ...rules.defaults(), activityId: 'private-activity' });
    store.save({ prizes: [{ optionId: 'old-id', name: ' 禮物 ' }], quantities: [{ name: '02' }, { name: '2' }] });
    assert.equal(s.data.size, 2);
    assert.equal(s.getItem('lottery:history:old'), 'untouched');
    assert.equal(s.getItem(store.key).includes('optionId'), false);
    assert.deepEqual(create(() => s, 'backend').read(), { prizes: [{ name: '禮物' }], quantities: [{ name: '2' }, { name: '2' }] });
    assert.equal(create(() => s, 'another-backend').read(), null);
    s.data.clear(); assert.equal(store.read(), null);
});
test('restoring defaults replaces the preference; invalid and failed saves preserve previous value', () => {
    const s = storage(); const store = create(() => s, 'backend');
    store.save({ prizes: [{ name: '自訂' }], quantities: [{ name: '10' }] });
    store.save(rules.defaults()); assert.deepEqual(store.read(), rules.defaults());
    const before = s.getItem(store.key);
    assert.throws(() => store.save({ prizes: [], quantities: [] })); assert.equal(s.getItem(store.key), before);
    s.setItem = () => { throw Error('quota'); };
    assert.throws(() => store.save(rules.defaults()), /quota/); assert.equal(s.getItem(store.key), before);
});
test('damaged, unknown-format or inaccessible settings fall back safely without deleting stored data', () => {
    const s = storage(); const store = create(() => s, 'backend');
    for (const raw of ['{broken', JSON.stringify({ version: 2, ...rules.defaults() }), JSON.stringify({ version: 1, prizes: [], quantities: [] })]) {
        s.setItem(store.key, raw); assert.equal(store.read(), null); assert.equal(s.getItem(store.key), raw);
    }
    assert.equal(create(() => { throw Error('blocked'); }, 'backend').read(), null);
});
test('real room creation applies custom defaults atomically and generates fresh IDs per activity', async t => {
    const { server, io, service } = createLotteryServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { service.dispose(); await new Promise(resolve => io.close(resolve)); });
    const url = 'http://127.0.0.1:' + server.address().port + '/create-room';
    const initial = { prizes: [{ optionId: 'not-reused', name: '自訂禮物' }], quantities: [{ name: '7' }, { name: '7' }] };
    const rooms = [];
    for (let i = 0; i < 2; i++) {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: initial }) });
        assert.equal(response.status, 200);
        const room = await response.json(); const handlers = {};
        service.connect({ id: 'host' + i, on: (event, fn) => { handlers[event] = fn; }, join() {}, emit() {} });
        let joined;
        handlers.joinRoom({ roomId: room.roomId, activityId: room.activityId, protocolVersion: 2, dealerToken: room.dealerToken }, reply => { joined = reply; });
        assert.equal(joined.success, true);
        assert.equal(joined.snapshot.prizes[0].name, '自訂禮物');
        assert.deepEqual(joined.snapshot.quantities.map(x => x.name), ['7', '7']);
        assert.notEqual(joined.snapshot.prizes[0].optionId, 'not-reused');
        assert.notEqual(joined.snapshot.quantities[0].optionId, joined.snapshot.quantities[1].optionId);
        rooms.push(joined.snapshot);
    }
    assert.notEqual(rooms[0].prizes[0].optionId, rooms[1].prizes[0].optionId);
    const invalid = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { prizes: [], quantities: [] } }) });
    assert.equal(invalid.status, 400); assert.equal((await invalid.json()).success, false);
});

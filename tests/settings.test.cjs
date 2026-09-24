const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../settings-rules.js');

// Exercise public event handlers with isolated rooms; never touch the live service.
function roomFixture() {
    const routes = {};
    let connect;
    let currentState;
    let broadcasts = 0;
    const app = { use() {}, get() {}, post(route, handler) { routes[route] = handler; } };
    class Server {
        on(event, handler) { connect = handler; }
        to() { return { emit(event, state) { currentState = state; broadcasts++; } }; }
    }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8'), {
        require(name) { return {
            express: () => app,
            http: { createServer: () => ({ listen() {} }) },
            'socket.io': { Server }, cors: () => () => {}, './settings-rules.js': rules
        }[name]; },
        process: { env: {} }, console: { log() {} }
    });
    let roomId;
    routes['/create-room']({}, { json(data) { roomId = data.roomId; } });
    function client(id) {
        const handlers = {};
        const events = [];
        connect({ id, join() {}, on(event, callback) { handlers[event] = callback; },
            emit(event, data) { events.push({ event, data }); }, to: () => ({ emit() {} }) });
        return { events, send(event, data) {
            let reply;
            handlers[event](data, value => { reply = value; });
            return reply;
        } };
    }
    const dealer = client('dealer');
    const player = client('player');
    dealer.send('joinRoom', roomId);
    player.send('joinRoom', roomId);
    return { dealer, player, roomId, get state() { return currentState; }, get broadcasts() { return broadcasts; } };
}
function settings(f, overrides = {}) {
    return { roomId: f.roomId, baseRevision: f.state.settingsRevision,
        prizes: [{ name: '  新獎項  ' }], quantities: [{ name: '02' }, { name: '2' }], ...overrides };
}

test('batch save updates both lists atomically, normalizes values and preserves weighted duplicates', () => {
    const f = roomFixture();
    const before = f.broadcasts;
    const result = f.dealer.send('updateSettings', settings(f));
    assert.equal(result.success, true);
    assert.equal(f.state.prizes[0].name, '新獎項');
    assert.deepEqual(f.state.quantities, [{ name: '2' }, { name: '2' }]);
    assert.equal(f.state.settingsRevision, 1);
    assert.equal(f.broadcasts, before + 1);
});
test('invalid quantities do not partially update prizes or broadcast a change', () => {
    const f = roomFixture();
    const before = JSON.stringify(f.state);
    const count = f.broadcasts;
    const result = f.dealer.send('updateSettings', settings(f, { quantities: [{ name: '0' }] }));
    assert.equal(result.success, false);
    assert.equal(JSON.stringify(f.state), before);
    assert.equal(f.broadcasts, count);
});
test('players and malformed requests cannot save settings', () => {
    const f = roomFixture();
    assert.equal(f.player.send('updateSettings', settings(f)).success, false);
    assert.equal(f.dealer.send('updateSettings', null).success, false);
    assert.equal(f.state.settingsRevision, 0);
});
test('stale versions cannot overwrite a newer save', () => {
    const f = roomFixture();
    const stale = settings(f);
    assert.equal(f.dealer.send('updateSettings', settings(f)).success, true);
    const before = JSON.stringify(f.state);
    assert.equal(f.dealer.send('updateSettings', stale).success, false);
    assert.equal(JSON.stringify(f.state), before);
});
test('settings are locked during an active round, including legacy edits', () => {
    const f = roomFixture();
    f.player.send('spin', { roomId: f.roomId, type: 'prize', playerName: '測試員' });
    assert.equal(f.dealer.send('updateSettings', settings(f)).success, false);
    assert.equal(f.dealer.send('updatePrizes', settings(f)).success, false);
    assert.equal(f.state.settingsRevision, 0);
});
test('round completion unlocks settings', () => {
    const f = roomFixture();
    for (const type of ['prize', 'quantity']) f.player.send('spin', { roomId: f.roomId, type, playerName: '測試員' });
    f.player.send('turnComplete', { roomId: f.roomId });
    assert.equal(f.state.winners.length, 1);
    assert.equal(f.dealer.send('updateSettings', settings(f)).success, true);
});
test('departure of the active player clears the abandoned round and settings lock', () => {
    const f = roomFixture();
    f.player.send('spin', { roomId: f.roomId, type: 'prize', playerName: '測試員' });
    f.player.send('disconnect');
    assert.equal(f.state.currentTurnData.playerName, null);
    assert.equal(f.dealer.send('updateSettings', settings(f)).success, true);
});
test('legacy clients still update one list and advance the settings revision', () => {
    const f = roomFixture();
    const quantities = JSON.stringify(f.state.quantities);
    assert.equal(f.dealer.send('updatePrizes', { roomId: f.roomId, prizes: [{ name: '舊版更新' }] }).success, true);
    assert.equal(JSON.stringify(f.state.quantities), quantities);
    assert.equal(f.state.settingsRevision, 1);
});
test('reject empty lists, long/empty names, malformed entries and nonpositive or unsafe quantities', () => {
    const validPrize = [{ name: '咖啡' }];
    for (const prizes of [[], null, [null], [{ name: ' ' }], [{ name: '字'.repeat(121) }], Array(101).fill({ name: '咖啡' })]) {
        assert.equal(rules.validate(prizes, [{ name: '1' }]).valid, false);
    }
    for (const name of ['', '-1', '0', '1.5', '1e2', 'Infinity', '9007199254740992']) {
        assert.equal(rules.validate(validPrize, [{ name }]).valid, false, name);
    }
});

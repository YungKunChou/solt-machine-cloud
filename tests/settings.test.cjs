const { test } = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../settings-rules.js');
const { roomFixture } = require('./helpers/room.cjs');
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
    assert.deepEqual(f.state.quantities.map(x => x.name), ['2', '2']);
    assert.notEqual(f.state.quantities[0].optionId, f.state.quantities[1].optionId);
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
    f.player.send('setPlayerName', { roomId: f.roomId, name: '測試員' });
    f.player.send('startReel', { roomId: f.roomId, type: 'prize', playerName: '測試員' });
    assert.equal(f.dealer.send('updateSettings', settings(f)).success, false);
    assert.equal(f.dealer.send('updatePrizes', settings(f)).success, false);
    assert.equal(f.state.settingsRevision, 0);
});
test('round completion unlocks settings', () => {
    const f = roomFixture();
    f.player.send('setPlayerName', { roomId: f.roomId, name: '測試員' });
    for (const type of ['prize', 'quantity']) f.player.send('startReel', { roomId: f.roomId, type, playerName: '測試員' });
    const turnId = f.state.currentTurnData.id;
    for (const type of ['prize', 'quantity']) f.player.send('reelStopped', { roomId: f.roomId, turnId, type });
    f.advance(20000);
    assert.equal(f.state.winners.length, 1);
    assert.equal(f.dealer.send('updateSettings', settings(f)).success, true);
});
test('departure of the active player preserves round and settings lock until server completion', () => {
    const f = roomFixture();
    f.player.send('setPlayerName', { roomId: f.roomId, name: '測試員' });
    f.player.send('startReel', { roomId: f.roomId, type: 'prize', playerName: '測試員' });
    f.player.send('disconnect');
    assert.equal(f.state.currentTurnData.playerName, '測試員');
    assert.equal(f.dealer.send('updateSettings', settings(f)).success, false);
    f.advance(20000);
    assert.equal(f.dealer.send('updateSettings', settings(f)).success, true);
});
test('legacy setting mutations are rejected without changing revision', () => {
    const f = roomFixture();
    const quantities = JSON.stringify(f.state.quantities);
    assert.equal(f.dealer.send('updatePrizes', { roomId: f.roomId, prizes: [{ name: '舊版更新' }] }).success, false);
    assert.equal(JSON.stringify(f.state.quantities), quantities);
    assert.equal(f.state.settingsRevision, 0);
});
test('reject empty lists, long/empty names, malformed entries and nonpositive or unsafe quantities', () => {
    const validPrize = [{ name: '咖啡' }];
    for (const prizes of [[], null, [null], [{ name: ' ' }], [{ name: '字'.repeat(121) }], Array(11).fill({ name: '咖啡' })]) {
        assert.equal(rules.validate(prizes, [{ name: '1' }]).valid, false);
    }
    for (const name of ['', '-1', '0', '1.5', '1e2', 'Infinity', '9007199254740992']) {
        assert.equal(rules.validate(validPrize, [{ name }]).valid, false, name);
    }
});

test('ten rows accepted, eleven rejected without truncation; quantity value can exceed ten', () => {
    const f = roomFixture();
    const ten = Array.from({ length: 10 }, () => ({ name: '同名' }));
    assert.equal(f.dealer.send('updateSettings', settings(f, { prizes: ten, quantities: [{ name: '100' }] })).success, true);
    assert.equal(new Set(f.state.prizes.map(x => x.optionId)).size, 10);
    assert.equal(f.state.quantities[0].name, '100');
    const before = JSON.stringify(f.state);
    assert.equal(f.dealer.send('updateSettings', settings(f, { prizes: [...ten, { name: '11' }] })).success, false);
    assert.equal(JSON.stringify(f.state), before);
});
test('editing preserves IDs, new rows get new IDs, duplicate or foreign IDs are rejected atomically', () => {
    const f = roomFixture(); const existing = f.state.prizes[0];
    assert.equal(f.dealer.send('updateSettings', settings(f, { prizes: [{ ...existing, name: '改名' }, { name: '新項' }] })).success, true);
    assert.equal(f.state.prizes[0].optionId, existing.optionId);
    assert.notEqual(f.state.prizes[1].optionId, existing.optionId);
    const before = JSON.stringify(f.state);
    for (const prizes of [[existing, existing], [{ ...existing, optionId: 'forged' }], [f.state.quantities[0]]]) {
        assert.equal(f.dealer.send('updateSettings', settings(f, { prizes })).success, false);
        assert.equal(JSON.stringify(f.state), before);
    }
});

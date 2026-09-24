const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roomFixture } = require('./helpers/room.cjs');

function saveSettings(f, client) {
    return client.send('updateSettings', { roomId: f.roomId, baseRevision: f.state.settingsRevision,
        prizes: [{ name: '咖啡' }], quantities: [{ name: '1' }] });
}

test('host reconnects with a new connection ID and regains management without joining the queue', () => {
    const f = roomFixture();
    const queue = JSON.stringify(f.state.queue);
    f.dealer.send('disconnect');
    assert.equal(f.state.dealerId, null);
    const restored = f.client('restored');
    const reply = restored.send('joinRoom', { roomId: f.roomId, dealerToken: f.dealerToken });
    assert.equal(reply.role, 'dealer');
    assert.equal(f.state.dealerId, 'restored');
    assert.equal(JSON.stringify(f.state.queue), queue);
    assert.equal(saveSettings(f, restored).success, true);
    assert.equal(saveSettings(f, f.dealer).success, false);
    assert.equal(f.state.players.dealer, undefined);
});

test('host reload during an active player round preserves its results, queue and settings lock', () => {
    const f = roomFixture();
    f.player.send('setPlayerName', { roomId: f.roomId, name: '小明' });
    f.player.send('spin', { roomId: f.roomId, type: 'prize' });
    const turn = JSON.stringify(f.state.currentTurnData);
    const queue = JSON.stringify(f.state.queue);
    f.dealer.send('disconnect');
    const restored = f.client('restored');
    restored.send('joinRoom', { roomId: f.roomId, dealerToken: f.dealerToken });
    assert.equal(JSON.stringify(f.state.currentTurnData), turn);
    assert.equal(JSON.stringify(f.state.queue), queue);
    assert.equal(saveSettings(f, restored).success, false);
});

test('overlapping host connections transfer control once and a late old disconnect cannot clear it', () => {
    const f = roomFixture();
    const restored = f.client('restored');
    restored.send('joinRoom', { roomId: f.roomId, dealerToken: f.dealerToken });
    assert.equal(f.state.dealerId, 'restored');
    assert.equal(f.state.players.dealer, undefined);
    assert.equal(f.notifications.length, 1);
    assert.equal(f.notifications[0].target, 'dealer');
    assert.equal(f.notifications[0].event, 'dealerReplaced');
    assert.equal(saveSettings(f, f.dealer).success, false);
    f.dealer.send('disconnect');
    assert.equal(f.state.dealerId, 'restored');
    assert.equal(saveSettings(f, restored).success, true);
    restored.send('joinRoom', { roomId: f.roomId, dealerToken: f.dealerToken });
    assert.equal(f.notifications.length, 1);
    assert.equal(f.state.queue.includes('restored'), false);
});

test('participants cannot claim an absent host with a shared link, role flag or wrong credential', () => {
    const f = roomFixture();
    f.dealer.send('disconnect');
    const visitor = f.client('visitor');
    assert.equal(visitor.send('joinRoom', { roomId: f.roomId, role: 'dealer', dealerId: 'visitor' }).role, 'player');
    assert.equal(f.state.dealerId, null);
    assert.equal(saveSettings(f, visitor).success, false);
    const before = JSON.stringify(f.state);
    assert.equal(visitor.send('joinRoom', { roomId: f.roomId, dealerToken: 'f'.repeat(64) }).success, false);
    assert.equal(JSON.stringify(f.state), before);
});

test('credentials stay out of public state, join replies and host replacement notices', () => {
    const f = roomFixture();
    assert.match(f.dealerToken, /^[a-f0-9]{64}$/);
    const restored = f.client('restored');
    const reply = restored.send('joinRoom', { roomId: f.roomId, dealerToken: f.dealerToken });
    const publicData = JSON.stringify({ state: f.state, reply, notifications: f.notifications,
        dealerEvents: f.dealer.events, playerEvents: f.player.events });
    assert.equal(publicData.includes(f.dealerToken), false);
    const other = roomFixture();
    assert.notEqual(other.dealerToken, f.dealerToken);
    assert.equal(other.player.send('joinRoom', { roomId: other.roomId, dealerToken: f.dealerToken }).success, false);
});

test('repeated player joins preserve name, queue order, round and broadcast count', () => {
    const f = roomFixture();
    const next = f.client('next');
    next.send('joinRoom', f.roomId);
    f.player.send('setPlayerName', { roomId: f.roomId, name: '小明' });
    f.player.send('spin', { roomId: f.roomId, type: 'prize' });
    const before = JSON.stringify(f.state);
    const count = f.broadcasts;
    for (let i = 0; i < 5; i++) {
        assert.equal(f.player.send('joinRoom', { roomId: f.roomId }).role, 'player');
        assert.equal(next.send('joinRoom', f.roomId).role, 'player');
    }
    assert.equal(JSON.stringify(f.state), before);
    assert.equal(f.broadcasts, count);
    assert.equal(f.state.queue.filter(id => id === 'player').length, 1);
    assert.equal(f.state.queue.filter(id => id === 'next').length, 1);
});

test('duplicate host joins with or without a credential never enrol the host', () => {
    const f = roomFixture();
    for (const payload of [f.roomId, { roomId: f.roomId }, { roomId: f.roomId, dealerToken: f.dealerToken }]) {
        assert.equal(f.dealer.send('joinRoom', payload).role, 'dealer');
    }
    assert.equal(f.state.queue.includes('dealer'), false);
    assert.equal(f.state.dealerId, 'dealer');
});

test('a finished player stays out of the queue after repeated joins', () => {
    const f = roomFixture();
    f.player.send('setPlayerName', { roomId: f.roomId, name: '小明' });
    for (const type of ['prize', 'quantity']) f.player.send('spin', { roomId: f.roomId, type });
    const turnId = f.state.currentTurnData.id;
    for (const type of ['prize', 'quantity']) f.player.send('reelStopped', { roomId: f.roomId, type, turnId });
    f.player.send('turnComplete', { roomId: f.roomId, turnId });
    for (let i = 0; i < 5; i++) f.player.send('joinRoom', f.roomId);
    assert.equal(f.state.queue.includes('player'), false);
    assert.equal(f.state.players.player.name, '小明');
    assert.equal(f.state.winners.length, 1);
});

test('invalid join payloads do not throw or change membership', () => {
    const f = roomFixture();
    const before = JSON.stringify(f.state);
    for (const payload of [null, undefined, {}, 5, '__proto__', { roomId: [] }, { roomId: 'missing' }]) {
        assert.equal(f.player.send('joinRoom', payload).success, false);
    }
    assert.equal(JSON.stringify(f.state), before);
});

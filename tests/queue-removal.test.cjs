const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roomFixture } = require('./helpers/room.cjs');
const remove = (f, playerId, dealer = f.dealer) => dealer.send('removeQueuedPlayer', { roomId: f.roomId, playerId });
const ids = f => Array.from(f.state.queue);

test('host removes one waiting player without changing active round, other positions, settings or winners', () => {
    const f = roomFixture();
    f.client('second').send('joinRoom', f.roomId);
    f.client('third').send('joinRoom', f.roomId);
    f.player.send('setPlayerName', { roomId: f.roomId, name: '小明' });
    f.player.send('spin', { roomId: f.roomId, type: 'prize' });
    const turn = JSON.stringify(f.state.currentTurnData);
    const settings = JSON.stringify([f.state.prizes, f.state.quantities, f.state.winners]);
    assert.equal(remove(f, 'second').success, true);
    assert.deepEqual(ids(f), ['player', 'third']);
    assert.equal(JSON.stringify(f.state.currentTurnData), turn);
    assert.equal(JSON.stringify([f.state.prizes, f.state.quantities, f.state.winners]), settings);
    assert.equal(f.state.players.second.removed, true);
    assert.ok(f.notifications.some(n => n.target === 'second' && n.event === 'removedFromQueue'));
});

test('removing an unstarted queue head promotes the next player, including unnamed heads', () => {
    const f = roomFixture();
    const next = f.client('next'); next.send('joinRoom', f.roomId);
    assert.equal(remove(f, 'player').success, true);
    assert.deepEqual(ids(f), ['next']);
    assert.equal(f.state.currentTurnData.id, null);
    assert.equal(f.player.send('spin', { roomId: f.roomId, type: 'prize' }).success, false);
    next.send('setPlayerName', { roomId: f.roomId, name: '小美' });
    assert.equal(next.send('spin', { roomId: f.roomId, type: 'quantity' }).success, true);
});

for (const type of ['prize', 'quantity']) {
    test(`first accepted ${type} spin protects player even after that reel stops`, () => {
        const f = roomFixture();
        f.player.send('setPlayerName', { roomId: f.roomId, name: '小明' });
        const reply = f.player.send('spin', { roomId: f.roomId, type });
        assert.equal(remove(f, 'player').success, false);
        f.player.send('reelStopped', { roomId: f.roomId, type, turnId: reply.turnId });
        const before = JSON.stringify(f.state);
        assert.equal(remove(f, 'player').success, false);
        assert.equal(JSON.stringify(f.state), before);
    });
}

test('ordinary players, replaced hosts, malformed targets and other rooms cannot remove anyone', () => {
    const f = roomFixture();
    assert.equal(remove(f, 'player', f.player).success, false);
    const host = f.client('new-host'); host.send('joinRoom', { roomId: f.roomId, dealerToken: f.dealerToken });
    const before = JSON.stringify(f.state);
    for (const target of [undefined, null, [], {}, '__proto__', 'missing', 'new-host']) {
        assert.equal(remove(f, target, host).success, false);
    }
    assert.equal(remove(f, 'player').success, false);
    assert.equal(host.send('removeQueuedPlayer', { roomId: 'other', playerId: 'player' }).success, false);
    assert.equal(JSON.stringify(f.state), before);
});

test('retries are harmless and removed players cannot requeue, rename or affect the next round', () => {
    const f = roomFixture();
    f.client('next').send('joinRoom', f.roomId);
    f.player.send('setPlayerName', { roomId: f.roomId, name: '小明' });
    remove(f, 'player');
    const broadcasts = f.broadcasts;
    assert.equal(remove(f, 'player').alreadyRemoved, true);
    assert.equal(f.broadcasts, broadcasts);
    assert.equal(f.player.send('joinRoom', f.roomId).role, 'spectator');
    f.player.send('setPlayerName', { roomId: f.roomId, name: '新名字' });
    assert.equal(f.state.players.player.name, '小明');
    f.player.send('disconnect');
    assert.deepEqual(ids(f), ['next']);
    assert.equal(remove(f, 'player').success, false);
});

test('private tab token prevents reentry after a missed removal notification and reload', () => {
    const f = roomFixture();
    const token = 'b'.repeat(64);
    const tab = f.client('tab'); tab.send('joinRoom', { roomId: f.roomId, participantToken: token });
    remove(f, 'tab'); tab.send('disconnect');
    const reloaded = f.client('reloaded');
    const result = reloaded.send('joinRoom', { roomId: f.roomId, participantToken: token });
    assert.equal(result.role, 'spectator');
    assert.equal(f.state.players.reloaded.removed, true);
    assert.equal(ids(f).includes('reloaded'), false);
    assert.equal(JSON.stringify(f.state).includes(token), false);
    assert.equal(f.client('new-tab').send('joinRoom', { roomId: f.roomId, participantToken: 'c'.repeat(64) }).role, 'player');
});

test('saved removal flag joins as spectator; malformed tab tokens are rejected without enqueueing', () => {
    const f = roomFixture();
    const viewer = f.client('viewer');
    assert.equal(viewer.send('joinRoom', { roomId: f.roomId, spectator: true }).role, 'spectator');
    assert.equal(ids(f).includes('viewer'), false);
    const other = f.client('other');
    for (const token of ['', {}, [], 'g'.repeat(64)]) {
        assert.equal(other.send('joinRoom', { roomId: f.roomId, participantToken: token }).success, false);
    }
    assert.equal(ids(f).includes('other'), false);
});

test('completed winners cannot be removed and their result remains intact', () => {
    const f = roomFixture();
    f.player.send('setPlayerName', { roomId: f.roomId, name: '小明' });
    for (const type of ['prize', 'quantity']) f.player.send('spin', { roomId: f.roomId, type });
    const turnId = f.state.currentTurnData.id;
    for (const type of ['prize', 'quantity']) f.player.send('reelStopped', { roomId: f.roomId, type, turnId });
    f.player.send('turnComplete', { roomId: f.roomId, turnId });
    const before = JSON.stringify(f.state);
    assert.equal(remove(f, 'player').success, false);
    assert.equal(JSON.stringify(f.state), before);
});

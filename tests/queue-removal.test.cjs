const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roomFixture } = require('./helpers/room.cjs');
test('host removes one waiting player immediately without changing others or settings', () => {
    const f = roomFixture(); const second = f.client('second'); second.join(); const third = f.client('third'); third.join();
    const prizes = f.state.prizes;
    assert.equal(f.dealer.send('removeQueuedPlayer', { playerId: second.pid }).success, true);
    assert.deepEqual(f.state.queue, [f.player.pid, third.pid]); assert.deepEqual(f.state.prizes, prizes);
    assert.equal(f.dealer.send('removeQueuedPlayer', { playerId: second.pid }).alreadyRemoved, true);
    assert.equal(f.notifications[0].event, 'removedFromQueue');
});
test('unnamed queue head can be removed and next participant promoted', () => {
    const f = roomFixture(); const second = f.client('second'); second.join();
    f.dealer.send('removeQueuedPlayer', { playerId: f.player.pid }); assert.deepEqual(f.state.queue, [second.pid]);
});
for (const type of ['prize', 'quantity']) test('first accepted ' + type + ' protects active player through first reel stop and disconnect', () => {
    const f = roomFixture(); f.start(type); f.advance(8500); f.player.send('disconnect');
    assert.equal(f.dealer.send('removeQueuedPlayer', { playerId: f.player.pid }).success, false);
    assert.equal(f.state.round.playerId, f.player.pid); assert.equal(f.state.winners.length, 0);
});
test('removed identity stays spectator on reconnect, cannot rename or start, and removal missed notification is recoverable', () => {
    const f = roomFixture(); f.dealer.send('removeQueuedPlayer', { playerId: f.player.pid });
    const reloaded = f.client('reload', f.player.token); assert.equal(reloaded.join().role, 'spectator');
    assert.equal(reloaded.send('setPlayerName', { name: 'new' }).success, false);
    assert.equal(reloaded.send('startReel', { type: 'prize' }).success, false);
    assert.equal(reloaded.send('getSnapshot').snapshot.players[reloaded.pid].removed, true);
    assert.equal(f.state.queue.length, 0);
});
test('ordinary players, invalid targets and completed winners cannot be removed', () => {
    const f = roomFixture();
    assert.equal(f.player.send('removeQueuedPlayer', { playerId: f.player.pid }).success, false);
    for (const playerId of [null, 'missing', f.dealer.pid]) assert.equal(f.dealer.send('removeQueuedPlayer', { playerId }).success, false);
    f.start(); f.advance(20000);
    assert.equal(f.dealer.send('removeQueuedPlayer', { playerId: f.player.pid }).success, false);
    assert.equal(f.state.winners.length, 1);
});

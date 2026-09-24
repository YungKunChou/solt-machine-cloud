const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roomFixture } = require('./helpers/room.cjs');

test('host credential restores stable identity, protects active round and revokes old connection', () => {
    const f = roomFixture(); f.start(); const round = f.state.round;
    const host = f.client('newhost');
    assert.equal(host.join({ dealerToken: f.dealerToken }).participantId, f.dealer.pid);
    assert.deepEqual(f.state.round, round);
    assert.equal(f.state.queue.includes(host.pid), false);
    assert.equal(f.dealer.send('removeQueuedPlayer', { playerId: f.player.pid }).success, false);
    f.dealer.send('disconnect');
    assert.equal(f.state.players[host.pid].connected, true);
    assert.equal(f.notifications.filter(n => n.event === 'dealerReplaced').length, 1);
});
test('waiting participant disconnects immediately and reconnects with same identity at tail', () => {
    const f = roomFixture(); f.player.send('setPlayerName', { name: '小明' });
    const other = f.client('other'); other.join();
    f.player.send('disconnect'); assert.deepEqual(f.state.queue, [other.pid]);
    const back = f.client('back', f.player.token); back.join();
    assert.equal(back.pid, f.player.pid);
    assert.deepEqual(f.state.queue, [other.pid, back.pid]);
    assert.equal(f.state.players[back.pid].name, '小明');
    const count = f.broadcasts; back.join();
    assert.equal(f.broadcasts, count); assert.deepEqual(f.state.queue, [other.pid, back.pid]);
});
test('active participant reconnects into same round; completed participant never reenqueues', () => {
    const f = roomFixture(); f.start(); const round = f.state.round;
    f.player.send('disconnect');
    assert.deepEqual(f.state.round, round);
    const back = f.client('back', f.player.token); back.join();
    assert.equal(back.pid, f.player.pid); assert.deepEqual(f.state.round, round);
    assert.equal(back.send('stopReel', { type: 'prize', roundId: round.id }).success, true);
    f.advance(20000);
    back.send('disconnect'); const later = f.client('later', f.player.token); later.join();
    assert.equal(f.state.players[later.pid].completed, true); assert.equal(f.state.queue.includes(later.pid), false);
});
test('overlapping participant connection replaces control and late disconnect cannot remove it', () => {
    const f = roomFixture(); const back = f.client('back', f.player.token); back.join();
    assert.equal(f.player.send('setPlayerName', { name: 'old' }).success, false);
    assert.equal(f.player.join().success, false);
    f.player.send('disconnect'); assert.deepEqual(f.state.queue, [back.pid]);
    assert.equal(f.notifications[0].event, 'participantReplaced');
});
test('public snapshots never disclose tokens or private results, including operation and join replies', () => {
    const f = roomFixture(); const started = f.start();
    const publicData = JSON.stringify([started, f.player.join(), f.dealer.send('getSnapshot'), f.state, f.notifications]);
    for (const secret of [f.dealerToken, f.player.token, '"results"', '"dealerToken"', '"tokens"']) assert.equal(publicData.includes(secret), false, secret);
    assert.equal(f.state.round.reels.prize.stop, null);
});
test('bad credentials, old protocol, missing identity and mismatched activity fail closed', () => {
    const f = roomFixture(); const c = f.client('intruder');
    for (const payload of [null, {}, f.roomId, { roomId: f.roomId, protocolVersion: 1 }]) assert.equal(c.raw('joinRoom', payload).success, false);
    assert.equal(c.join({ dealerToken: 'f'.repeat(64) }).success, false);
    assert.equal(c.join({ activityId: 'wrong' }).success, false);
    assert.equal(c.join({ participantToken: undefined }).success, false);
    assert.equal(c.join({ participantToken: 'bad' }).success, false);
    assert.deepEqual(f.state.queue, [f.player.pid]);
    assert.equal(c.join({ participantToken: undefined, spectator: true }).role, 'spectator');
    assert.equal(c.send('setPlayerName', { name: 'intruder' }).success, false);
});

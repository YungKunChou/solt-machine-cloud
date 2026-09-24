const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../reel-motion.js');
const { roomFixture } = require('./helpers/room.cjs');
test('manual stopping creates one immutable plan, hides result until plan, and completes without client acknowledgement', () => {
    const f = roomFixture(); const start = f.start();
    assert.equal(start.success, true); assert.equal(start.result, undefined);
    const plan = f.state.round.reels.prize; const calls = f.randomCalls;
    f.player.send('startReel', { type: 'prize' }); assert.equal(f.randomCalls, calls);
    const stop = { type: 'prize', roundId: f.state.round.id };
    f.player.send('stopReel', stop);
    assert.equal(f.state.round.reels.prize.stop.brakeAt, plan.startAt + 500);
    assert.equal(f.state.round.reels.prize.stop.source, 'manual');
    const locked = f.state.round.reels.prize;
    f.advance(1000); f.player.send('stopReel', stop); assert.deepEqual(f.state.round.reels.prize, locked);
    f.player.send('startReel', { type: 'quantity', roundId: stop.roundId });
    f.player.send('stopReel', { ...stop, type: 'quantity' });
    const end = Math.max(...Object.values(f.state.round.reels).map(p => p.stop.stopAt));
    f.advance(end - f.now - 1); assert.equal(f.state.winners.length, 0);
    f.advance(1); assert.equal(f.state.winners.length, 1); assert.equal(f.state.round, null);
    const winner = f.state.winners[0];
    for (const type of ['prize', 'quantity']) {
        const p = f.state.lastRound.reels[type]; const q = M.position(p, f.now);
        assert.equal(p.order[M.mod(q, p.order.length)].optionId, winner[type + 'OptionId']);
    }
    f.advance(20000); assert.equal(f.state.winners.length, 1);
});
test('one reel plus player and host disconnect still auto-starts remaining reel and settles once', () => {
    const f = roomFixture(); f.start(); const startAt = f.state.round.reels.prize.startAt;
    f.player.send('disconnect'); f.dealer.send('disconnect');
    f.advance(4250); assert.equal(f.state.round.reels.prize.stop.brakeAt, startAt + 4250);
    f.advance(6000); assert.equal(f.state.round.reels.quantity.startAt, startAt + 10250);
    f.advance(10000); assert.equal(f.state.winners.length, 1);
    const host = f.client('host'); const result = host.join({ dealerToken: f.dealerToken });
    assert.equal(result.snapshot.winners.length, 1); assert.equal(result.snapshot.lastRound.completedAt !== null, true);
});
test('expired deadline is applied before manual stop even when timer has not run', () => {
    const f = roomFixture(); f.start(); const p = f.state.round.reels.prize;
    f.advance(6000, false);
    f.player.send('stopReel', { type: 'prize', roundId: f.state.round.id });
    assert.equal(f.state.round.reels.prize.stop.brakeAt, p.autoStopDueAt + 250);
    assert.equal(f.state.round.reels.prize.stop.source, 'auto');
});
test('overdue complete recovery advances all phases from their original logical deadlines', () => {
    const f = roomFixture(); f.start(); const startAt = f.state.round.reels.prize.startAt;
    f.advance(60000, false);
    const snapshot = f.dealer.send('getSnapshot').snapshot;
    assert.equal(snapshot.round, null); assert.equal(snapshot.winners.length, 1);
    assert.equal(snapshot.lastRound.reels.quantity.startAt, startAt + 10250);
    assert.ok(snapshot.lastRound.completedAt < f.now);
});
test('unrelated joins and stale timer callbacks do not cancel or repeat scheduled completion', () => {
    const f = roomFixture(); f.start(); const stale = [...f.timers.values()][0].fn;
    f.player.send('stopReel', { type: 'prize', roundId: f.state.round.id });
    const before = f.state.round.reels.prize; stale(); assert.deepEqual(f.state.round.reels.prize, before);
    f.client('extra').join(); f.advance(20000); assert.equal(f.state.winners.length, 1);
    stale(); assert.equal(f.state.winners.length, 1);
});
test('operation replay returns original confirmation without repeating changes even after newer state', () => {
    const f = roomFixture(); f.start(); const payload = { operationId: 'same-stop-0001', type: 'prize', roundId: f.state.round.id };
    const first = f.player.send('stopReel', payload); f.client('extra').join();
    const second = f.player.send('stopReel', payload);
    assert.deepEqual(second, first); assert.ok(f.state.stateVersion > second.snapshot.stateVersion);
    assert.equal(f.player.send('startReel', payload).success, false);
    f.advance(20000); assert.deepEqual(f.player.send('stopReel', payload), first);
    assert.equal(f.state.winners.length, 1);
});
test('legacy events and stale or unauthorized round commands cannot alter authoritative playback', () => {
    const f = roomFixture(); f.start(); const before = JSON.stringify(f.state);
    for (const event of ['spin', 'turnComplete', 'reelStopped', 'broadcastAnimation', 'updatePrizes', 'updateQuantities']) assert.equal(f.player.send(event, {}).success, false);
    assert.equal(f.player.send('stopReel', { type: 'prize', roundId: 99 }).success, false);
    assert.equal(f.dealer.send('stopReel', { type: 'prize', roundId: 1 }).success, false);
    assert.equal(f.player.send('startReel', { type: 'missing' }).success, false);
    assert.equal(JSON.stringify(f.state), before);
});
test('names require confirmation, reject duplicates and cannot change during an established round', () => {
    const f = roomFixture(); assert.equal(f.player.send('startReel', { type: 'prize' }).success, false);
    f.start(); assert.equal(f.player.send('setPlayerName', { name: '改名' }).success, false);
    const second = f.client('second'); second.join(); assert.equal(second.send('setPlayerName', { name: '小明' }).success, false);
    f.advance(20000); assert.equal(second.send('setPlayerName', { name: '小明' }).success, false);
});
for (let n = 1; n <= 10; n++) test(`end-to-end round with ${n} prize rows and ${11 - n} quantity rows preserves duplicate identity`, () => {
    const f = roomFixture();
    assert.equal(f.dealer.send('updateSettings', { baseRevision: 0,
        prizes: Array.from({ length: n }, () => ({ name: '同名獎品' })),
        quantities: Array.from({ length: 11 - n }, () => ({ name: '2' })) }).success, true);
    f.start(); f.player.send('startReel', { type: 'quantity', roundId: f.state.round.id });
    if (n % 2) f.player.send('stopReel', { type: 'quantity', roundId: f.state.round.id });
    f.advance(20000);
    assert.equal(f.state.winners.length, 1);
    for (const type of ['prize', 'quantity']) {
        const p = f.state.lastRound.reels[type];
        assert.equal(new Set(p.order.map(x => x.optionId)).size, p.order.length);
        assert.equal(p.order[M.mod(M.position(p, f.now), p.order.length)].optionId, f.state.winners[0][type + 'OptionId']);
    }
});

test('successive rounds keep order and both reel origins, including the unstarted reel and automatic start', () => {
    const f = roomFixture();
    for (let turn = 0; turn < 4; turn++) {
        const client = turn === 0 ? f.player : f.client('player' + turn);
        if (turn) client.join();
        client.send('setPlayerName', { name: '玩家' + turn });
        const previous = f.state.lastRound;
        const first = turn % 2 ? 'quantity' : 'prize';
        const second = first === 'prize' ? 'quantity' : 'prize';
        const draws = f.randomCalls;
        assert.equal(client.send('startReel', { type: first }).success, true);
        assert.equal(f.randomCalls, draws + 1); // Drawing does not shuffle or consume extra random choices.
        for (const type of ['prize', 'quantity']) {
            const source = type === 'prize' ? f.state.prizes : f.state.quantities;
            const origin = previous ? M.mod(previous.reels[type].stop.target, source.length) : 0;
            assert.equal(f.state.round.initialPositions[type], origin);
            if (type === first) {
                assert.deepEqual(f.state.round.reels[type].order, source);
                assert.equal(M.position(f.state.round.reels[type], f.now), origin);
            }
        }
        assert.equal(f.state.round.reels[second], null);
        const origin = f.state.round.initialPositions[second];
        f.advance(11000);
        assert.equal(f.state.round.reels[second].startPosition, origin);
        f.advance(10000); assert.equal(f.state.winners.length, turn + 1);
    }
});
test('settings revision change resets the next origin to the newly displayed settings, never to a removed winner', () => {
    const f = roomFixture(); f.start(); f.advance(20000);
    assert.equal(f.dealer.send('updateSettings', { baseRevision: 0, prizes: [{ name: '新獎品' }], quantities: [{ name: '9' }] }).success, true);
    const next = f.client('next'); next.join(); next.send('setPlayerName', { name: '下一位' });
    next.send('startReel', { type: 'quantity' });
    assert.deepEqual(f.state.round.initialPositions, { prize: 0, quantity: 0 });
    assert.deepEqual(f.state.round.reels.quantity.order, f.state.quantities);
});

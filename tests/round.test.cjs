const { test } = require('node:test');
const assert = require('node:assert/strict');
const { roomFixture } = require('./helpers/room.cjs');

function namedRoom() {
    const f = roomFixture();
    f.player.send('setPlayerName', { roomId: f.roomId, name: '  小明  ' });
    return f;
}
function drawBoth(f) {
    for (const type of ['prize', 'quantity']) {
        assert.equal(f.player.send('spin', { roomId: f.roomId, type }).success, true);
    }
    return f.state.currentTurnData.id;
}
function stop(f, turnId, type) {
    return f.player.send('reelStopped', { roomId: f.roomId, turnId, type });
}
function complete(f, turnId) {
    return f.player.send('turnComplete', { roomId: f.roomId, turnId });
}

for (const order of [['prize', 'quantity'], ['quantity', 'prize']]) {
    test(`waits for both reels to stop (${order.join(' then ')}) and records exactly one winner`, () => {
        const f = namedRoom();
        const next = f.client('next');
        next.send('joinRoom', f.roomId);
        const turnId = drawBoth(f);
        assert.equal(complete(f, turnId).success, false);
        assert.equal(stop(f, turnId, order[0]).success, true);
        assert.equal(complete(f, turnId).success, false);
        assert.equal(f.state.winners.length, 0);
        assert.equal(f.state.queue[0], 'player');
        assert.equal(stop(f, turnId, order[1]).success, true);
        assert.equal(complete(f, turnId).success, true);
        assert.equal(complete(f, turnId).success, true);
        assert.equal(f.state.winners.length, 1);
        assert.equal(f.state.winners[0].name, '小明');
        assert.equal(f.state.queue[0], 'next');
        assert.equal(f.state.currentTurnData.id, null);
        assert.equal(f.animations.filter(e => e.data.action === 'winner').length, 1);
    });
}

test('stopping the first reel before drawing the second preserves its result', () => {
    const f = namedRoom();
    const first = f.player.send('spin', { roomId: f.roomId, type: 'prize' });
    assert.equal(stop(f, first.turnId, 'quantity').success, false);
    stop(f, first.turnId, 'prize');
    assert.equal(complete(f, first.turnId).success, false);
    const second = f.player.send('spin', { roomId: f.roomId, type: 'quantity' });
    assert.equal(second.turnId, first.turnId);
    assert.equal(f.state.currentTurnData.prize, first.result);
    stop(f, second.turnId, 'quantity');
    assert.equal(complete(f, second.turnId).success, true);
});

test('repeated spin requests never consume randomness or replace either result', () => {
    const f = namedRoom();
    const turnId = drawBoth(f);
    const initial = JSON.stringify(f.state.currentTurnData);
    const draws = f.randomCalls;
    for (let i = 0; i < 5; i++) {
        for (const type of ['prize', 'quantity']) {
            const result = f.player.send('spin', { roomId: f.roomId, type, playerName: '假名字' });
            assert.equal(result.turnId, turnId);
            assert.equal(result.result, f.state.currentTurnData[type]);
        }
    }
    assert.equal(f.randomCalls, draws);
    assert.equal(JSON.stringify(f.state.currentTurnData), initial);
});

test('unnamed, non-current, dealer and malformed spin requests do not start a round', () => {
    const f = roomFixture();
    const next = f.client('next');
    next.send('joinRoom', f.roomId);
    next.send('setPlayerName', { roomId: f.roomId, name: '下一位' });
    for (const client of [f.player, f.dealer, next]) {
        assert.equal(client.send('spin', { roomId: f.roomId, type: 'prize', playerName: '冒名' }).success, false);
    }
    f.player.send('setPlayerName', { roomId: f.roomId, name: '小明' });
    for (const type of [null, 'stopped', '__proto__', 'invalid']) {
        assert.equal(f.player.send('spin', { roomId: f.roomId, type }).success, false);
    }
    assert.equal(f.player.send('spin', null).success, false);
    assert.equal(f.player.send('spin', { roomId: '__proto__', type: 'prize' }).success, false);
    assert.equal(f.state.currentTurnData.id, null);
});

test('server uses registered name and locks it throughout the round', () => {
    const f = namedRoom();
    const first = f.player.send('spin', { roomId: f.roomId, type: 'prize', playerName: '冒名' });
    f.player.send('setPlayerName', { roomId: f.roomId, name: '新名字' });
    assert.equal(f.state.players.player.name, '小明');
    assert.equal(f.player.events.at(-1).event, 'nameError');
    f.player.send('spin', { roomId: f.roomId, type: 'quantity', playerName: '另一個名字' });
    for (const type of ['prize', 'quantity']) stop(f, first.turnId, type);
    complete(f, first.turnId);
    assert.equal(f.state.winners[0].name, '小明');
    assert.equal(f.state.winners[0].playerId, 'player');
});

test('name validation rejects malformed/duplicate names but accepts own unchanged name', () => {
    const f = namedRoom();
    for (const name of [null, {}, '', '   ', '字'.repeat(81)]) {
        f.player.send('setPlayerName', { roomId: f.roomId, name });
        assert.equal(f.player.events.at(-1).event, 'nameError');
        assert.equal(f.state.players.player.name, '小明');
    }
    f.player.send('setPlayerName', null);
    const count = f.player.events.length;
    f.player.send('setPlayerName', { roomId: f.roomId, name: ' 小明 ' });
    assert.equal(f.player.events.length, count);
    const next = f.client('next');
    next.send('joinRoom', f.roomId);
    next.send('setPlayerName', { roomId: f.roomId, name: ' 小明 ' });
    assert.equal(next.events.at(-1).event, 'nameError');
    assert.equal(f.state.players.next.name, null);
});

test('winner cannot evade the once-only rule by renaming and rejoining on the same connection', () => {
    const f = namedRoom();
    const turnId = drawBoth(f);
    for (const type of ['prize', 'quantity']) stop(f, turnId, type);
    complete(f, turnId);
    f.player.send('joinRoom', f.roomId);
    f.player.send('setPlayerName', { roomId: f.roomId, name: '另一名字' });
    assert.equal(f.player.send('spin', { roomId: f.roomId, type: 'prize' }).success, false);
    assert.equal(f.state.winners.length, 1);
    assert.equal(f.state.currentTurnData.id, null);
});

test('registered winner name remains blocked after disconnecting', () => {
    const f = namedRoom();
    const turnId = drawBoth(f);
    for (const type of ['prize', 'quantity']) stop(f, turnId, type);
    complete(f, turnId);
    f.player.send('disconnect');
    const returning = f.client('returning');
    returning.send('joinRoom', f.roomId);
    returning.send('setPlayerName', { roomId: f.roomId, name: ' 小明 ' });
    assert.equal(returning.send('spin', { roomId: f.roomId, type: 'prize', playerName: '假名字' }).success, false);
});

test('other players, old rounds and legacy completion events cannot end the current round', () => {
    const f = namedRoom();
    const next = f.client('next');
    next.send('joinRoom', f.roomId);
    next.send('setPlayerName', { roomId: f.roomId, name: '下一位' });
    const oldId = drawBoth(f);
    assert.equal(next.send('reelStopped', { roomId: f.roomId, turnId: oldId, type: 'prize' }).success, false);
    f.player.send('disconnect');
    for (const type of ['prize', 'quantity']) next.send('spin', { roomId: f.roomId, type });
    const newId = f.state.currentTurnData.id;
    assert.notEqual(newId, oldId);
    assert.equal(stop(f, oldId, 'prize').success, false);
    assert.equal(next.send('reelStopped', { roomId: f.roomId, turnId: oldId, type: 'prize' }).success, false);
    assert.equal(next.send('turnComplete', { roomId: f.roomId }).success, false);
    assert.equal(next.send('turnComplete', { roomId: f.roomId, turnId: oldId }).success, false);
    assert.equal(next.send('turnComplete', null).success, false);
    assert.equal(f.state.winners.length, 0);
    assert.equal(f.state.currentTurnData.stopped.prize, false);
});

test('animation messages use canonical identity/result and cannot be forged by spectators', () => {
    const f = namedRoom();
    const turnId = drawBoth(f);
    const payload = { roomId: f.roomId, turnId, type: 'prize', action: 'stopSpin',
        playerId: 'fake', playerName: '冒名', finalResult: '假獎品' };
    f.dealer.send('broadcastAnimation', payload);
    assert.equal(f.animations.length, 0);
    f.player.send('broadcastAnimation', payload);
    assert.equal(f.animations[0].data.playerId, 'player');
    assert.equal(f.animations[0].data.playerName, '小明');
    assert.equal(f.animations[0].data.finalResult, f.state.currentTurnData.prize);
    f.player.send('broadcastAnimation', { ...payload, action: 'winner' });
    assert.equal(f.animations.length, 1);
});

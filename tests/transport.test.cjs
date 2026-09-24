const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const connect = require(path.resolve(__dirname, '../node_modules/socket.io/client-dist/socket.io.js'));
const { createLotteryServer } = require('../index.js');
const M = require('../reel-motion.js');

test('real HTTP and Socket.IO: host, player and late observer share one plan and result, without completion ack', { timeout: 15000 }, async t => {
    const { server, io, service } = createLotteryServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port;
    const sockets = [];
    t.after(async () => { for (const socket of sockets) socket.disconnect(); service.dispose(); await new Promise(resolve => io.close(resolve)); });
    assert.match(await (await fetch(url)).text(), /protocol 2/);
    const created = await (await fetch(url + '/create-room', { method: 'POST' })).json();
    assert.equal(created.protocolVersion, 2);
    const base = { protocolVersion: 2, roomId: created.roomId, activityId: created.activityId };
    async function client() {
        const socket = connect(url, { transports: ['websocket'], reconnection: false, forceNew: true }); sockets.push(socket);
        await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
        return socket;
    }
    const rpc = (socket, event, data = {}) => new Promise((resolve, reject) => {
        socket.timeout(2000).emit(event, { ...base, operationId: randomUUID(), ...data }, (error, result) => error ? reject(error) : resolve(result));
    });
    const host = await client(), player = await client();
    assert.equal((await rpc(host, 'joinRoom', { dealerToken: created.dealerToken })).role, 'dealer');
    const token = randomBytes(32).toString('hex');
    const joined = await rpc(player, 'joinRoom', { participantToken: token });
    assert.equal((await rpc(player, 'setPlayerName', { name: '通訊測試員' })).success, true);
    const start = await rpc(player, 'startReel', { type: 'prize' });
    assert.equal(start.success, true); assert.equal(start.snapshot.round.reels.prize.stop, null);
    await rpc(player, 'startReel', { type: 'quantity', roundId: start.roundId });
    await rpc(player, 'stopReel', { type: 'prize', roundId: start.roundId });
    const stopped = await rpc(player, 'stopReel', { type: 'quantity', roundId: start.roundId });
    const observer = await client();
    const late = await rpc(observer, 'joinRoom', { spectator: true });
    const hostSnapshot = (await rpc(host, 'getSnapshot')).snapshot;
    assert.deepEqual(late.snapshot.round, stopped.snapshot.round);
    assert.deepEqual(hostSnapshot.round, stopped.snapshot.round);
    const completed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('server did not complete round')), 7000);
        host.on('updateRoomState', state => { if (state.winners.length) { clearTimeout(timer); resolve(state); } });
    });
    player.disconnect();
    const final = await completed;
    assert.equal(final.winners.length, 1); assert.equal(final.winners[0].playerId, joined.participantId);
    for (const type of ['prize', 'quantity']) {
        const plan = final.lastRound.reels[type];
        const q = M.position(plan, plan.stop.stopAt);
        assert.equal(plan.order[M.mod(q, plan.order.length)].optionId, final.winners[0][type + 'OptionId']);
    }
    const back = await client();
    const restored = await rpc(back, 'joinRoom', { participantToken: token });
    assert.equal(restored.participantId, joined.participantId);
    assert.equal(restored.snapshot.queue.includes(joined.participantId), false);
    assert.equal(restored.snapshot.players[joined.participantId].completed, true);
    assert.equal((await rpc(back, 'spin', { type: 'prize' })).success, false);
});

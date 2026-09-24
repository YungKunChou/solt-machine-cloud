const { createGameService } = require('../../game-server.cjs');
const { randomBytes } = require('node:crypto');
function roomFixture() {
    let time = 1000000, currentState, broadcasts = 0, randomCalls = 0, timerId = 0, operation = 0;
    const timers = new Map(), notifications = [];
    const service = createGameService({ to(target) { return { emit(event, state) {
        if (event === 'updateRoomState') { currentState = state; broadcasts++; }
        else notifications.push({ target, event, data: state });
    } }; } }, { now: () => time, pick: n => { randomCalls++; return (randomCalls - 1) % n; },
        setTimer(fn, delay) { timers.set(++timerId, { fn, at: time + delay }); return timerId; },
        clearTimer(id) { timers.delete(id); } });
    const created = service.createRoom();
    function client(id, token = randomBytes(32).toString('hex')) {
        const handlers = {}, events = [];
        service.connect({ id, join() {}, on(event, fn) { handlers[event] = fn; }, emit(event, data) { events.push({ event, data }); } });
        const c = { token, events, pid: null,
            raw(event, payload) { let result; handlers[event](payload, reply => { result = reply; }); return result; },
            send(event, data) {
                if (event === 'disconnect') return c.raw(event);
                if (event === 'joinRoom') return c.join(typeof data === 'object' && data ? data : {});
                return c.raw(event, data === null ? null : { roomId: created.roomId, activityId: created.activityId,
                    protocolVersion: 2, operationId: 'operation-' + (++operation), ...data });
            },
            join(data = {}) {
                const reply = c.raw('joinRoom', { roomId: created.roomId, activityId: created.activityId,
                    protocolVersion: 2, participantToken: token, ...data });
                if (reply.success) c.pid = reply.participantId;
                return reply;
            } };
        return c;
    }
    const dealer = client('dealer'); dealer.join({ dealerToken: created.dealerToken });
    const player = client('player'); player.join();
    return { ...created, dealer, player, client, notifications, timers, service,
        get state() { return currentState; }, get broadcasts() { return broadcasts; }, get randomCalls() { return randomCalls; },
        get now() { return time; },
        advance(ms, runTimers = true) {
            const until = time + ms;
            if (runTimers) for (;;) {
                const due = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                time = Math.max(time, due[1].at); timers.delete(due[0]); due[1].fn();
            }
            time = until;
        },
        start(type = 'prize') {
            player.send('setPlayerName', { name: '小明' });
            return player.send('startReel', { type });
        } };
}
module.exports = { roomFixture };

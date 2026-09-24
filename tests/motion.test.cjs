const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../reel-motion.js');
const { ServerClock } = require('../server-clock.js');
const P = require('../game-protocol.js');
test('1–10 options, every target, fractional and billion-cell starts stop forward at a valid identity', () => {
    let cases = 0;
    for (let n = 1; n <= 10; n++) for (let j = 0; j < n; j++) {
        for (const base of [12, 79, 1000, 1000000000]) for (const fraction of [0, 0.001, 0.25, 0.5, 0.999]) {
            const order = Array.from({ length: n }, (_, i) => ({ optionId: 'id' + i, name: String(i % 3) }));
            const p = M.start(order, 0, 'test');
            const brakeAt = ((base + fraction) / 12 + 0.125) * 1000;
            p.stop = M.stopping(p, order[j].optionId, brakeAt);
            const s = p.stop;
            assert.ok(s.distance >= 12 - 1e-6 && s.distance < 12 + n + 1e-6);
            assert.ok(s.durationMs >= 2000 - 1e-5 && s.durationMs < 11000 / 3 + 1e-5);
            assert.equal(M.mod(s.target, n), j);
            assert.ok(Math.abs(M.position(p, brakeAt - 0.001) - s.from) < 0.0001);
            let previous = s.from, speed = 12;
            for (let i = 0; i <= 100; i++) {
                const t = brakeAt + s.durationMs * i / 100;
                const q = M.position(p, t), v = M.velocity(p, t);
                assert.ok(q >= previous - 1e-6 && q <= s.target + 1e-6);
                assert.ok(v >= -1e-9 && v <= speed + 1e-9);
                previous = q; speed = v;
            }
            assert.equal(M.position(p, s.stopAt + 1000), s.target);
            assert.equal(M.velocity(p, s.stopAt), 0); cases++;
        }
    }
    assert.equal(cases, 1100);
});
test('startup position and velocity are continuous and invalid target or early brake fails', () => {
    const p = M.start([{ optionId: 'a', name: '獎項' }], 500, 'plan');
    assert.equal(M.position(p, 0), 0); assert.equal(M.velocity(p, 500), 0);
    assert.ok(Math.abs(M.position(p, 750 - 0.001) - M.position(p, 750)) < 0.0001);
    assert.equal(M.velocity(p, 750), 12);
    assert.throws(() => M.stopping(p, 'missing', 2000));
    assert.throws(() => M.stopping(p, 'a', 501));
    assert.throws(() => M.start(Array(11).fill({ optionId: 'a' }), 0, 'bad'));
    assert.throws(() => M.start([{ optionId: 'a' }, { optionId: 'a' }], 0, 'bad'));
});
test('foreground round freezes clock mapping across positive and negative updates; recovery and next round apply new anchor', () => {
    let local = 0; const clock = new ServerClock(() => local);
    clock.observe([{ begin: 0, end: 20, serverTime: 1010 }, { begin: 0, end: 100, serverTime: 99999 }]);
    clock.useRound(1); local = 500; assert.equal(clock.now(), 1500);
    clock.observe([{ begin: 490, end: 510, serverTime: 1580 }]); assert.equal(clock.now(), 1500); assert.equal(clock.drift(), 80);
    clock.observe([{ begin: 490, end: 510, serverTime: 1420 }]); assert.equal(clock.now(), 1500); assert.equal(clock.drift(), -80);
    local = 600; assert.equal(clock.now(), 1600); clock.useRound(2); assert.equal(clock.now(), 1520);
    clock.observe([{ begin: 600, end: 600, serverTime: 10000 }]); clock.useRound(2, true); assert.equal(clock.now(), 10000);
});
test('snapshot guard rejects wrong activity, protocol, duplicate or older version', () => {
    const current = { protocolVersion: 2, activityId: 'a', stateVersion: 13 };
    assert.equal(P.acceptSnapshot(current, { ...current, stateVersion: 14 }, 'a'), true);
    for (const next of [current, { ...current, stateVersion: 12 }, { ...current, protocolVersion: 1 }, { ...current, activityId: 'b' }]) assert.equal(P.acceptSnapshot(current, next, 'a'), false);
});

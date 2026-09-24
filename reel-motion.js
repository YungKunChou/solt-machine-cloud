(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./game-protocol.js'));
    else root.LotteryMotion = factory(root.LotteryProtocol);
}(typeof window === 'undefined' ? globalThis : window, function (protocol) {
    'use strict';
    const C = protocol.TIMING;
    const mod = (n, m) => ((n % m) + m) % m;
    function cruising(plan, time) {
        const t = Math.max(0, (time - plan.startAt) / 1000);
        const a = plan.accelerationMs / 1000;
        const origin = plan.startPosition ?? 0;
        if (t < a) return origin + plan.speed / 2 * (t - a / Math.PI * Math.sin(Math.PI * t / a));
        return origin + plan.speed * (t - a / 2);
    }
    function position(plan, time) {
        if (!plan) return 0;
        if (!plan.stop || time < plan.stop.brakeAt) return cruising(plan, time);
        const s = plan.stop;
        if (time >= s.stopAt) return s.target;
        const u = Math.max(0, (time - s.brakeAt) / s.durationMs);
        return s.from + s.distance * (u + Math.sin(Math.PI * u) / Math.PI);
    }
    function velocity(plan, time) {
        if (time <= plan.startAt) return 0;
        if (plan.stop && time >= plan.stop.stopAt) return 0;
        if (plan.stop && time >= plan.stop.brakeAt) {
            const u = Math.min(1, (time - plan.stop.brakeAt) / plan.stop.durationMs);
            return plan.speed / 2 * (1 + Math.cos(Math.PI * u));
        }
        const u = Math.min(1, (time - plan.startAt) / plan.accelerationMs);
        return plan.speed / 2 * (1 - Math.cos(Math.PI * u));
    }
    function start(order, startAt, planId, startPosition = 0) {
        if (!Array.isArray(order) || order.length < 1 || order.length > 10 ||
            order.some(row => typeof row?.optionId !== 'string' || !row.optionId) ||
            new Set(order.map(row => row.optionId)).size !== order.length) throw Error('Invalid reel options');
        if (!Number.isFinite(startPosition) || startPosition < 0) throw Error('Invalid reel origin');
        return { planId, planVersion: 1, startAt, startPosition, speed: C.speed, accelerationMs: C.accelerationMs,
            autoStopDueAt: startAt + C.autoStopMs, order: order.map(row => ({ ...row })), stop: null };
    }
    function stopping(plan, optionId, brakeAt) {
        const j = plan.order.findIndex(row => row.optionId === optionId);
        if (j < 0 || brakeAt < plan.startAt + C.minSpinMs) throw Error('Invalid stop target or time');
        const from = cruising(plan, brakeAt);
        const n = plan.order.length;
        const target = j + n * Math.ceil((from + C.minDistance - j) / n);
        const distance = target - from;
        const durationMs = 2000 * distance / plan.speed;
        return { optionId, from, target, distance, durationMs, brakeAt, stopAt: brakeAt + durationMs };
    }
    function phase(plan, time) {
        if (!plan) return 'idle';
        if (time < plan.startAt) return 'scheduled';
        if (!plan.stop || time < plan.stop.brakeAt) return plan.stop ? 'stopScheduled' : 'spinning';
        return time < plan.stop.stopAt ? 'slowing' : 'stopped';
    }
    return { mod, start, stopping, cruising, position, velocity, phase };
}));

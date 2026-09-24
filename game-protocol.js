(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LotteryProtocol = factory();
}(typeof window === 'undefined' ? globalThis : window, function () {
    'use strict';
    const VERSION = 2;
    const TYPES = Object.freeze(['prize', 'quantity']);
    const TIMING = Object.freeze({ speed: 12, accelerationMs: 250, minSpinMs: 500,
        leadMs: 250, minDistance: 12, autoStopMs: 4000, remainingStartMs: 10000,
        recoveryThresholdMs: 150, sampleMaxAgeMs: 30000 });
    function compatible(value) { return value === VERSION; }
    // Acknowledgements and their snapshots are intentionally processed separately.
    function acceptSnapshot(current, next, activityId) {
        return !!next && compatible(next.protocolVersion) && next.activityId === activityId &&
            Number.isSafeInteger(next.stateVersion) && (!current || next.stateVersion > current.stateVersion);
    }
    return { VERSION, TYPES, TIMING, compatible, acceptSnapshot };
}));

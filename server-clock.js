(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.LotteryClock = api;
}(typeof window === 'object' ? window : globalThis, function () {
    'use strict';
    class ServerClock {
        constructor(monotonic = () => performance.now()) {
            this.monotonic = monotonic;
            this.candidate = null;
            this.anchor = null;
            this.roundId = null;
        }
        observe(samples) {
            const sample = samples.filter(s => Number.isFinite(s.serverTime) && s.end >= s.begin)
                .sort((a, b) => (a.end - a.begin) - (b.end - b.begin))[0];
            if (!sample) throw Error('無法取得共同時間，請重試。');
            this.candidate = { local: (sample.begin + sample.end) / 2, server: sample.serverTime,
                rttMs: sample.end - sample.begin };
            if (!this.anchor || this.roundId === null) this.anchor = this.candidate;
        }
        useRound(roundId, recovery = false) {
            if (!this.candidate) throw Error('尚未完成校時。');
            if (recovery || roundId !== this.roundId) this.anchor = this.candidate;
            this.roundId = roundId;
        }
        now() { return this.anchor ? this.anchor.server + this.monotonic() - this.anchor.local : 0; }
        drift() {
            if (!this.candidate || !this.anchor) return 0;
            return (this.candidate.server - this.candidate.local) - (this.anchor.server - this.anchor.local);
        }
        diagnostics() {
            return { estimatedServerTime: this.now(), roundId: this.roundId,
                selectedRttMs: this.candidate?.rttMs ?? null,
                uncertaintyEstimateMs: this.candidate ? this.candidate.rttMs / 2 : null,
                sampleAgeMs: this.candidate ? this.monotonic() - this.candidate.local : null,
                pendingCorrectionMs: this.drift() };
        }
    }
    return { ServerClock };
}));

'use strict';
const Motion = require('./reel-motion.js');
const { TYPES, TIMING: C } = require('./game-protocol.js');

class RoundEngine {
    constructor({ now, setTimer, clearTimer, pick, id, changed, completed }) {
        Object.assign(this, { now, setTimer, clearTimer, pick, id, changed, completed });
        this.current = null;
        this.last = null;
        this.sequence = 0;
        this.timer = null;
        this.generation = 0;
    }
    begin(participant, settings, type) {
        if (!this.current) {
            const initialPositions = {};
            for (const reel of TYPES) {
                const options = reel === 'prize' ? settings.prizes : settings.quantities;
                const previous = this.last?.settingsRevision === settings.settingsRevision ? this.last.reels[reel] : null;
                initialPositions[reel] = previous?.stop ? Motion.mod(previous.stop.target, options.length) : 0;
            }
            this.current = { id: ++this.sequence, participantId: participant.id, playerId: participant.id,
                playerName: participant.name, settingsRevision: settings.settingsRevision,
                options: { prize: settings.prizes.map(x => ({ ...x })), quantity: settings.quantities.map(x => ({ ...x })) },
                initialPositions, reels: { prize: null, quantity: null }, results: {}, remainingStartDueAt: null, completedAt: null };
        }
        this.startReel(type, this.now() + C.leadMs);
        this.changed();
        this.schedule();
    }
    startReel(type, startAt) {
        const r = this.current;
        if (r.reels[type]) return;
        const source = r.options[type];
        // Draw once from source rows. Display order remains stable across rounds.
        r.results[type] = { ...source[this.pick(source.length)] };
        const order = source.map(x => ({ ...x }));
        r.reels[type] = Motion.start(order, startAt, this.id(), r.initialPositions[type]);
        if (r.remainingStartDueAt === null) r.remainingStartDueAt = startAt + C.remainingStartMs;
    }
    stop(type) {
        const p = this.current?.reels[type];
        if (!p) throw Error('請先啟動這個滾輪。');
        if (p.stop) return;
        this.planStop(type, Math.max(this.now() + C.leadMs, p.startAt + C.minSpinMs), 'manual');
        this.changed();
        this.schedule();
    }
    planStop(type, brakeAt, source) {
        const r = this.current;
        const p = r.reels[type];
        if (p.stop) return;
        p.stop = { ...Motion.stopping(p, r.results[type].optionId, brakeAt), source };
        p.planVersion++;
    }
    dueEvents() {
        const r = this.current;
        if (!r) return [];
        const events = [];
        for (const type of TYPES) {
            const p = r.reels[type];
            if (!p) events.push({ at: r.remainingStartDueAt, action: 'start', type });
            else if (!p.stop) events.push({ at: p.autoStopDueAt, action: 'stop', type });
        }
        if (TYPES.every(type => r.reels[type]?.stop)) {
            events.push({ at: Math.max(...TYPES.map(type => r.reels[type].stop.stopAt)), action: 'complete' });
        }
        return events.sort((a, b) => a.at - b.at);
    }
    advance() {
        let changed = false;
        for (;;) {
            const event = this.dueEvents()[0];
            if (!event || event.at > this.now()) break;
            changed = true;
            if (event.action === 'start') this.startReel(event.type, event.at + C.leadMs);
            else if (event.action === 'stop') this.planStop(event.type, event.at + C.leadMs, 'auto');
            else {
                const r = this.current;
                r.completedAt = event.at;
                this.last = r;
                this.current = null;
                this.completed(r);
            }
        }
        if (changed) this.changed();
        this.schedule();
    }
    schedule() {
        if (this.timer !== null) this.clearTimer(this.timer);
        this.timer = null;
        const generation = ++this.generation;
        const r = this.current;
        const next = this.dueEvents()[0];
        if (!next) return;
        // Unrelated room stateVersion changes must not invalidate a round timer.
        this.timer = this.setTimer(() => {
            if (generation !== this.generation || this.current !== r) return;
            this.timer = null;
            this.advance();
        }, Math.max(0, next.at - this.now()));
        this.timer?.unref?.();
    }
    publicRound(r = this.current) {
        if (!r) return null;
        return structuredClone({ id: r.id, participantId: r.participantId, playerId: r.playerId,
            playerName: r.playerName, settingsRevision: r.settingsRevision, options: r.options, initialPositions: r.initialPositions,
            remainingStartDueAt: r.remainingStartDueAt, reels: r.reels, completedAt: r.completedAt });
    }
    dispose() { ++this.generation; if (this.timer !== null) this.clearTimer(this.timer); }
}
module.exports = { RoundEngine };

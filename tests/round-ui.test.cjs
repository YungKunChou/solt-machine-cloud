const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { Element } = require('./helpers/dom.cjs');
const P = require('../game-protocol.js');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function pageFixture(options = {}) {
    const elements = new Map();
    const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
    el('qrcode').textContent = 'QR Code 生成中';
    let monotonic = 1000;
    let submitSettings;
    const savedSettings = new Map();
    const phaseHandlers = [];
    const handlers = {}, requests = [], commands = [], archived = [], plays = [], docEvents = {}, windowEvents = {};
    let participantSession = options.storageBlocked ? null : { token: 'b'.repeat(64), removed: false };
    let savedToken = options.dealer ? 'a'.repeat(64) : null;
    let current = { protocolVersion: 2, activityId: 'activity', stateVersion: 1, settingsRevision: 0,
        players: { me: { id: 'me', name: null }, host: { id: 'host' } }, dealerId: options.dealer ? 'me' : 'host',
        prizes: [{ optionId: 'p', name: '咖啡' }], quantities: [{ optionId: 'q', name: '2' }], queue: ['me'], winners: [], round: null, lastRound: null,
        ...options.state };
    const socket = { connected: true, on(event, fn) { handlers[event] = fn; }, timeout() { return this; },
        disconnect() { this.connected = false; handlers.disconnect(); },
        emit(event, payload, callback) {
            requests.push({ event, payload, callback });
            if (event === 'getRoomInfo') callback(null, { success: true, protocolVersion: options.protocolVersion ?? 2, activityId: 'activity' });
            else if (event === 'clockSync') callback(null, { protocolVersion: 2, serverTime: 1000 });
            else if (event === 'joinRoom') {
                if (options.deferJoin) commands.push({ event, payload, callback });
                else callback(null, { success: true, participantId: 'me', role: options.dealer ? 'dealer' : payload.spectator ? 'spectator' : 'player', snapshot: current });
            } else if (event === 'getSnapshot') callback(null, { success: true, snapshot: current });
            else commands.push({ event, payload, callback });
        } };
    const document = { hidden: false, getElementById: el, createElement: () => new Element(), createTextNode(text) { const n = new Element(); n.textContent = text; return n; },
        addEventListener(event, fn) { if (event === 'DOMContentLoaded') fn(); else docEvents[event] = fn; } };
    const location = { search: '?room=test', href: 'http://local/slot-machine.html?room=test&extra=hidden#private' };
    const window = { LotteryProtocol: P, LOTTERY_CONFIG: { backendUrl: 'local' },
        LotterySettingsStore: require('../settings-store.js'),
        localStorage: { getItem: key => savedSettings.get(key) ?? null,
            setItem(key, value) { if (options.settingsStorageBlocked) throw Error('storage blocked'); savedSettings.set(key, value); } },
        LotteryClock: { ServerClock: class extends require('../server-clock.js').ServerClock { constructor() { super(() => monotonic); } } },
        LOTTERY_ROOM_SESSION: { read: () => savedToken, remove: () => { savedToken = null; } },
        LOTTERY_PLAYER_SESSION: { prepare: () => participantSession, markRemoved: () => { if (participantSession) participantSession.removed = true; } },
        LOTTERY_HISTORY: { track: (state, dealer) => { if (dealer) archived.push(state); }, stop() {}, download() {} },
        createLotterySettingsEditor: (root, submit) => { submitSettings = submit; return { update() {}, disconnect() {} }; },
        createLotteryReelPlayer: (root, type, clock, onError, onPhase) => {
            phaseHandlers.push(onPhase);
            return { update(plan, options, initialPosition) { plays.push({ type, plan, options, initialPosition }); } };
        },
        addEventListener(event, fn) { windowEvents[event] = fn; } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../game-client.js'), 'utf8'), { window, document, location,
        io: () => socket, crypto: require('node:crypto').webcrypto, URL, URLSearchParams, performance: { now: () => monotonic },
        QRCode: function (root) { root.append(new Element()); }, setInterval() {}, setTimeout() {} });
    const joining = handlers.connect();
    if (options.deferJoin) await flush(); else await joining;
    return { el, handlers, requests, commands, socket, document, docEvents, archived, plays,
        savedSettings, saveSettings: payload => submitSettings(payload),
        time(value) { monotonic = value; for (const notify of phaseHandlers) notify(); },
        get participantSession() { return participantSession; },
        get current() { return current; },
        update(changes = {}) { current = { ...current, stateVersion: current.stateVersion + 1, ...changes }; handlers.updateRoomState(current); return current; },
        async reply(index = 0, changes = {}, error = null) {
            const request = commands.splice(index, 1)[0];
            assert.ok(request, 'pending operation exists');
            request.callback(error, { success: true, protocolVersion: 2, activityId: 'activity', operationId: request.payload.operationId, snapshot: current, ...changes });
            await flush(); return request;
        } };
}
test('waiting hint, exact queue count, in-progress text and unrelated updates preserve partially typed name', async () => {
    const f = await pageFixture();
    f.update({ players: { me: { id: 'me', name: null }, first: { name: '小美' }, second: { name: '小華' } }, queue: ['first', 'second', 'me'] });
    assert.equal(f.el('draw-status').textContent, '現在輪到 小美... 再等 2 人就輪到您了');
    assert.equal(f.el('participant-name').placeholder, '在此輸入姓名…');
    f.el('participant-name').value = '正在打字';
    f.update({ queue: ['second', 'me'] });
    assert.equal(f.el('participant-name').value, '正在打字');
    assert.equal(f.el('draw-status').textContent, '現在輪到 小華... 再等 1 人就輪到您了');
});
test('IME composition does not submit; name must be acknowledged before drawing; errors preserve placeholder', async () => {
    const f = await pageFixture(); const input = f.el('participant-name'); input.value = '小明';
    await input.fire('keydown', { key: 'Enter', isComposing: true }); assert.equal(f.commands.length, 0);
    input.fire('keydown', { key: 'Enter' }); assert.equal(f.commands[0].event, 'setPlayerName');
    await f.el('lever-left').fire('click'); assert.equal(f.commands.length, 1);
    await f.reply(0, { success: false, message: '姓名重複' });
    assert.equal(input.value, ''); assert.equal(input.placeholder, '在此輸入姓名…');
    input.value = '小華'; input.fire('change');
    f.update({ players: { me: { id: 'me', name: '小華' } } }); await f.reply();
    f.el('lever-left').fire('click'); assert.equal(f.commands[0].event, 'startReel');
});
test('newer snapshot before old acknowledgement clears pending operation without rolling back display', async () => {
    const f = await pageFixture({ state: { players: { me: { id: 'me', name: '小明' } } } });
    f.el('lever-left').fire('click'); f.el('lever-left').fire('click'); assert.equal(f.commands.length, 1);
    const old = { ...f.current, stateVersion: 2 };
    const round = { id: 1, playerId: 'me', playerName: '小明', options: { prize: f.current.prizes, quantity: f.current.quantities },
        reels: { prize: { planId: 'p1', planVersion: 1, order: f.current.prizes, stop: null }, quantity: null } };
    f.update({ stateVersion: 3, round });
    await f.reply(0, { snapshot: old });
    f.el('lever-left').fire('click');
    assert.equal(f.commands[0].event, 'stopReel'); assert.equal(f.commands[0].payload.roundId, 1);
    assert.equal(f.plays.at(-2).plan.planId, 'p1');
});
test('timeout resends exact operation identity; confirmation clears wait', async () => {
    const f = await pageFixture({ state: { players: { me: { name: '小明' } } } });
    f.el('lever-left').fire('click');
    const sent = f.commands[0].payload;
    await f.reply(0, {}, Error('timeout'));
    assert.deepEqual(f.commands[0].payload, sent);
    await f.reply();
    f.el('lever-left').fire('click'); assert.equal(f.commands.length, 1);
    assert.notEqual(f.commands[0].payload.operationId, sent.operationId);
});
test('host queue removal is direct, protects active player and never shows success notification', async () => {
    const f = await pageFixture({ dealer: true, state: { players: { me: {}, first: { name: '小明' }, waiting: { name: '小華' } }, queue: ['first', 'waiting'],
        round: { id: 1, playerId: 'first', playerName: '小明', options: { prize: [], quantity: [] }, reels: {} } } });
    const rows = f.el('queue-list').children;
    assert.equal(rows[0].children.at(-1).className, 'queue-locked');
    const remove = rows[1].children.at(-1); remove.fire('click');
    assert.equal(f.commands[0].event, 'removeQueuedPlayer'); assert.equal(f.commands[0].payload.playerId, 'waiting');
    f.update({ queue: ['first'] }); await f.reply();
    assert.equal(f.el('queue-feedback').hidden, true);
});
test('removed and completed participants never receive playable controls; missed removal snapshot persists tab flag', async () => {
    const f = await pageFixture();
    f.update({ players: { me: { removed: true } }, queue: [] });
    assert.equal(f.participantSession.removed, true); assert.equal(f.el('participant-name').disabled, true);
    assert.equal(f.el('queue-spectator-notice').hidden, false);
    await f.el('lever-left').fire('click'); assert.equal(f.commands.length, 0);
    const finished = await pageFixture({ state: { players: { me: { completed: true, name: '小明' } }, queue: ['someone'] } });
    assert.equal(finished.el('draw-status').textContent, '您已完成抽獎。');
});
test('only joined host archives snapshots, share URL has no credentials; replaced session cannot resume', async () => {
    const f = await pageFixture({ dealer: true });
    assert.equal(f.archived.length, 1); assert.equal(f.el('room-url-input').value, 'http://local/slot-machine.html?room=test');
    assert.equal(f.requests.find(r => r.event === 'joinRoom').payload.dealerToken, 'a'.repeat(64));
    f.handlers.dealerReplaced({ activityId: 'activity' }); assert.equal(f.socket.connected, false);
    f.update({ stateVersion: 20 }); assert.equal(f.archived.length, 1);
    assert.match(f.el('draw-status').textContent, /最新的分頁/);
    const player = await pageFixture(); assert.equal(player.archived.length, 0);
});
test('protocol mismatch blocks join and late join reply cannot revive disconnected session', async () => {
    const old = await pageFixture({ protocolVersion: 1 }); assert.equal(old.requests.some(r => r.event === 'joinRoom'), false);
    assert.match(old.el('draw-status').textContent, /版本不相容/);
    const f = await pageFixture({ deferJoin: true }); f.socket.disconnect();
    await f.reply(0, { participantId: 'me', role: 'player' });
    f.update({ stateVersion: 99 }); await f.el('lever-left').fire('click');
    assert.equal(f.commands.length, 0); assert.equal(f.el('participant-name').disabled, true);
});
test('background recovery requests authoritative snapshot and rejects stale or cross-activity broadcasts', async () => {
    const f = await pageFixture(); const count = f.plays.length;
    f.handlers.updateRoomState({ ...f.current, activityId: 'wrong', stateVersion: 100 });
    f.handlers.updateRoomState({ ...f.current, stateVersion: 0 }); assert.equal(f.plays.length, count);
    f.docEvents.visibilitychange(); await flush();
    assert.equal(f.requests.filter(r => r.event === 'getSnapshot').length, 1);
    assert.equal(f.plays.length, count + 2);
});
test('late operation callback from old connection cannot unlock a newer pending lever request', async () => {
    const f = await pageFixture({ state: { players: { me: { name: '小明' } } } });
    f.el('lever-left').fire('click'); assert.equal(f.commands.length, 1);
    f.socket.disconnect(); f.socket.connected = true; await f.handlers.connect();
    f.el('lever-left').fire('click'); assert.equal(f.commands.length, 2);
    await f.reply(0); f.el('lever-left').fire('click');
    assert.equal(f.commands.length, 1);
    assert.doesNotMatch(f.el('draw-status').textContent, /連線已更新/);
    await f.reply();
});
test('QR generation replaces the placeholder instead of appending beside it', async () => {
    const f = await pageFixture();
    assert.equal(f.el('qrcode').textContent, '');
    assert.equal(f.el('qrcode').children.length, 1);
});
test('accepted manual stop partially returns lever and only the visual stop time returns it fully', async () => {
    const f = await pageFixture({ state: { players: { me: { name: '小明' } } } });
    const lever = f.el('lever-left');
    const round = { id: 1, settingsRevision: 0, playerId: 'me', playerName: '小明',
        options: { prize: f.current.prizes, quantity: f.current.quantities },
        reels: { prize: { startAt: 1000, planId: 'p', planVersion: 1, stop: null }, quantity: null } };
    f.update({ round }); assert.equal(lever.classList.contains('pulled'), true);
    lever.fire('click'); assert.equal(f.commands[0].event, 'stopReel');
    assert.equal(lever.classList.contains('returning'), false);
    const stopping = { ...round, reels: { ...round.reels, prize: { ...round.reels.prize, planVersion: 2, stop: { source: 'manual', brakeAt: 1250, stopAt: 3500 } } } };
    f.update({ round: stopping }); await f.reply();
    assert.equal(lever.classList.contains('pulled'), false);
    assert.equal(lever.classList.contains('returning'), true);
    // Server completion may arrive while this display's estimated time is slightly behind.
    f.time(3499); f.update({ round: null, lastRound: { ...stopping, completedAt: 3500 } });
    assert.equal(lever.classList.contains('returning'), true);
    f.time(3500);
    assert.equal(lever.classList.contains('returning'), false);
    assert.equal(lever.classList.contains('pulled'), false);
});
test('unstarted reel keeps its inherited position, and edited settings are displayed before the next start', async () => {
    const f = await pageFixture();
    const round = { id: 2, settingsRevision: 0, options: { prize: f.current.prizes, quantity: f.current.quantities },
        initialPositions: { prize: 2, quantity: 1 }, reels: { prize: { planId: 'p' }, quantity: null } };
    f.update({ round });
    assert.equal(f.plays.at(-1).plan, null); assert.equal(f.plays.at(-1).initialPosition, 1);
    const revised = [{ optionId: 'new', name: '新的數量' }];
    f.update({ round: null, lastRound: round, settingsRevision: 1, quantities: revised });
    assert.equal(f.plays.at(-1).plan, null); assert.deepEqual(f.plays.at(-1).options, revised);
    assert.equal(f.plays.at(-1).initialPosition, 0);
});
test('automatic stop keeps lever fully pulled until stopped, including a late manual request', async () => {
    const f = await pageFixture({ state: { players: { me: { name: '小明' } } } });
    const lever = f.el('lever-left');
    const round = { id: 1, settingsRevision: 0, playerId: 'me', playerName: '小明',
        options: { prize: f.current.prizes, quantity: f.current.quantities },
        reels: { prize: { planId: 'auto-plan', stop: null }, quantity: null } };
    f.update({ round }); lever.fire('click');
    const automatic = { ...round, reels: { ...round.reels, prize: { ...round.reels.prize, stop: { source: 'auto', brakeAt: 1250, stopAt: 3500 } } } };
    f.update({ round: automatic }); await f.reply();
    for (const time of [1000, 1250, 3499]) {
        f.time(time);
        assert.equal(lever.classList.contains('returning'), false);
        assert.equal(lever.classList.contains('pulled'), true);
    }
    f.time(3500);
    assert.equal(lever.classList.contains('returning'), false);
    assert.equal(lever.classList.contains('pulled'), false);
});
test('only confirmed edits save the newest browser settings; failed edits and ordinary snapshots do not replace them', async () => {
    const f = await pageFixture({ dealer: true });
    assert.equal(f.savedSettings.size, 0);
    const settings = { settingsRevision: 1, prizes: [{ optionId: 'p1', name: '新獎品' }], quantities: [{ optionId: 'q1', name: '5' }] };
    const saving = f.saveSettings({ ...settings, baseRevision: 0 });
    assert.equal(f.savedSettings.size, 0);
    f.update(settings); assert.equal(f.savedSettings.size, 0);
    await f.reply(0, { settings }); await saving;
    assert.equal(f.savedSettings.size, 1);
    const saved = [...f.savedSettings.values()][0];
    assert.equal(saved.includes('optionId'), false);
    assert.equal(JSON.parse(saved).quantities[0].name, '5');
    const failure = assert.rejects(f.saveSettings({ baseRevision: 0 }), /版本衝突/);
    await f.reply(0, { success: false, message: '版本衝突' }); await failure;
    assert.equal([...f.savedSettings.values()][0], saved);
    f.update({ settingsRevision: 2, prizes: [{ name: '別的活動設定' }] });
    assert.equal([...f.savedSettings.values()][0], saved);
});
test('browser storage failure reports partial success without pretending server save failed', async () => {
    const f = await pageFixture({ dealer: true, settingsStorageBlocked: true });
    const settings = { settingsRevision: 1, prizes: [{ name: '咖啡' }], quantities: [{ name: '9' }] };
    const saving = f.saveSettings({ ...settings, baseRevision: 0 });
    f.update(settings); await f.reply(0, { settings });
    assert.match((await saving).persistenceWarning, /活動設定已更新.*未能保存/);
    assert.equal(f.savedSettings.size, 0);
});

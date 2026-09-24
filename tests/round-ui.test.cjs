const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the actual page script with controlled DOM events and network replies.
// These are functional tests only; no browser rendering or screenshots.
function pageFixture(options = {}) {
    class Element {
        constructor() {
            this.style = {};
            this.dataset = {};
            this.events = {};
            this.value = '';
            this.textContent = '';
            this.offsetHeight = 80;
            this.offsetWidth = 300;
            this.scrollHeight = 6400;
            this.parentElement = { offsetHeight: 240 };
            this.children = [];
            const classes = new Set();
            this.classList = { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) };
        }
        set innerHTML(html) {
            this.html = html;
            this.children = [...html.matchAll(/data-name="([^"]*)"/g)].map(match => {
                const child = new Element();
                child.dataset.name = match[1];
                return child;
            });
        }
        get innerHTML() { return this.html || ''; }
        appendChild(child) { this.children.push(child); }
        setAttribute(name, value) { (this.attributes ||= {})[name] = value; }
        querySelectorAll() { return this.children; }
        addEventListener(event, fn) { (this.events[event] ||= new Set()).add(fn); }
        removeEventListener(event, fn) { this.events[event]?.delete(fn); }
        fire(event, overrides = {}) {
            for (const fn of [...(this.events[event] || [])]) fn({ target: this, ...overrides });
        }
    }
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
    };
    const handlers = {};
    const sent = [];
    const pendingSpins = [];
    const pendingStops = [];
    const pendingJoins = [];
    const pendingRemovals = [];
    let participantSession = options.playerSession === null ? null : { token: 'a'.repeat(64), removed: false, ...options.playerSession };
    const archived = [];
    let savedToken = options.dealerToken || null;
    let deferStops = false;
    let completeReply = { success: true };
    const socket = {
        connected: true, id: 'player', on(event, fn) { handlers[event] = fn; }, timeout() { return this; },
        disconnect() { this.connected = false; handlers.disconnect(); },
        emit(event, data, callback) {
            sent.push({ event, data });
            if (event === 'joinRoom') {
                if (options.deferJoin) pendingJoins.push(callback);
                else callback(null, { success: true, role: options.joinRole || (data.spectator ? 'spectator' : 'player') });
            }
            if (event === 'removeQueuedPlayer') pendingRemovals.push({ data, callback });
            if (event === 'spin') pendingSpins.push({ data, callback });
            if (event === 'reelStopped') {
                if (deferStops) pendingStops.push(callback);
                else callback(null, { success: true });
            }
            if (event === 'turnComplete') callback(null, completeReply);
        }
    };
    const timers = new Map();
    let timerId = 0;
    const math = Object.create(Math);
    math.random = () => 0;
    const html = fs.readFileSync(path.join(__dirname, '../slot-machine.html'), 'utf8');
    const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
        .map(match => match[1]).find(source => source.includes('DOMContentLoaded'));
    vm.runInNewContext(script, {
        document: { addEventListener(event, fn) { fn(); }, getElementById: element, createElement: () => new Element() },
        window: {
            LOTTERY_CONFIG: { backendUrl: 'local-only' }, location: { search: '?room=test', href: options.href || 'http://local/?room=test' },
            LOTTERY_ROOM_SESSION: { read: () => savedToken, remove: () => { savedToken = null; } },
            LOTTERY_PLAYER_SESSION: {
                prepare: () => participantSession,
                markRemoved: () => { if (participantSession) participantSession.removed = true; return !!participantSession; }
            },
            createLotterySettingsEditor: () => ({ update() {}, disconnect() {} }),
            LOTTERY_HISTORY: { track: (state, dealer) => { if (dealer) archived.push(state); }, stop() {}, download() {} },
            getComputedStyle: () => ({ transform: 'none' })
        },
        io: () => socket, QRCode: function () {}, URLSearchParams, URL, Math: math,
        DOMMatrixReadOnly: class { constructor() { this.m42 = 0; } },
        setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; },
        clearTimeout(id) { timers.delete(id); }, console: { log() {}, warn() {} }, alert() {}
    });
    handlers.connect();
    function update(overrides = {}) {
        handlers.updateRoomState({ players: { player: { id: 'player', name: '小明' } },
            queue: ['player'], dealerId: 'dealer', prizes: [{ name: '咖啡' }], quantities: [{ name: '2' }],
            winners: [], currentTurnData: { playerId: null }, ...overrides });
    }
    update();
    return {
        sent, element, handlers, pendingSpins, pendingStops, pendingJoins, pendingRemovals, update, timers, socket, archived,
        get participantSession() { return participantSession; },
        click(type) { element(type === 'prize' ? 'lever-left' : 'lever-right').fire('click'); },
        accept(type, turnId = 1) {
            const index = pendingSpins.findIndex(request => request.data.type === type);
            assert.notEqual(index, -1);
            const request = pendingSpins.splice(index, 1)[0];
            request.callback(null, { success: true, result: type === 'prize' ? '咖啡' : '2', turnId });
        },
        stop(type) { element(`${type}-reel`).fire('transitionend', { propertyName: 'transform' }); },
        count(event) { return sent.filter(item => item.event === event).length; },
        runTimers(ms) {
            for (const [id, timer] of [...timers]) {
                if (timer.ms === ms && timers.delete(id)) timer.fn();
            }
        },
        deferStops() { deferStops = true; },
        failCompletion() { completeReply = { success: false, message: '重試' }; }
    };
}

test('only confirmed host room updates are passed to automatic history saving', () => {
    const f = pageFixture();
    assert.equal(f.archived.length, 0);
    f.update({ dealerId: 'player', winners: [{ name: '小明', prize: '咖啡', quantity: '2' }] });
    assert.equal(f.archived.length, 1);
    assert.equal(f.archived[0].winners.length, 1);
    f.update({ dealerId: 'other-host' });
    assert.equal(f.archived.length, 1);
});

test('waiting players keep the name hint and see the exact number ahead as the queue advances', () => {
    const f = pageFixture();
    const players = { player: { id: 'player', name: null }, first: { id: 'first', name: '小美' },
        second: { id: 'second', name: '小華' } };
    f.update({ players, queue: ['first', 'second', 'player'] });
    assert.equal(f.element('participant-name').placeholder, '在此輸入姓名…');
    assert.equal(f.element('draw-status').textContent, '現在輪到 小美... 再等 2 人就輪到您了');
    f.element('participant-name').value = '還在輸入';
    f.update({ players, queue: ['second', 'player'] });
    assert.equal(f.element('participant-name').value, '還在輸入');
    assert.equal(f.element('participant-name').placeholder, '在此輸入姓名…');
    assert.equal(f.element('draw-status').textContent, '現在輪到 小華... 再等 1 人就輪到您了');
    f.update({ players, queue: ['player'] });
    assert.equal(f.element('participant-name').placeholder, '在此輸入姓名…');
    assert.equal(f.element('draw-status').textContent, '輪到你了！請先輸入姓名！');
});

test('spectators and completed players are not promised another turn', () => {
    const f = pageFixture();
    const players = { player: { id: 'player', name: '小明' }, first: { id: 'first', name: '小美' } };
    f.update({ players, queue: ['first'], winners: [{ playerId: 'player', name: '小明', prize: '咖啡', quantity: '2' }] });
    assert.equal(f.element('draw-status').textContent, '現在輪到 小美...');
    f.update({ players, queue: [], winners: [{ playerId: 'player', name: '小明', prize: '咖啡', quantity: '2' }] });
    assert.equal(f.element('draw-status').textContent, '您已完成抽獎。');
    f.update({ players: { player: { id: 'player', removed: true } }, queue: [] });
    assert.equal(f.element('draw-status').textContent, '觀看模式');
});

test('Enter submits a name after composition, and rejection restores waiting status without losing the hint', () => {
    const f = pageFixture();
    const players = { player: { id: 'player', name: null }, first: { id: 'first', name: '小美' } };
    f.update({ players, queue: ['first', 'player'] });
    const input = f.element('participant-name');
    input.value = '小明';
    input.fire('keydown', { key: 'Enter', isComposing: true });
    assert.equal(f.count('setPlayerName'), 0);
    input.fire('keydown', { key: 'Enter', preventDefault() {} });
    assert.equal(f.count('setPlayerName'), 1);
    f.handlers.nameError('姓名重複');
    assert.equal(input.value, '');
    assert.equal(input.placeholder, '在此輸入姓名…');
    assert.equal(f.element('draw-status').textContent, '現在輪到 小美... 再等 1 人就輪到您了');
    input.value = '新名字';
    input.fire('keydown', { key: 'Enter', preventDefault() {} });
    f.update({ players: { ...players, player: { id: 'player', name: '新名字' } }, queue: ['first', 'player'] });
    input.fire('change');
    assert.equal(f.count('setPlayerName'), 2);
    assert.equal(input.value, '新名字');
});

test('host queue removes directly, disables duplicate clicks and hides feedback on success', () => {
    const f = pageFixture();
    const state = { dealerId: 'player', queue: ['target'], players: {
        player: { id: 'player' }, target: { id: 'target', name: '<小明>' }
    } };
    f.update(state);
    const row = f.element('queue-list').children[0];
    const removeButton = row.children[2];
    assert.equal(removeButton.textContent, 'X');
    assert.equal(removeButton.attributes['aria-label'], '將<小明>移出隊伍');
    removeButton.fire('click'); removeButton.fire('click');
    assert.equal(f.pendingRemovals.length, 1);
    assert.equal(f.pendingRemovals[0].data.playerId, 'target');
    assert.equal(f.element('queue-list').children[0].children[2].disabled, true);
    f.update({ ...state, queue: [] });
    f.pendingRemovals[0].callback(null, { success: true });
    assert.equal(f.element('queue-feedback').textContent, '');
    assert.equal(f.element('queue-feedback').hidden, true);
    assert.equal(f.element('queue-empty').hidden, false);
});

test('active players have lock status rather than remove controls; ordinary players have no controls', () => {
    const f = pageFixture();
    assert.equal(f.element('queue-list').children[0].children.length, 2);
    f.update({ dealerId: 'player', queue: ['target'], players: { target: { id: 'target', name: '小美' } },
        currentTurnData: { id: 1, playerId: 'target' } });
    const row = f.element('queue-list').children[0];
    assert.equal(row.className, 'queue-active');
    assert.equal(row.children[2].className, 'queue-locked');
    assert.equal(row.children[2].children[1].textContent, '抽獎中');
});

test('removal errors/timeouts permit retry and a late host reply cannot update a replacement session', () => {
    const f = pageFixture();
    const state = { dealerId: 'player', queue: ['target'], players: { target: { id: 'target', name: '小明' } } };
    f.update(state);
    f.element('queue-list').children[0].children[2].fire('click');
    f.pendingRemovals[0].callback(null, { success: false, message: '玩家已開始抽獎，無法移出。' });
    assert.match(f.element('queue-feedback').textContent, /已開始/);
    f.element('queue-list').children[0].children[2].fire('click');
    f.pendingRemovals[1].callback(Error('timeout'));
    assert.match(f.element('queue-feedback').textContent, /未收到移出確認/);
    f.element('queue-list').children[0].children[2].fire('click');
    f.socket.disconnect();
    f.pendingRemovals[2].callback(null, { success: true });
    assert.equal(f.element('queue-feedback').hidden, true);
});

test('removed player remains connected for viewing, cannot spin or rename, and reconnects as spectator', () => {
    const f = pageFixture();
    f.handlers.removedFromQueue({ roomId: 'other' });
    assert.equal(f.participantSession.removed, false);
    f.handlers.removedFromQueue({ roomId: 'test' });
    assert.equal(f.socket.connected, true);
    assert.equal(f.participantSession.removed, true);
    assert.equal(f.element('queue-spectator-notice').hidden, false);
    f.click('prize');
    f.element('participant-name').value = '新名字';
    f.element('participant-name').fire('change');
    assert.equal(f.count('spin'), 0);
    assert.equal(f.count('setPlayerName'), 0);
    f.socket.disconnect(); f.socket.connected = true; f.handlers.connect();
    const joins = f.sent.filter(item => item.event === 'joinRoom');
    assert.equal(joins.at(-1).data.spectator, true);
    assert.equal(joins.at(-1).data.participantToken, f.participantSession.token);
    assert.doesNotMatch(f.element('room-url-input').value, /token|spectator|aaaa/);
    const reloaded = pageFixture({ playerSession: { ...f.participantSession } });
    assert.equal(reloaded.sent.find(item => item.event === 'joinRoom').data.spectator, true);
});

test('room state recovers a missed removal event and unsupported servers cannot requeue spectators', () => {
    const f = pageFixture();
    f.update({ queue: [], players: { player: { id: 'player', name: '小明', removed: true } } });
    assert.equal(f.participantSession.removed, true);
    assert.equal(f.element('participant-name').disabled, true);
    const unsupported = pageFixture({ playerSession: { removed: true }, joinRole: 'player' });
    assert.equal(unsupported.socket.connected, false);
    const blocked = pageFixture({ playerSession: null });
    assert.equal(blocked.sent.find(item => item.event === 'joinRoom').data.spectator, true);
    assert.match(blocked.element('queue-spectator-notice').textContent, /無法保存分頁身分/);
});

for (const order of [['prize', 'quantity'], ['quantity', 'prize']]) {
    test(`page waits for both actual stop events (${order.join(' then ')})`, () => {
        const f = pageFixture();
        for (const type of order) { f.click(type); f.accept(type); f.click(type); }
        assert.equal(f.count('turnComplete'), 0);
        f.stop(order[0]);
        assert.equal(f.count('reelStopped'), 1);
        assert.equal(f.count('turnComplete'), 0);
        f.stop(order[1]);
        assert.equal(f.count('reelStopped'), 2);
        assert.equal(f.count('turnComplete'), 1);
        f.stop(order[1]);
        f.runTimers(2600);
        assert.equal(f.count('turnComplete'), 1);
    });
}

test('starting the second reel does not re-render the first stopped result', () => {
    const f = pageFixture();
    f.click('prize'); f.accept('prize'); f.click('prize'); f.stop('prize');
    const originalItems = f.element('prize-reel').children;
    f.click('quantity'); f.accept('quantity');
    assert.equal(f.element('prize-reel').children, originalItems);
    assert.equal(f.count('turnComplete'), 0);
    f.click('quantity'); f.stop('quantity');
    assert.equal(f.count('turnComplete'), 1);
});

test('rapid clicks await server acceptance and a timeout can safely retry', () => {
    const f = pageFixture();
    f.click('prize'); f.click('prize');
    assert.equal(f.count('spin'), 1);
    assert.equal(f.count('broadcastAnimation'), 0);
    const failed = f.pendingSpins.shift();
    failed.callback(new Error('timeout'));
    f.click('prize'); f.accept('prize');
    assert.equal(f.count('spin'), 2);
    assert.equal(f.count('broadcastAnimation'), 2);
    assert.equal('playerName' in f.sent.find(item => item.event === 'spin').data, false);
});

test('auto-stop and fallback timer finish once even if transitionend is absent', () => {
    const f = pageFixture();
    for (const type of ['prize', 'quantity']) { f.click(type); f.accept(type); }
    f.runTimers(4000);
    assert.equal(f.count('turnComplete'), 0);
    f.runTimers(2600);
    assert.equal(f.count('turnComplete'), 1);
    f.stop('prize'); f.stop('quantity');
    assert.equal(f.count('turnComplete'), 1);
});

test('unrelated transition events cannot finish a reel', () => {
    const f = pageFixture();
    f.click('prize'); f.accept('prize'); f.click('prize');
    f.element('prize-reel').fire('transitionend', { propertyName: 'opacity' });
    f.element('prize-reel').fire('transitionend', { propertyName: 'transform', target: {} });
    assert.equal(f.count('reelStopped'), 0);
    f.stop('prize');
    assert.equal(f.count('reelStopped'), 1);
});

test('completion waits for both stop acknowledgements and can retry a failed completion', () => {
    const f = pageFixture();
    f.deferStops();
    f.failCompletion();
    for (const type of ['prize', 'quantity']) { f.click(type); f.accept(type); f.click(type); f.stop(type); }
    assert.equal(f.count('turnComplete'), 0);
    f.pendingStops[1](null, { success: true });
    assert.equal(f.count('turnComplete'), 0);
    f.pendingStops[0](null, { success: true });
    assert.equal(f.count('turnComplete'), 1);
    f.click('prize');
    assert.equal(f.count('turnComplete'), 2);
    assert.equal(f.count('spin'), 2);
});

test('round change cancels old animation events and timers', () => {
    const f = pageFixture();
    for (const type of ['prize', 'quantity']) { f.click(type); f.accept(type); f.click(type); }
    f.update({ queue: ['next'] });
    f.stop('prize'); f.stop('quantity'); f.runTimers(2600);
    assert.equal(f.count('reelStopped'), 0);
    assert.equal(f.count('turnComplete'), 0);
});

test('name is not usable for drawing until the server confirms it', () => {
    const f = pageFixture();
    f.update({ players: { player: { id: 'player', name: null } } });
    f.element('participant-name').value = '新名字';
    f.element('participant-name').fire('change');
    f.click('prize');
    assert.equal(f.count('spin'), 0);
    f.update({ players: { player: { id: 'player', name: '新名字' } } });
    f.click('prize');
    assert.equal(f.count('spin'), 1);
});

test('unrelated room updates do not erase a name being typed', () => {
    const f = pageFixture();
    f.element('participant-name').value = '還在輸入';
    f.update();
    assert.equal(f.element('participant-name').value, '還在輸入');
});

test('reload and reconnect send the saved host credential but never put it in the share URL', () => {
    const token = 'a'.repeat(64);
    const f = pageFixture({ dealerToken: token, href: `http://local/?room=test&extra=${token}#private` });
    assert.equal(f.sent.find(item => item.event === 'joinRoom').data.dealerToken, token);
    assert.equal(f.element('room-url-input').value, 'http://local/?room=test');
    f.handlers.disconnect();
    f.socket.id = 'restored';
    f.handlers.connect();
    const joins = f.sent.filter(item => item.event === 'joinRoom');
    assert.equal(joins.length, 2);
    assert.equal(joins[1].data.dealerToken, token);
    f.update({ dealerId: 'restored', players: { restored: { id: 'restored', name: null } } });
    assert.equal(f.element('prize-management').style.display, 'block');
    assert.equal(f.element('participant-name').disabled, true);
});

test('join timeout retries the same identity and blocks drawing until acknowledgement', () => {
    const f = pageFixture({ deferJoin: true });
    f.click('prize');
    assert.equal(f.count('spin'), 0);
    f.pendingJoins.shift()(new Error('timeout'));
    f.runTimers(1000);
    assert.equal(f.count('joinRoom'), 2);
    f.pendingJoins.shift()(null, { success: true });
    f.click('prize');
    assert.equal(f.count('spin'), 1);
});

test('late join replies from a disconnected socket cannot unlock a new connection', () => {
    const f = pageFixture({ deferJoin: true });
    const oldReply = f.pendingJoins.shift();
    f.handlers.disconnect();
    f.handlers.connect();
    f.update();
    oldReply(null, { success: true });
    f.click('prize');
    assert.equal(f.count('spin'), 0);
    f.pendingJoins.shift()(null, { success: true });
    f.click('prize');
    assert.equal(f.count('spin'), 1);
});

test('replaced host closes its connection and does not automatically reclaim control', () => {
    const f = pageFixture({ dealerToken: 'a'.repeat(64) });
    f.update({ dealerId: 'player' });
    assert.equal(f.element('prize-management').style.display, 'block');
    f.handlers.dealerReplaced({ roomId: 'test' });
    assert.equal(f.socket.connected, false);
    assert.equal(f.element('prize-management').style.display, 'none');
    assert.match(f.element('draw-status').textContent, /另一個分頁/);
    f.socket.connected = true;
    f.handlers.connect();
    assert.equal(f.count('joinRoom'), 1);
    assert.equal(f.socket.connected, false);
});

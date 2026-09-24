const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../room-session.js'), 'utf8');

function browser(storage = new Map(), backendUrl = 'http://127.0.0.1:3001') {
    const window = {
        LOTTERY_CONFIG: { backendUrl },
        crypto: require('node:crypto').webcrypto,
        sessionStorage: { getItem: key => storage.get(key) || null,
            setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
    };
    vm.runInNewContext(source, { window });
    return window;
}

test('host credential survives a page reload and is isolated by tab, backend and room', () => {
    const storage = new Map();
    const first = browser(storage).LOTTERY_ROOM_SESSION;
    const token = 'a'.repeat(64);
    assert.equal(first.save('room_a', token), true);
    assert.equal(browser(storage).LOTTERY_ROOM_SESSION.read('room_a'), token);
    assert.equal(browser().LOTTERY_ROOM_SESSION.read('room_a'), null);
    assert.equal(browser(storage, 'https://example.com').LOTTERY_ROOM_SESSION.read('room_a'), null);
    assert.equal(first.read('room_b'), null);
    first.remove('room_a');
    assert.equal(first.read('room_a'), null);
});

test('participant tab identity and removal survive reload without sharing host credentials', () => {
    const storage = new Map();
    const first = browser(storage).LOTTERY_PLAYER_SESSION;
    const prepared = first.prepare('room_a');
    assert.match(prepared.token, /^[a-f0-9]{64}$/);
    assert.equal(prepared.removed, false);
    assert.equal(first.markRemoved('room_a'), true);
    const reloaded = browser(storage);
    assert.equal(reloaded.LOTTERY_PLAYER_SESSION.prepare('room_a').token, prepared.token);
    assert.equal(reloaded.LOTTERY_PLAYER_SESSION.prepare('room_a').removed, true);
    assert.equal(reloaded.LOTTERY_ROOM_SESSION.read('room_a'), null);
    assert.equal(first.prepare('room_b').removed, false);
    assert.notEqual(browser().LOTTERY_PLAYER_SESSION.prepare('room_a').token, prepared.token);
    assert.equal(browser(storage, 'different-backend').LOTTERY_PLAYER_SESSION.prepare('room_a').removed, false);
});

test('unavailable storage or damaged identity cannot silently create a new place in the queue', () => {
    const window = browser();
    window.sessionStorage.setItem = () => { throw Error('blocked'); };
    assert.equal(window.LOTTERY_PLAYER_SESSION.prepare('room_a'), null);
    assert.equal(window.LOTTERY_PLAYER_SESSION.markRemoved('room_a'), false);
    const storage = new Map([['lottery:participant:http://127.0.0.1:3001:room_a', '{broken']]);
    assert.equal(browser(storage).LOTTERY_PLAYER_SESSION.prepare('room_a'), null);
    storage.set('lottery:participant:http://127.0.0.1:3001:room_a', JSON.stringify({ token: 'bad', removed: true }));
    assert.equal(browser(storage).LOTTERY_PLAYER_SESSION.prepare('room_a'), null);
});

test('blocked browser storage and invalid credentials fail gracefully', () => {
    const window = { LOTTERY_CONFIG: { backendUrl: 'local-only' } };
    Object.defineProperty(window, 'sessionStorage', { get() { throw Error('storage blocked'); } });
    vm.runInNewContext(source, { window });
    assert.equal(window.LOTTERY_ROOM_SESSION.read('room_a'), null);
    assert.equal(window.LOTTERY_ROOM_SESSION.save('room_a', 'a'.repeat(64)), false);
    assert.doesNotThrow(() => window.LOTTERY_ROOM_SESSION.remove('room_a'));
    const session = browser().LOTTERY_ROOM_SESSION;
    for (const token of [null, '', 'short', {}, 'g'.repeat(64)]) assert.equal(session.save('room_a', token), false);
});

test('participant identity is scoped to activity and removed flag survives reload within that activity', () => {
    const storage = new Map(); const session = browser(storage).LOTTERY_PLAYER_SESSION;
    const first = session.prepare('room_a', 'activity1'); session.markRemoved('room_a', 'activity1');
    const reloaded = browser(storage).LOTTERY_PLAYER_SESSION;
    assert.equal(reloaded.prepare('room_a', 'activity1').token, first.token);
    assert.equal(reloaded.prepare('room_a', 'activity1').removed, true);
    assert.notEqual(reloaded.prepare('room_a', 'activity2').token, first.token);
    assert.equal(reloaded.prepare('room_a', 'activity2').removed, false);
});

async function lobby({ response, blockStorage = false, savedSettings = null }) {
    const window = browser();
    window.LotteryProtocol = require('../game-protocol.js');
    window.LotterySettingsRules = require('../settings-rules.js');
    window.LotterySettingsStore = require('../settings-store.js');
    const local = new Map();
    window.localStorage = { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value) };
    if (savedSettings) window.LotterySettingsStore.create(() => window.localStorage, window.LOTTERY_CONFIG.backendUrl).save(savedSettings);
    const requests = [];
    window.location = { href: 'index.html' };
    if (blockStorage) window.sessionStorage.setItem = () => { throw Error('blocked'); };
    const button = { disabled: false, textContent: '', addEventListener(event, fn) { this.click = fn; } };
    const messages = [];
    const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
        if (!match[1].trim()) continue;
        vm.runInNewContext(match[1], { window, document: { getElementById: () => button },
            fetch: async (url, options) => { requests.push({ url, options }); return { json: async () => response }; }, alert: message => messages.push(message),
            console: { error() {} } });
    }
    button.click();
    await new Promise(resolve => setImmediate(resolve));
    return { window, button, messages, requests };
}

test('lobby stores host credential before opening a room-only URL', async () => {
    const token = 'a'.repeat(64);
    const result = await lobby({ response: { protocolVersion: 2, success: true, roomId: 'room_a', dealerToken: token } });
    assert.equal(result.window.LOTTERY_ROOM_SESSION.read('room_a'), token);
    assert.equal(result.window.location.href, 'slot-machine.html?room=room_a');
    assert.equal(result.messages.length, 0);
});

test('lobby explains stale backend and unavailable storage without opening an unusable host page', async () => {
    const stale = await lobby({ response: { protocolVersion: 2, success: true, roomId: 'room_a' } });
    assert.equal(stale.window.location.href, 'index.html');
    assert.equal(stale.button.disabled, false);
    assert.match(stale.messages[0], /舊版/);
    const blocked = await lobby({ response: { protocolVersion: 2, success: true, roomId: 'room_a', dealerToken: 'a'.repeat(64) }, blockStorage: true });
    assert.equal(blocked.window.location.href, 'index.html');
    assert.equal(blocked.button.disabled, false);
    assert.match(blocked.messages[0], /無法保存主持人身分/);
});
test('new activity request contains the browser latest settings, or defaults when none are saved', async () => {
    const savedSettings = { prizes: [{ name: '自訂禮物' }], quantities: [{ name: '6' }, { name: '6' }] };
    const response = { success: true, protocolVersion: 2, roomId: 'room_new', dealerToken: 'a'.repeat(64) };
    const saved = await lobby({ response, savedSettings });
    assert.deepEqual(JSON.parse(saved.requests[0].options.body).settings, savedSettings);
    assert.equal(saved.requests[0].options.headers['Content-Type'], 'application/json');
    const empty = await lobby({ response });
    assert.deepEqual(JSON.parse(empty.requests[0].options.body).settings, require('../settings-rules.js').defaults());
});

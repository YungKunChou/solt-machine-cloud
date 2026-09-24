const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backendReady } = require('../scripts/backend-ready.cjs');
const { createLotteryServer } = require('../index.js');
const protocol = require('../game-protocol.js');

test('launcher recognizes the real backend through its dedicated health endpoint', async t => {
    const { server, io, service } = createLotteryServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { service.dispose(); await new Promise(resolve => io.close(resolve)); });
    const url = 'http://127.0.0.1:' + server.address().port;
    assert.equal(await backendReady(url), true);
    const response = await fetch(url + '/health');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { app: 'lottery-backend', ready: true, protocolVersion: protocol.VERSION });
});

test('launcher rejects wrong service, incompatible version, not-ready state and HTTP errors', async () => {
    const valid = { app: 'lottery-backend', ready: true, protocolVersion: protocol.VERSION };
    for (const status of [null, {}, { ...valid, app: 'other' }, { ...valid, ready: false }, { ...valid, protocolVersion: 1 }]) {
        assert.equal(await backendReady('http://test', async () => ({ ok: true, json: async () => status })), false);
    }
    assert.equal(await backendReady('http://test', async () => ({ ok: false })), false);
    await assert.rejects(backendReady('http://test', async () => { throw Error('connection refused'); }));
});

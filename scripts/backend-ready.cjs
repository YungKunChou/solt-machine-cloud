const protocol = require('../game-protocol.js');

async function backendReady(baseUrl, request = fetch) {
    const response = await request(baseUrl + '/health', { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    const status = await response.json();
    return status?.app === 'lottery-backend' && status.ready === true && protocol.compatible(status.protocolVersion);
}

module.exports = { backendReady };

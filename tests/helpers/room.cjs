const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const rules = require('../../settings-rules.js');

// Run the real server handlers in isolation, without contacting any live service.
function roomFixture() {
    const routes = {};
    let connect;
    let currentState;
    let broadcasts = 0;
    let randomCalls = 0;
    const animations = [];
    const notifications = [];
    const app = { use() {}, get() {}, post(route, handler) { routes[route] = handler; } };
    class Server {
        on(event, handler) { connect = handler; }
        to(target) { return { emit(event, state) {
            if (event === 'updateRoomState') { currentState = state; broadcasts++; }
            else notifications.push({ target, event, data: state });
        } }; }
    }
    const math = Object.create(Math);
    math.random = () => { randomCalls++; return randomCalls % 2 ? 0.1 : 0.9; };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../index.js'), 'utf8'), {
        require(name) { return {
            express: () => app,
            http: { createServer: () => ({ listen() {} }) },
            'socket.io': { Server }, cors: () => () => {}, './settings-rules.js': rules,
            'node:crypto': require('node:crypto')
        }[name]; },
        Math: math, process: { env: {} }, console: { log() {} }
    });
    let roomId, dealerToken;
    routes['/create-room']({}, { json(data) { ({ roomId, dealerToken } = data); } });
    function client(id) {
        const handlers = {};
        const events = [];
        connect({ id, join() {}, on(event, callback) { handlers[event] = callback; },
            emit(event, data) { events.push({ event, data }); },
            to: () => ({ emit(event, data) { animations.push({ event, data }); } }) });
        return { events, send(event, data) {
            let reply;
            handlers[event](data, value => { reply = value; });
            return reply;
        } };
    }
    const dealer = client('dealer');
    const player = client('player');
    dealer.send('joinRoom', { roomId, dealerToken });
    player.send('joinRoom', roomId);
    return { dealer, player, client, roomId, dealerToken, animations, notifications,
        get state() { return currentState; }, get broadcasts() { return broadcasts; },
        get randomCalls() { return randomCalls; } };
}
module.exports = { roomFixture };

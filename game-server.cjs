'use strict';
const { randomBytes, randomInt } = require('node:crypto');
const P = require('./game-protocol.js');
const Rules = require('./settings-rules.js');
const { RoundEngine } = require('./round-engine.cjs');
const tokenOK = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
const mismatch = '頁面與服務版本不相容，請更新後端並重新整理頁面。';

function createGameService(io, dependencies = {}) {
    const now = dependencies.now || Date.now;
    const setTimer = dependencies.setTimer || setTimeout;
    const clearTimer = dependencies.clearTimer || clearTimeout;
    const pick = dependencies.pick || randomInt;
    const id = dependencies.id || (() => randomBytes(16).toString('hex'));
    const rooms = new Map();
    function snapshot(room) {
        const current = room.engine.publicRound();
        return structuredClone({ protocolVersion: P.VERSION, id: room.id, activityId: room.activityId,
            createdAt: room.createdAt, stateVersion: room.stateVersion, settingsRevision: room.settingsRevision,
            dealerId: room.dealerId, players: room.players, queue: room.queue, winners: room.winners,
            prizes: room.prizes, quantities: room.quantities, round: current,
            lastRound: room.engine.publicRound(room.engine.last),
            currentTurnData: current || { id: null, playerId: null, playerName: null } });
    }
    function touch(room) { room.stateVersion++; io.to(room.id).emit('updateRoomState', snapshot(room)); }
    function options(rows) { return rows.map(({ name }) => ({ optionId: id(), name })); }
    function createRoom(initialSettings = Rules.defaults()) {
        const checked = Rules.validate(initialSettings?.prizes, initialSettings?.quantities);
        if (!checked.valid) throw Error(checked.errors[0].message);
        const room = { id: 'room_' + id(), activityId: id(), createdAt: now(), stateVersion: 0,
            settingsRevision: 0, dealerId: 'host_' + id(), dealerToken: randomBytes(32).toString('hex'),
            players: Object.create(null), queue: [], winners: [], tokens: new Map(), connections: new Map(), operations: new Map(),
            prizes: options(checked.prizes), quantities: options(checked.quantities) };
        room.engine = new RoundEngine({ now, setTimer, clearTimer, pick, id, changed: () => touch(room),
            completed(round) {
                if (room.winners.some(w => w.turnId === round.id)) return;
                room.winners.push({ turnId: round.id, playerId: round.playerId, name: round.playerName,
                    prize: round.results.prize.name, quantity: round.results.quantity.name,
                    prizeOptionId: round.results.prize.optionId, quantityOptionId: round.results.quantity.optionId });
                room.players[round.playerId].completed = true;
                room.queue = room.queue.filter(pid => pid !== round.playerId);
            } });
        rooms.set(room.id, room);
        return { success: true, protocolVersion: P.VERSION, roomId: room.id, activityId: room.activityId, dealerToken: room.dealerToken };
    }
    function connect(socket) {
        const memberships = new Map();
        const fail = (message, operationId) => ({ success: false, message, operationId, protocolVersion: P.VERSION });
        socket.on('getRoomInfo', (payload, ack) => {
            const room = rooms.get(payload?.roomId);
            ack?.(room ? { success: true, protocolVersion: P.VERSION, activityId: room.activityId, serverTime: now() }
                : fail('房間不存在，請從首頁建立新房間。'));
        });
        socket.on('clockSync', (payload, ack) => ack?.({ protocolVersion: P.VERSION, serverTime: now() }));
        socket.on('joinRoom', (payload, ack) => {
            const reply = result => typeof ack === 'function' ? ack(result) : socket.emit('error', result.message || mismatch);
            if (!P.compatible(payload?.protocolVersion)) return reply(fail(mismatch));
            const room = rooms.get(payload.roomId);
            if (!room || room.activityId !== payload.activityId) return reply(fail('活動已失效，請從首頁建立新房間。'));
            room.engine.advance();
            const host = tokenOK(payload.dealerToken) && payload.dealerToken === room.dealerToken;
            if (payload.dealerToken != null && !host) return reply(fail('無法確認主持人身分，請使用原本建立房間的分頁。'));
            const oldMembership = memberships.get(room.id);
            if (oldMembership && room.connections.get(oldMembership) !== socket.id) return reply(fail('此連線已被接管，請使用最新的分頁。'));
            if (!host && payload.participantToken != null && !tokenOK(payload.participantToken)) return reply(fail('分頁識別無效，請重新開啟活動。'));
            let pid = host ? room.dealerId : room.tokens.get(payload.participantToken);
            if (!pid) {
                if (!payload.participantToken && !payload.spectator) return reply(fail('無法保存參加者身分，目前僅能觀看。'));
                pid = oldMembership || id();
                if (payload.participantToken) room.tokens.set(payload.participantToken, pid);
            }
            if (oldMembership && oldMembership !== pid) return reply(fail('同一連線不能更換參加者身分。'));
            const previousSocket = room.connections.get(pid);
            if (previousSocket && previousSocket !== socket.id) io.to(previousSocket).emit(host ? 'dealerReplaced' : 'participantReplaced', { roomId: room.id, activityId: room.activityId });
            const player = room.players[pid] ||= { id: pid, name: null, removed: false, completed: false, connected: false };
            let changed = !player.connected || previousSocket !== socket.id;
            player.connected = true;
            if (!host && payload.spectator === true && room.engine.current?.playerId !== pid) {
                changed ||= !player.removed;
                player.removed = true;
                room.queue = room.queue.filter(id => id !== pid);
            }
            room.connections.set(pid, socket.id);
            memberships.set(room.id, pid);
            socket.join(room.id);
            if (!host && !player.removed && !player.completed && !room.queue.includes(pid)) room.queue.push(pid);
            if (changed) touch(room);
            reply({ success: true, protocolVersion: P.VERSION, participantId: pid,
                role: host ? 'dealer' : player.removed ? 'spectator' : 'player', snapshot: snapshot(room) });
        });
        function authorize(payload) {
            if (!P.compatible(payload?.protocolVersion)) throw Error(mismatch);
            const room = rooms.get(payload.roomId);
            if (!room || room.activityId !== payload.activityId) throw Error('活動已失效，請重新加入。');
            const pid = memberships.get(room.id);
            if (!pid || room.connections.get(pid) !== socket.id) throw Error('操作身分已失效，請使用最新連線。');
            room.engine.advance();
            return { room, pid, player: room.players[pid], host: pid === room.dealerId };
        }
        socket.on('getSnapshot', (payload, ack) => {
            try { const { room } = authorize(payload); ack?.({ success: true, snapshot: snapshot(room) }); }
            catch (error) { ack?.(fail(error.message)); }
        });
        function command(name, action) {
            socket.on(name, (payload, ack) => {
                let result;
                try {
                    const context = authorize(payload);
                    if (typeof payload.operationId !== 'string' || !/^[\w-]{8,80}$/.test(payload.operationId)) throw Error('操作識別無效，請重新整理。');
                    const { room, pid } = context;
                    const key = pid + ':' + payload.operationId;
                    const fingerprint = JSON.stringify({ name, payload });
                    const prior = room.operations.get(key);
                    if (prior) {
                        if (prior.fingerprint !== fingerprint) throw Error('操作識別已使用，不能更換指令內容。');
                        result = prior.result;
                    } else {
                        try { result = { success: true, ...action(context, payload) }; }
                        catch (error) { result = fail(error.message, payload.operationId); }
                        result = { ...result, operationId: payload.operationId, protocolVersion: P.VERSION,
                            activityId: room.activityId, snapshot: snapshot(room) };
                        room.operations.set(key, { fingerprint, result });
                    }
                } catch (error) { result = fail(error.message, payload?.operationId); }
                if (typeof ack === 'function') ack(result); else socket.emit('error', result.message || '操作完成');
            });
        }
        command('setPlayerName', ({ room, pid, player, host }, payload) => {
            if (host || player.removed || player.completed) throw Error('目前不能登記或更改姓名。');
            if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.trim().length > 80) throw Error('姓名須為 1 至 80 字，不能只填空白。');
            const name = payload.name.trim();
            if (room.engine.current?.playerId === pid && name !== player.name) throw Error('本輪抽獎已開始，無法更改姓名。');
            if (Object.values(room.players).some(p => p.id !== pid && p.connected && !p.removed && p.name === name) || room.winners.some(w => w.name === name)) throw Error('這個名字已經被使用或已抽過獎，請確認姓名。');
            if (name !== player.name) { player.name = name; touch(room); }
        });
        command('removeQueuedPlayer', ({ room, host }, payload) => {
            if (!host) throw Error('只有此房間的莊家可以移出玩家。');
            const player = room.players[payload.playerId];
            if (!player || player.id === room.dealerId) throw Error('此玩家已不在隊伍中。');
            if (player.removed) return { alreadyRemoved: true };
            if (room.engine.current?.playerId === player.id) throw Error('玩家已開始抽獎，無法移出。');
            if (!room.queue.includes(player.id)) throw Error('此玩家已不在隊伍中。');
            player.removed = true;
            room.queue = room.queue.filter(pid => pid !== player.id);
            const target = room.connections.get(player.id);
            if (target) io.to(target).emit('removedFromQueue', { roomId: room.id, activityId: room.activityId });
            touch(room);
        });
        command('updateSettings', ({ room, host }, payload) => {
            if (!host) throw Error('只有此房間的主持人可以修改設定。');
            if (room.engine.current) throw Error('玩家正在抽獎，請待本輪結束後儲存。');
            if (payload.baseRevision !== room.settingsRevision) throw Error('設定已更新，請取消編輯後重新載入最新設定。');
            const checked = Rules.validate(payload.prizes, payload.quantities);
            if (!checked.valid) throw Error(checked.errors[0].message);
            const next = {};
            for (const type of ['prizes', 'quantities']) {
                const allowed = new Set(room[type].map(row => row.optionId));
                const used = new Set();
                next[type] = checked[type].map(row => {
                    if (row.optionId && (!allowed.has(row.optionId) || used.has(row.optionId))) throw Error('選項識別無效，請重新載入設定。');
                    const optionId = row.optionId || id(); used.add(optionId);
                    return { optionId, name: row.name };
                });
            }
            Object.assign(room, next); room.settingsRevision++; touch(room);
            return { settings: { ...next, settingsRevision: room.settingsRevision } };
        });
        function checkPlayer({ room, pid, player, host }) {
            if (host || player.removed || player.completed || room.queue[0] !== pid) throw Error('尚未輪到你抽獎，或你已完成抽獎。');
            if (!player.name) throw Error('請先登記姓名再抽獎。');
            if (room.winners.some(w => w.playerId === pid || w.name === player.name)) throw Error('此參加者已經抽過獎。');
        }
        command('startReel', (context, payload) => {
            const { room, player } = context; checkPlayer(context);
            if (!P.TYPES.includes(payload.type)) throw Error('無效的滾輪類型。');
            const active = room.engine.current;
            if (payload.roundId != null && payload.roundId !== active?.id) throw Error('回合已變更，請同步後再試。');
            if (active && active.playerId !== player.id) throw Error('回合歸屬不符。');
            if (!Rules.validate(room.prizes, room.quantities).valid) throw Error('請先將獎項及數量設定調整為各 1～10 筆。');
            if (!active?.reels[payload.type]) room.engine.begin(player, room, payload.type);
            return { roundId: room.engine.current.id };
        });
        command('stopReel', (context, payload) => {
            checkPlayer(context);
            const { room } = context;
            if (!P.TYPES.includes(payload.type) || payload.roundId !== room.engine.current?.id) throw Error('回合已變更，請同步後再試。');
            room.engine.stop(payload.type); return { roundId: room.engine.current.id };
        });
        for (const event of ['spin', 'reelStopped', 'turnComplete', 'broadcastAnimation', 'updatePrizes', 'updateQuantities']) {
            socket.on(event, (payload, ack) => {
                if (typeof ack === 'function') ack(fail(mismatch)); else socket.emit('error', mismatch);
            });
        }
        socket.on('disconnect', () => {
            for (const [roomId, pid] of memberships) {
                const room = rooms.get(roomId);
                if (!room || room.connections.get(pid) !== socket.id) continue;
                room.engine.advance(); room.connections.delete(pid); room.players[pid].connected = false;
                if (room.engine.current?.playerId !== pid) room.queue = room.queue.filter(id => id !== pid);
                touch(room);
            }
        });
    }
    return { createRoom, connect, dispose() { for (const room of rooms.values()) room.engine.dispose(); } };
}
module.exports = { createGameService };

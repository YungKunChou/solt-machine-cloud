// index.js (同步動畫版 v6)
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');
const settingsRules = require('./settings-rules.js');
const { randomBytes } = require('node:crypto');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const gameRooms = Object.create(null);
// Keep host credentials outside the public room state and all room broadcasts.
const dealerCredentials = new WeakMap();

function emptyTurn() {
    return { id: null, playerId: null, playerName: null, prize: null, quantity: null,
        stopped: { prize: false, quantity: false } };
}
const isReelType = type => type === 'prize' || type === 'quantity';

// 健康檢查路徑
app.get('/', (req, res) => {
    res.status(200).send('Game server with animation sync is running.');
});

app.post('/create-room', (req, res) => {
    const roomId = `room_${Math.random().toString(36).substr(2, 6)}`;
    gameRooms[roomId] = {
        id: roomId,
        dealerId: null,
        players: {},
        queue: [],
        winners: [],
        settingsRevision: 0,
        turnSequence: 0,
        currentTurnData: emptyTurn(),
        prizes: [ 
            { name: '大杯美式咖啡' }, 
            { name: '特大美式咖啡' }, 
            { name: '大杯拿鐵咖啡' }, 
            { name: '特大拿鐵咖啡' }, 
            { name: '星巴克焦糖瑪奇朵' } 
        ],
        quantities: [ 
            { name: '1' }, 
            { name: '2' }, 
            { name: '3' }
        ]
    };
    const dealerToken = randomBytes(32).toString('hex');
    dealerCredentials.set(gameRooms[roomId], dealerToken);
    console.log(`新房間已建立: ${roomId}`);
    res.set?.('Cache-Control', 'no-store');
    res.json({ success: true, roomId, dealerToken });
});

function broadcastRoomState(roomId) {
    if (gameRooms[roomId]) {
        io.to(roomId).emit('updateRoomState', gameRooms[roomId]);
    }
}

io.on('connection', (socket) => {
    console.log('一位玩家連線:', socket.id);

    socket.on('joinRoom', (payload, ack) => {
        // String payloads remain valid for participant links from older pages.
        const { roomId, dealerToken } = typeof payload === 'string' ? { roomId: payload } : (payload || {});
        const reply = result => {
            if (typeof ack === 'function') ack(result);
            else if (!result.success) socket.emit('error', result.message);
        };
        if (typeof roomId !== 'string' || !Object.hasOwn(gameRooms, roomId)) {
            reply({ success: false, message: '房間不存在，請從首頁建立新房間。' });
            return;
        }
        const room = gameRooms[roomId];
        const isRestoringDealer = typeof dealerToken === 'string' && dealerToken === dealerCredentials.get(room);
        if (dealerToken != null && !isRestoringDealer) {
            reply({ success: false, message: '無法確認主持人身分，請使用原本建立房間的分頁。' });
            return;
        }
        const existingPlayer = room.players[socket.id];
        if (existingPlayer && (!isRestoringDealer || room.dealerId === socket.id)) {
            // A retry must never erase a name, change queue order or re-enrol a winner.
            socket.join(roomId);
            socket.emit('updateRoomState', room);
            reply({ success: true, role: room.dealerId === socket.id ? 'dealer' : 'player' });
            return;
        }

        socket.join(roomId);
        room.players[socket.id] = existingPlayer || { id: socket.id, name: null };
        if (isRestoringDealer) {
            const oldDealerId = room.dealerId;
            room.dealerId = socket.id;
            if (oldDealerId && oldDealerId !== socket.id) {
                delete room.players[oldDealerId];
                io.to(oldDealerId).emit('dealerReplaced', { roomId });
            }
            if (room.currentTurnData.playerId === socket.id) room.currentTurnData = emptyTurn();
            room.queue = room.queue.filter(id => id !== socket.id && id !== oldDealerId);
            console.log(`房間 ${roomId} 的主持人已連線: ${socket.id}`);
        } else if (!room.queue.includes(socket.id) && !room.winners.some(winner => winner.playerId === socket.id)) {
            room.queue.push(socket.id);
        }
        broadcastRoomState(roomId);
        reply({ success: true, role: isRestoringDealer ? 'dealer' : 'player' });
    });
    
    socket.on('setPlayerName', (payload) => {
        let { roomId, name } = payload || {};
        const room = gameRooms[roomId];
        if (room && room.players[socket.id]) {
            if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
                socket.emit('nameError', '姓名須為 1 至 80 字，不能只填空白。');
                return;
            }
            name = name.trim();
            if (room.currentTurnData.playerId === socket.id && name !== room.currentTurnData.playerName) {
                socket.emit('nameError', '本輪抽獎已開始，無法更改姓名。');
                return;
            }
            const isNameTaken = Object.values(room.players).some(player => player && player.id !== socket.id && player.name === name);
            if (isNameTaken) {
                socket.emit('nameError', '這個名字已經被使用了，請換一個！');
                return;
            }
            room.players[socket.id].name = name;
            broadcastRoomState(roomId);
        }
    });

    // ★★★ 新增：處理動畫廣播 ★★★
    socket.on('broadcastAnimation', (payload) => {
        const { roomId, turnId, action, type, isAuto } = payload || {};
        const room = gameRooms[roomId];
        const turn = room?.currentTurnData;
        if (room && room.queue[0] === socket.id && turn.playerId === socket.id && turn.id === turnId &&
            isReelType(type) && turn[type] !== null && !turn.stopped[type] &&
            ['leverPull', 'startSpin', 'stopSpin'].includes(action)) {
            // Identity and results always come from the accepted server round.
            socket.to(roomId).emit('animationSync', {
                action,
                type,
                turnId: turn.id,
                playerId: turn.playerId,
                playerName: turn.playerName,
                finalResult: action === 'stopSpin' ? turn[type] : undefined,
                isAuto: Boolean(isAuto)
            });
        }
    });

    function saveSettings(payload, ack, legacyType = null) {
        const reply = typeof ack === 'function' ? ack : result => {
            if (!result.success) socket.emit('error', result.message);
        };
        const room = payload && gameRooms[payload.roomId];
        if (!room || room.dealerId !== socket.id) {
            reply({ success: false, message: '只有此房間的主持人可以修改設定。' });
            return;
        }
        if (room.currentTurnData.playerName) {
            reply({ success: false, message: '玩家正在抽獎，請待本輪結束後儲存。' });
            return;
        }
        if (!legacyType && payload.baseRevision !== room.settingsRevision) {
            reply({ success: false, message: '設定已更新，請取消編輯後重新載入最新設定。' });
            return;
        }
        const checked = settingsRules.validate(
            legacyType === 'quantities' ? room.prizes : payload.prizes,
            legacyType === 'prizes' ? room.quantities : payload.quantities
        );
        if (!checked.valid) {
            reply({ success: false, message: checked.errors[0].message, errors: checked.errors });
            return;
        }
        // Validate both collections before changing either one.
        room.prizes = checked.prizes;
        room.quantities = checked.quantities;
        room.settingsRevision += 1;
        broadcastRoomState(payload.roomId);
        reply({ success: true, settings: {
            prizes: room.prizes, quantities: room.quantities, settingsRevision: room.settingsRevision
        } });
    }
    socket.on('updateSettings', (payload, ack) => saveSettings(payload, ack));
    // Retain compatibility with existing pages during a staged deployment.
    socket.on('updatePrizes', (payload, ack) => saveSettings(payload, ack, 'prizes'));
    socket.on('updateQuantities', (payload, ack) => saveSettings(payload, ack, 'quantities'));

    socket.on('spin', (payload, ack) => {
        const { roomId, type } = payload || {};
        const reply = result => {
            if (typeof ack === 'function') ack(result);
            else if (!result.success) socket.emit('error', result.message);
        };
        const room = gameRooms[roomId];
        const player = room?.players[socket.id];
        if (!player || room.queue[0] !== socket.id || room.dealerId === socket.id) {
            reply({ success: false, message: '尚未輪到你抽獎。' });
            return;
        }
        if (!isReelType(type)) {
            reply({ success: false, message: '無效的滾輪類型。' });
            return;
        }
        const playerName = player.name;
        if (!playerName) {
            reply({ success: false, message: '請先登記姓名再抽獎。' });
            return;
        }
        if (room.winners.some(winner => winner.playerId === socket.id || winner.name === playerName)) {
            reply({ success: false, message: `「${playerName}」已經抽過獎了。` });
            return;
        }
        const sourceList = type === 'prize' ? room.prizes : room.quantities;
        if (!sourceList.length) {
            reply({ success: false, message: '尚未設定可抽取的選項。' });
            return;
        }
        const turn = room.currentTurnData;
        if (turn.id === null) {
            turn.id = ++room.turnSequence;
            turn.playerId = socket.id;
            turn.playerName = playerName;
        }
        if (turn.playerId !== socket.id) {
            reply({ success: false, message: '抽獎回合已變更，請重新整理。' });
            return;
        }
        // Repeated requests return the original result; never draw again.
        if (turn[type] === null) {
            turn[type] = sourceList[Math.floor(Math.random() * sourceList.length)].name;
        }
        const result = { success: true, type, result: turn[type], turnId: turn.id };
        socket.emit('spinResult', result);
        broadcastRoomState(roomId);
        reply(result);
    });

    socket.on('reelStopped', (payload, ack) => {
        const { roomId, turnId, type } = payload || {};
        const room = gameRooms[roomId];
        const turn = room?.currentTurnData;
        const valid = room && room.queue[0] === socket.id && turn.playerId === socket.id &&
            turn.id !== null && turn.id === turnId && isReelType(type) && turn[type] !== null;
        if (valid) turn.stopped[type] = true;
        if (typeof ack === 'function') ack({ success: Boolean(valid) });
    });

    socket.on('turnComplete', (payload, ack) => {
        const { roomId, turnId } = payload || {};
        const room = gameRooms[roomId];
        // A lost acknowledgement may be retried without recording a second win.
        const recorded = room?.winners.find(winner => winner.playerId === socket.id && winner.turnId === turnId);
        if (recorded) {
            if (typeof ack === 'function') ack({ success: true });
            return;
        }
        if (room && room.queue[0] === socket.id) {
            const turn = room.currentTurnData;
            if (turn.id !== null && turn.id === turnId && turn.playerId === socket.id &&
                turn.prize !== null && turn.quantity !== null && turn.stopped.prize && turn.stopped.quantity) {
                const winnerData = {
                    playerId: turn.playerId,
                    turnId: turn.id,
                    name: room.currentTurnData.playerName,
                    prize: room.currentTurnData.prize,
                    quantity: room.currentTurnData.quantity
                };
                room.winners.push(winnerData);
                socket.to(roomId).emit('animationSync', { action: 'winner', playerId: socket.id, turnId: turn.id });
                
                console.log(`🎉 ${winnerData.name} 獲得 ${winnerData.quantity} 個 ${winnerData.prize}！`);
                
                room.queue.shift(); 
                
                room.currentTurnData = emptyTurn();
                
                console.log(`玩家 ${socket.id} 完成抽獎，下一位...`);
                broadcastRoomState(roomId);
                if (typeof ack === 'function') ack({ success: true });
                return;
            }
        }
        if (typeof ack === 'function') ack({ success: false, message: '請等兩個滾輪都停止後再完成本輪。' });
    });

    socket.on('disconnect', () => {
        console.log('一位玩家斷線:', socket.id);
        for (const currentRoomId in gameRooms) {
            const room = gameRooms[currentRoomId];
            if (room.players[socket.id]) {
                // An abandoned round must not keep settings locked for the next player.
                if (room.queue[0] === socket.id) {
                    room.currentTurnData = emptyTurn();
                }
                if (room.dealerId === socket.id) {
                    room.dealerId = null;
                    console.log(`房間 ${currentRoomId} 的莊家已離線。`);
                }
                delete room.players[socket.id];
                room.queue = room.queue.filter(id => id !== socket.id);
                broadcastRoomState(currentRoomId);
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`遊戲大腦 (同步動畫版 v6) 正在監聽 port ${PORT}`));

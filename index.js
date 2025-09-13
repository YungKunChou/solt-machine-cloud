// index.js (最終權威紀錄 v2 版)
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const gameRooms = {};

// 健康檢查路徑
app.get('/', (req, res) => {
    res.status(200).send('Game server is running.');
});

app.post('/create-room', (req, res) => {
    const roomId = `room_${Math.random().toString(36).substr(2, 6)}`;
    gameRooms[roomId] = {
        id: roomId,
        dealerId: null,
        players: {},
        queue: [],
        winners: [],
        currentTurnData: { prize: null, quantity: null, playerName: null },
        prizes: [ { name: '大杯美式咖啡' }, { name: '特大美式咖啡' }, { name: '大杯拿鐵咖啡' }, { name: '特大拿鐵咖啡' }, { name: '星巴克焦糖瑪奇朵' } ],
        quantities: [ { name: '1' }, { name: '2' }, { name: '3' } ]
    };
    console.log(`新房間已建立: ${roomId}`);
    res.json({ success: true, roomId: roomId });
});

function broadcastRoomState(roomId) {
    if (gameRooms[roomId]) {
        io.to(roomId).emit('updateRoomState', gameRooms[roomId]);
    }
}

io.on('connection', (socket) => {
    console.log('一位玩家連線:', socket.id);

    socket.on('joinRoom', (roomId) => { /* ... 此區塊程式碼不變 ... */ });
    socket.on('setPlayerName', ({ roomId, name }) => { /* ... 此區塊程式碼不變 ... */ });
    socket.on('updatePrizes', ({ roomId, prizes }) => { /* ... 此區塊程式碼不變 ... */ });
    socket.on('updateQuantities', ({ roomId, quantities }) => { /* ... 此區塊程式碼不變 ... */ });

    socket.on('spin', ({ roomId, type, playerName }) => {
        const room = gameRooms[roomId];
        if (room && room.queue[0] === socket.id && room.dealerId !== socket.id) {
            
            // ★★★ 關鍵修改 #2：檢查是否重複抽獎 ★★★
            const isAlreadyWinner = room.winners.some(winner => winner.name === playerName);
            if (isAlreadyWinner) {
                socket.emit('error', `"${playerName}" 已經抽過獎了，不能重複抽獎！`);
                return;
            }

            let result = '';
            let sourceList = [];
            if (type === 'prize' && room.prizes.length > 0) {
                sourceList = room.prizes.map(p => p.name);
            } else if (type === 'quantity' && room.quantities.length > 0) {
                sourceList = room.quantities.map(q => q.name);
            }
            if (sourceList.length > 0) {
                result = sourceList[Math.floor(Math.random() * sourceList.length)];
            }
            
            // ★★★ 關鍵修改 #1：大腦自己先把結果記下來 ★★★
            if (type === 'prize') {
                room.currentTurnData.prize = result;
                room.currentTurnData.playerName = playerName;
            } else if (type === 'quantity') {
                room.currentTurnData.quantity = result;
            }
            socket.emit('spinResult', { type, result });
        }
    });

    socket.on('turnComplete', ({ roomId }) => {
        const room = gameRooms[roomId];
        if (room && room.queue[0] === socket.id) {
            
            // ★★★ 關鍵修改 #1：從自己的筆記本裡拿出數據來記錄 ★★★
            if (room.currentTurnData.playerName && room.currentTurnData.prize && room.currentTurnData.quantity) {
                const winnerData = {
                    name: room.currentTurnData.playerName,
                    prize: room.currentTurnData.prize,
                    quantity: room.currentTurnData.quantity
                };
                room.winners.push(winnerData);
                
                room.queue.shift(); // 一人一次規則
                
                room.currentTurnData = { prize: null, quantity: null, playerName: null };
                
                console.log(`玩家 ${socket.id} 完成抽獎，下一位...`);
                broadcastRoomState(roomId);
            }
        }
    });

    socket.on('disconnect', () => { /* ... 此區塊程式碼不變 ... */ });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`遊戲大腦 (最終權威版 v3) 正在監聽 port ${PORT}`));
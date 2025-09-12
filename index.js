// index.js (最終莊家權限穩定版)
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const gameRooms = {};

app.post('/create-room', (req, res) => {
    const roomId = `room_${Math.random().toString(36).substr(2, 6)}`;
    gameRooms[roomId] = {
        id: roomId,
        dealerId: null,
        players: {}, // { socket.id: { id: socket.id, name: 'PlayerName' } }
        queue: [],
        winners: [], // 新增：得獎名單也由伺服器管理
        currentTurnData: { prize: null, quantity: null, playerName: null },
        prizes: [ { name: '大杯美式咖啡' }, { name: '特大美式咖啡' }, { name: '大杯拿鐵咖啡' }, { name: '特大拿鐵咖啡' }, { name: '星巴克焦糖瑪奇朵' } ],
        quantities: [ { name: '1' }, { name: '2' }, { name: '3' } ]
    };
    console.log(`新房間已建立: ${roomId}`);
    res.json({ success: true, roomId: roomId });
});

// 統一廣播房間狀態的函式
function broadcastRoomState(roomId) {
    if (gameRooms[roomId]) {
        io.to(roomId).emit('updateRoomState', gameRooms[roomId]);
    }
}

io.on('connection', (socket) => {
    console.log('一位玩家連線:', socket.id);

    socket.on('joinRoom', (roomId) => {
        const room = gameRooms[roomId];
        if (room) {
            socket.join(roomId);
            room.players[socket.id] = { id: socket.id, name: null };
            
            if (!room.dealerId) {
                room.dealerId = socket.id;
                console.log(`玩家 ${socket.id} 成為房間 ${roomId} 的莊家`);
            } else {
                room.queue.push(socket.id);
            }

            console.log(`玩家 ${socket.id} 加入了房間 ${roomId}`);
            broadcastRoomState(roomId);
        } else {
            socket.emit('error', '房間不存在');
        }
    });
    
    socket.on('setPlayerName', ({ roomId, name }) => {
        const room = gameRooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].name = name;
            console.log(`玩家 ${socket.id} 設定名稱為: ${name}`);
            broadcastRoomState(roomId);
        }
    });

    socket.on('updatePrizes', ({ roomId, prizes }) => {
        const room = gameRooms[roomId];
        if (room && room.dealerId === socket.id) {
            room.prizes = prizes;
            console.log(`莊家 ${socket.id} 更新了房間 ${roomId} 的獎項`);
            broadcastRoomState(roomId);
        }
    });

    socket.on('updateQuantities', ({ roomId, quantities }) => {
        const room = gameRooms[roomId];
        if (room && room.dealerId === socket.id) {
            room.quantities = quantities;
            console.log(`莊家 ${socket.id} 更新了房間 ${roomId} 的數量`);
            broadcastRoomState(roomId);
        }
    });

    socket.on('spin', ({ roomId, type, playerName }) => {
        const room = gameRooms[roomId];
        if (room && room.queue[0] === socket.id && room.dealerId !== socket.id) {
            let result = '';
            if (type === 'prize' && room.prizes.length > 0) {
                const prizes = room.prizes.map(p => p.name);
                result = prizes[Math.floor(Math.random() * prizes.length)];
                room.currentTurnData.prize = result;
                room.currentTurnData.playerName = playerName;
            } else if (type === 'quantity' && room.quantities.length > 0) {
                const quantities = room.quantities.map(q => q.name);
                result = quantities[Math.floor(Math.random() * quantities.length)];
                room.currentTurnData.quantity = result;
            } else {
                return; // 如果沒獎項/數量，就不處理
            }

            socket.emit('spinResult', { type, result });
            
            if (room.currentTurnData.prize && room.currentTurnData.quantity) {
                const winnerData = {
                    name: room.currentTurnData.playerName,
                    prize: room.currentTurnData.prize,
                    quantity: room.currentTurnData.quantity
                };
                room.winners.push(winnerData); // 將得獎者記錄在伺服器
                
                const finishedPlayer = room.queue.shift();
                room.queue.push(finishedPlayer);
                room.currentTurnData = { prize: null, quantity: null, playerName: null };
                
                setTimeout(() => {
                    broadcastRoomState(roomId); // 廣播包含最新得獎名單的房間狀態
                }, 4000);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('一位玩家斷線:', socket.id);
        for (const roomId in gameRooms) {
            const room = gameRooms[roomId];
            if (room.players[socket.id]) {
                // 如果斷線的是莊家，可以考慮結束遊戲或轉移莊家，此處先簡化
                if (room.dealerId === socket.id) {
                    console.log(`房間 ${roomId} 的莊家已離線。`);
                }
                delete room.players[socket.id];
                room.queue = room.queue.filter(id => id !== socket.id);
                broadcastRoomState(roomId);
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`遊戲大腦 (莊家版 v2) 正在監聽 port ${PORT}`));

// index.js (最終莊家權限版)
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
        dealerId: null, // 新增：莊家 ID
        players: {},    // { socket.id: { id: socket.id, name: 'PlayerName' } }
        queue: [],
        currentTurnData: { prize: null, quantity: null, playerName: null },
        // ★★★ 伺服器現在是獎項的唯一權威來源 ★★★
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
            
            // 將玩家加入房間
            room.players[socket.id] = { id: socket.id, name: null };
            
            // 如果還沒有莊家，第一個加入的人就是莊家
            if (!room.dealerId) {
                room.dealerId = socket.id;
                console.log(`玩家 ${socket.id} 成為房間 ${roomId} 的莊家`);
            } else {
                // 如果不是莊家，才加入排隊列表
                room.queue.push(socket.id);
            }

            console.log(`玩家 ${socket.id} 加入了房間 ${roomId}`);
            broadcastRoomState(roomId);
        } else {
            socket.emit('error', '房間不存在');
        }
    });
    
    // 新增：監聽玩家設定姓名
    socket.on('setPlayerName', ({ roomId, name }) => {
        const room = gameRooms[roomId];
        if (room && room.players[socket.id]) {
            room.players[socket.id].name = name;
            console.log(`玩家 ${socket.id} 設定名稱為: ${name}`);
            broadcastRoomState(roomId);
        }
    });

    // ★★★ 新增：只有莊家可以用的指令 ★★★
    socket.on('updatePrizes', ({ roomId, prizes }) => {
        const room = gameRooms[roomId];
        // 權限檢查：發送指令的人必須是莊家
        if (room && room.dealerId === socket.id) {
            room.prizes = prizes;
            console.log(`莊家 ${socket.id} 更新了房間 ${roomId} 的獎項`);
            broadcastRoomState(roomId);
        }
    });

    socket.on('updateQuantities', ({ roomId, quantities }) => {
        const room = gameRooms[roomId];
        // 權限檢查
        if (room && room.dealerId === socket.id) {
            room.quantities = quantities;
            console.log(`莊家 ${socket.id} 更新了房間 ${roomId} 的數量`);
            broadcastRoomState(roomId);
        }
    });


    socket.on('spin', ({ roomId, type, playerName }) => {
        const room = gameRooms[roomId];
        if (room && room.queue[0] === socket.id && room.dealerId !== socket.id) {
            console.log(`玩家 ${socket.id} 正在轉動 ${type} 滾輪`);
            let result = '';
            if (type === 'prize') {
                const prizes = room.prizes.map(p => p.name);
                result = prizes[Math.floor(Math.random() * prizes.length)];
                room.currentTurnData.prize = result;
                room.currentTurnData.playerName = playerName;
            } else if (type === 'quantity') {
                const quantities = room.quantities.map(q => q.name);
                result = quantities[Math.floor(Math.random() * quantities.length)];
                room.currentTurnData.quantity = result;
            }

            socket.emit('spinResult', { type, result }); // 只告訴當事人結果，讓他播放動畫
            
            if (room.currentTurnData.prize && room.currentTurnData.quantity) {
                const winnerData = {
                    name: room.currentTurnData.playerName,
                    prize: room.currentTurnData.prize,
                    quantity: room.currentTurnData.quantity
                };
                io.to(roomId).emit('newWinner', winnerData); // 廣播得獎者
                
                const finishedPlayer = room.queue.shift();
                room.queue.push(finishedPlayer);
                room.currentTurnData = { prize: null, quantity: null, playerName: null };
                
                setTimeout(() => {
                    broadcastRoomState(roomId);
                }, 4000);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('一位玩家斷線:', socket.id);
        // 在所有房間中尋找並移除這位玩家
        for (const roomId in gameRooms) {
            const room = gameRooms[roomId];
            if (room.players[socket.id]) {
                delete room.players[socket.id];
                room.queue = room.queue.filter(id => id !== socket.id);
                // 如果莊家斷線了，可以設定遞補規則，此處暫不處理
                broadcastRoomState(roomId);
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`遊戲大腦 (莊家版) 正在監聽 port ${PORT}`));

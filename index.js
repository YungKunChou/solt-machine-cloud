// index.js (升級版) - 支援雙滾輪
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const gameRooms = {}; // 筆記本，記錄所有房間

// 建立房間 (這部分不變)
app.post('/create-room', (req, res) => {
    const roomId = `room_${Math.random().toString(36).substr(2, 6)}`;
    gameRooms[roomId] = {
        id: roomId,
        players: {}, // 改成物件，方便用 id 查找
        queue: [],
        currentTurnData: { prize: null, quantity: null, playerName: null }
    };
    console.log(`新房間已建立: ${roomId}`);
    res.json({ success: true, roomId: roomId });
});

io.on('connection', (socket) => {
    console.log('一位玩家連線:', socket.id);

    socket.on('joinRoom', (roomId) => {
        if (gameRooms[roomId]) {
            socket.join(roomId);
            const room = gameRooms[roomId];
            room.players[socket.id] = { id: socket.id };
            room.queue.push(socket.id);
            console.log(`玩家 ${socket.id} 加入了房間 ${roomId}`);
            io.to(roomId).emit('updateRoomState', { queue: room.queue });
        } else {
            socket.emit('error', '房間不存在');
        }
    });

    // ★★★ 升級版的 spin 邏輯 ★★★
    socket.on('spin', ({ roomId, type, playerName }) => {
        const room = gameRooms[roomId];
        // 檢查是否輪到這位玩家
        if (room && room.queue[0] === socket.id) {
            console.log(`玩家 ${socket.id} 正在轉動 ${type} 滾輪`);
            
            // 這裡我們讓大腦隨機決定結果
            // 注意：在真實應用中，獎項和數量列表應該從後端管理
            const prizes = ['大杯美式咖啡', '特大美式咖啡', '大杯拿鐵咖啡', '特大拿鐵咖啡', '星巴克焦糖瑪奇朵'];
            const quantities = ['1', '2', '3'];
            let result = '';
            if (type === 'prize') {
                result = prizes[Math.floor(Math.random() * prizes.length)];
                room.currentTurnData.prize = result;
                room.currentTurnData.playerName = playerName;
            } else if (type === 'quantity') {
                result = quantities[Math.floor(Math.random() * quantities.length)];
                room.currentTurnData.quantity = result;
            }

            // 把結果只告訴按下的那個人
            io.to(socket.id).emit('spinResult', { type, result });
            
            // 檢查是否兩個都轉完了
            if (room.currentTurnData.prize && room.currentTurnData.quantity) {
                const winnerData = {
                    name: room.currentTurnData.playerName,
                    prize: room.currentTurnData.prize,
                    quantity: room.currentTurnData.quantity
                };
                
                // 廣播新的得獎者
                io.to(roomId).emit('newWinner', winnerData);
                
                // 輪到下一位
                const finishedPlayer = room.queue.shift();
                room.queue.push(finishedPlayer);
                
                // 重設當前回合數據
                room.currentTurnData = { prize: null, quantity: null, playerName: null };
                
                // 廣播更新後的排隊狀態
                setTimeout(() => {
                    io.to(roomId).emit('updateRoomState', { queue: room.queue });
                }, 4000); // 等待動畫結束後再更新
            }
        }
    });

    socket.on('disconnect', () => { /* ... 斷線邏輯 ... */ });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`遊戲大腦 (升級版) 正在監聽 port ${PORT}`));
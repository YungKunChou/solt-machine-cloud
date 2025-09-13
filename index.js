// index.js (雙渦輪動畫邏輯版)
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
        players: {},
        queue: [],
        winners: [],
        prizes: [ { name: '大杯美式咖啡' }, { name: '特大美式咖啡' }, { name: '大杯拿鐵咖啡' }, { name: '特大拿鐵咖啡' }, { name: '星巴克焦糖瑪奇朵' } ],
        quantities: [ { name: '1' }, { name: '2' }, { name: '3' }, { name: '2' }, { name: '1' } ]
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
            const isNameTaken = Object.values(room.players).some(player => player.name === name);
            if (isNameTaken) {
                socket.emit('nameError', '這個名字已經被使用了，請換一個！');
                return;
            }
            room.players[socket.id].name = name;
            console.log(`玩家 ${socket.id} 設定名稱為: ${name}`);
            broadcastRoomState(roomId);
        }
    });

    socket.on('updatePrizes', ({ roomId, prizes }) => {
        const room = gameRooms[roomId];
        if (room && room.dealerId === socket.id) {
            room.prizes = prizes;
            broadcastRoomState(roomId);
        }
    });

    socket.on('updateQuantities', ({ roomId, quantities }) => {
        const room = gameRooms[roomId];
        if (room && room.dealerId === socket.id) {
            room.quantities = quantities;
            broadcastRoomState(roomId);
        }
    });

    // 【修改】'spin' 事件現在只計算結果並回傳，不處理排隊
    socket.on('spin', ({ roomId, type }) => {
        const room = gameRooms[roomId];
        if (room && room.queue[0] === socket.id) {
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
            
            // 只回傳給當前的玩家
            socket.emit('spinResult', { type, result });
        }
    });

    // 【新增】監聽前端回報的「抽獎完成」事件
    socket.on('turnComplete', ({ roomId, winnerData }) => {
        const room = gameRooms[roomId];
        if (room && room.queue[0] === socket.id) {
            // 記錄得獎者
            room.winners.push(winnerData);
            
            // 處理排隊：玩家出隊，不再重新排隊
            room.queue.shift(); 
            
            console.log(`玩家 ${socket.id} 完成抽獎，下一位...`);
            // 廣播最新狀態，讓所有人換到下一個人
            broadcastRoomState(roomId);
        }
    });


    socket.on('disconnect', () => {
        console.log('一位玩家斷線:', socket.id);
        for (const currentRoomId in gameRooms) {
            const room = gameRooms[currentRoomId];
            if (room.players[socket.id]) {
                if (room.dealerId === socket.id) {
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

server.listen(PORT, () => console.log(`遊戲大腦 (雙渦輪動畫版) 正在監聽 port ${PORT}`));

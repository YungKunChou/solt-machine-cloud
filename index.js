// index.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors()); // 允許跨來源請求
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // 在生產環境中應指定前端網址
        methods: ["GET", "POST"]
    }
});

// 儲存所有遊戲房間的狀態 (暫時存在記憶體中，未來可改用資料庫)
const gameRooms = {};

app.get('/', (req, res) => {
    res.send('<h1>拉霸機後端伺服器已啟動</h1>');
});

// 建立一個新的遊戲房間 API
app.post('/create-room', (req, res) => {
    const roomId = `room_${Math.random().toString(36).substr(2, 6)}`;
    gameRooms[roomId] = {
        id: roomId,
        dealer: '莊家ID', // 之後可以加上莊家資訊
        players: [],
        queue: [], // 遊戲排隊列表
        currentPlayer: null,
    };
    console.log(`新房間已建立: ${roomId}`);
    res.json({ success: true, roomId: roomId });
});

io.on('connection', (socket) => {
    console.log('一位使用者已連線:', socket.id);

    // 監聽 'joinRoom' 事件
    socket.on('joinRoom', (roomId) => {
        if (gameRooms[roomId]) {
            socket.join(roomId);
            gameRooms[roomId].players.push(socket.id); // 將玩家加入列表
            gameRooms[roomId].queue.push(socket.id); // 將玩家加入排隊

            console.log(`使用者 ${socket.id} 加入了房間 ${roomId}`);

            // 通知房間內所有人，更新的房間狀態
            io.to(roomId).emit('updateRoomState', gameRooms[roomId]);
        } else {
            socket.emit('error', '房間不存在');
        }
    });

    // 監聽 'spin' 事件 (由當前玩家觸發)
    socket.on('spin', (roomId) => {
        const room = gameRooms[roomId];
        // 檢查是否為當前玩家
        if (room && room.queue[0] === socket.id) {
            // 產生隨機結果
            const result = [Math.floor(Math.random() * 5), Math.floor(Math.random() * 5), Math.floor(Math.random() * 5)];
            // 通知房間內所有人結果
            io.to(roomId).emit('spinResult', { player: socket.id, result: result });

            // 輪到下一位玩家
            const finishedPlayer = room.queue.shift(); // 移除隊首玩家
            room.queue.push(finishedPlayer); // 將其加到隊尾

            // 再次通知房間更新狀態
            io.to(roomId).emit('updateRoomState', room);
        }
    });

    socket.on('disconnect', () => {
        console.log('一位使用者已離線:', socket.id);
        // 這裡需要加入邏輯：從所有房間中移除這位使用者
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`伺服器正在監聽 port ${PORT}`));
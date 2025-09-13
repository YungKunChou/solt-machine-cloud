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
  // ↓↓↓ 在 index.js 中，替換掉舊的 'spin' 區塊 ↓↓↓
socket.on('spin', ({ roomId, type, playerName }) => {
    const room = gameRooms[roomId];
    if (room && room.queue[0] === socket.id && room.dealerId !== socket.id) {
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
        
        // ★★★ 關鍵修改：大腦自己先把結果記下來 ★★★
        if (type === 'prize') {
            room.currentTurnData.prize = result;
            room.currentTurnData.playerName = playerName; // 同時記錄是誰抽的
        } else if (type === 'quantity') {
            room.currentTurnData.quantity = result;
        }

        // 只回傳給當前的玩家，讓他去播放動畫
        socket.emit('spinResult', { type, result });
    }
});

    // 【新增】監聽前端回報的「抽獎完成」事件
  好的，收到您的回報。這個問題非常關鍵，「抽了獎卻沒有記錄」會嚴重影響遊戲的公平性。

我仔細檢查了我們上次的程式碼，發現問題出在後端 index.js 的一個邏輯漏洞上，這也解釋了您之前偶爾會遇到的「開獎結果與光榮榜不同」的問題。

問題的根本原因 (用12歲的方式來解釋)
目前的情況就像是：

前端「畫面」在抽獎動畫結束後，跑去跟後端「裁判」說：「嘿，我抽完了，得獎的是 OOO」。

但是因為網路延遲或是其他複雜的計時問題，有時候前端的這個「回報」指令送到裁判那裡時，裁判可能剛好在處理別的事情，或者搞錯了現在是誰該回報，結果就忽略了這次的得獎紀錄。

根本的解決方法是，裁判不應該聽信任何人的回報，他必須只相信自己親眼所見和筆記本上記錄的。

解決方案：讓「遊戲大腦」自己做筆記
我們要修改後端 index.js 的規則，讓它在決定了獎項的那一刻，就自己先記下來。然後，當前端回報「動畫播完了」的時候，後端直接從自己的筆記本裡拿出資料來記錄，這樣就絕對不會出錯了。

請動手修改：
請您打開後端 index.js 檔案，並用下面這兩個更新版的程式碼區塊，替換掉您檔案中對應的舊版區塊。

1. 替換 socket.on('spin', ...) 區塊
這個修改讓大腦在決定結果的瞬間，就立刻把結果和玩家姓名寫進筆記本 (currentTurnData)。

JavaScript

// ↓↓↓ 在 index.js 中，替換掉舊的 'spin' 區塊 ↓↓↓
socket.on('spin', ({ roomId, type, playerName }) => {
    const room = gameRooms[roomId];
    if (room && room.queue[0] === socket.id && room.dealerId !== socket.id) {
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
        
        // ★★★ 關鍵修改：大腦自己先把結果記下來 ★★★
        if (type === 'prize') {
            room.currentTurnData.prize = result;
            room.currentTurnData.playerName = playerName; // 同時記錄是誰抽的
        } else if (type === 'quantity') {
            room.currentTurnData.quantity = result;
        }

        // 只回傳給當前的玩家，讓他去播放動畫
        socket.emit('spinResult', { type, result });
    }
});
2. 替換 socket.on('turnComplete', ...) 區塊
這個修改讓大腦在收到「完成」通知時，不再相信前端傳來的資料，而是從自己的筆記本裡拿出數據來記錄。

JavaScript

// ↓↓↓ 在 index.js 中，替換掉舊的 'turnComplete' 區塊 ↓↓↓
socket.on('turnComplete', ({ roomId }) => { // 不再需要從前端接收 winnerData
    const room = gameRooms[roomId];
    if (room && room.queue[0] === socket.id) {
        
        // ★★★ 關鍵修改：從自己的筆記本裡拿出數據，記錄到光榮榜 ★★★
        // 檢查筆記本裡的資料是否都齊全了
        if (room.currentTurnData.playerName && room.currentTurnData.prize && room.currentTurnData.quantity) {
            const winnerData = {
                name: room.currentTurnData.playerName,
                prize: room.currentTurnData.prize,
                quantity: room.currentTurnData.quantity
            };
            room.winners.push(winnerData);
            
            // 處理排隊：玩家出隊，不再重新排隊
            room.queue.shift(); 
            
            // 清空當前回合的筆記，為下一位做準備
            room.currentTurnData = { prize: null, quantity: null, playerName: null };
            
            console.log(`玩家 ${socket.id} 完成抽獎，下一位...`);
            // 廣播最新狀態
            broadcastRoomState(roomId);
        }
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
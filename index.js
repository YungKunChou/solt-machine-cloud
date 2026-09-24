'use strict';
const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const cors = require('cors');
const { createGameService } = require('./game-server.cjs');
const protocol = require('./game-protocol.js');
function createLotteryServer() {
    const app = express();
    app.use(cors());
    const server = http.createServer(app);
    const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });
    const service = createGameService(io);
    app.get('/', (req, res) => res.status(200).send('Lottery protocol 2 server is running.'));
    app.get('/health', (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json({ app: 'lottery-backend', protocolVersion: protocol.VERSION, ready: true });
    });
    app.post('/create-room', express.json({ limit: '16kb' }), (req, res) => {
        res.set('Cache-Control', 'no-store');
        try { res.json(service.createRoom(req.body?.settings)); }
        catch (error) { res.status(400).json({ success: false, message: error.message }); }
    });
    io.on('connection', service.connect);
    return { server, io, service };
}
if (require.main === module) {
    const { server } = createLotteryServer();
    server.listen(process.env.PORT || 3001, () => console.log(`抽獎服務正在監聽 ${server.address().port}`));
}
module.exports = { createLotteryServer };

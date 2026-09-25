// Local-only launcher. Render continues to run `node index.js`.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { fork, spawn } = require('node:child_process');
const readline = require('node:readline');
const net = require('node:net');
const { createHash } = require('node:crypto');
const { backendReady } = require('./backend-ready.cjs');
const { createPublicFileHandler } = require('./public-files.cjs');

const root = path.resolve(__dirname, '..');
const website = 'http://127.0.0.1:8080';
const projectId = createHash('sha256').update(fs.realpathSync(root).toLowerCase()).digest('hex');
const shouldOpen = process.argv.includes('--open');
const servePublicFile = createPublicFileHandler(root);

let backend;
let stopping = false;
let ready = false;
let input;
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1:8080').pathname;
    if (req.method === 'GET' && pathname === '/__local_status') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ app: 'lottery-local-dev', projectId, ready }));
        return;
    }
    servePublicFile(req, res);
});

function stop(code = 0) {
    if (stopping) return;
    stopping = true;
    process.exitCode = code;
    input?.close();
    process.stdin.pause();
    process.stdin.destroy();
    server.close();
    server.closeAllConnections();
    if (backend && backend.exitCode === null) backend.kill();
}

server.on('error', (error) => {
    console.error('前端無法啟動，請確認 8080 埠未被其他程式使用：', error.message);
    stop(1);
});

function openBrowser() {
    if (!shouldOpen) return;
    const browser = spawn(process.env.ComSpec || 'cmd.exe', [
        '/d', '/c', 'start', '', website
    ], { stdio: 'ignore', windowsHide: true, detached: true });
    browser.on('error', () => console.error('無法自動開啟瀏覽器，請開啟：' + website));
    browser.on('exit', (code) => {
        if (code) console.error('無法自動開啟瀏覽器，請開啟：' + website);
    });
    browser.unref();
}

async function getStatus() {
    try {
        const response = await fetch(website + '/__local_status', { signal: AbortSignal.timeout(1500) });
        return await response.json();
    } catch { return null; }
}

async function start() {
    const existing = await getStatus();
    if (existing?.app === 'lottery-local-dev' && existing.projectId === projectId) {
        if (!existing.ready) throw new Error('本專案正在啟動，請稍後再試。');
        console.log('本機前後端已啟動，沿用原有服務：' + website);
        openBrowser();
        return;
    }

    // Probe the actual client address: Windows can allow overlapping wildcard binds.
    // Never stop an unrelated process to reclaim a port.
    for (const port of [3001, 8080]) {
        await new Promise((resolve, reject) => {
            const probe = net.createConnection({ port, host: '127.0.0.1' });
            probe.setTimeout(1500);
            probe.once('connect', () => {
                probe.destroy();
                reject(new Error(`${port} 埠已被占用。請先關閉原有服務，再重新啟動。`));
            });
            probe.once('error', (error) => {
                probe.destroy();
                if (error.code === 'ECONNREFUSED') resolve();
                else reject(new Error(`無法檢查 ${port} 埠：${error.message}`));
            });
            probe.once('timeout', () => {
                probe.destroy();
                reject(new Error(`檢查 ${port} 埠逾時，請稍後再試。`));
            });
        });
    }

    input = readline.createInterface({ input: process.stdin });
    input.on('line', (line) => {
        if (line.trim().toLowerCase() === 'q') stop();
    });
    input.on('SIGINT', () => stop());
    server.listen(8080, '127.0.0.1', startBackend);
}

async function startBackend() {
    backend = fork(path.join(root, 'index.js'), [], {
        cwd: root,
        env: { ...process.env, PORT: '3001' },
        stdio: 'inherit'
    });
    backend.on('error', (error) => {
        console.error('Local backend could not start:', error.message);
        stop(1);
    });
    backend.on('exit', (code) => {
        if (!stopping) stop(code || 1);
    });
    const deadline = Date.now() + 15000;
    while (!stopping && Date.now() < deadline) {
        try {
            if (await backendReady('http://127.0.0.1:3001')) {
                if (stopping || backend.exitCode !== null) return;
                ready = true;
                console.log('本機前後端已就緒：' + website);
                console.log('請保留此視窗。結束時輸入 q 再按 Enter，或按 Ctrl+C，同時關閉前後端。');
                openBrowser();
                return;
            }
        } catch { /* The backend may still be starting. */ }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!stopping) {
        console.error('後端未能在 15 秒內啟動，請查看上方錯誤訊息。');
        stop(1);
    }
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

start().catch((error) => {
    console.error(error.message);
    stop(1);
});

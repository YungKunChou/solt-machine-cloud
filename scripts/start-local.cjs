const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.chdir(path.resolve(__dirname, '..'));

try {
    for (const name of ['express', 'socket.io', 'cors']) require(name);
} catch {
    console.log('正在安裝本機需要的套件，第一次啟動需要網路連線……');
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', [
        '/d', '/c', 'npm.cmd ci --no-audit --no-fund'
    ], { stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) {
        console.error('套件安裝失敗，請確認 Node.js、npm 與網路連線。');
        process.exit(1);
    }
}

process.argv.push('--open');
require('./dev.cjs');

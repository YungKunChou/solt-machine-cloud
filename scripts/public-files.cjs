const fs = require('node:fs');
const path = require('node:path');

// Explicit public files only: never expose source, credentials or local records.
const publicFiles = new Map([
    ...['index.html', 'slot-machine.html', 'manual.html'].map(file => [file, 'text/html; charset=utf-8']),
    ...['config.js', 'room-session.js', 'history-store.js', 'history-ui.js',
        'settings-rules.js', 'settings-store.js', 'settings-editor.js', 'game-protocol.js',
        'reel-motion.js', 'server-clock.js', 'reel-player.js', 'game-client.js', 'game-music.js'].map(file => [file, 'text/javascript; charset=utf-8']),
    ...['history.css', 'settings.css', 'queue.css', 'machine.css', 'theme.css',
        'typography.css'].map(file => [file, 'text/css; charset=utf-8']),
    ...['assets/design/slot-machine-compact-v2.png', 'assets/design/lever-ball-complete-v1.png', 'slot-machine.png'].map(file => [file, 'image/png']),
    ...['plus', 'trash', 'lock-fill', 'check-circle-fill'].map(name => [`assets/icons/${name}.svg`, 'image/svg+xml']),
    ['Lobby.jpg', 'image/jpeg']
]);

function createPublicFileHandler(root) {
    return function serve(req, res) {
        const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
        const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
        if (!['GET', 'HEAD'].includes(req.method) || !publicFiles.has(filename)) {
            res.writeHead(404); res.end('Not found'); return;
        }
        fs.readFile(path.join(root, filename), (error, content) => {
            if (error) { res.writeHead(500); res.end('Unable to read local file'); return; }
            res.writeHead(200, {
                'Content-Type': publicFiles.get(filename), 'Content-Length': content.length,
                'Cache-Control': 'no-store'
            });
            res.end(req.method === 'HEAD' ? undefined : content);
        });
    };
}
module.exports = { publicFiles, createPublicFileHandler };

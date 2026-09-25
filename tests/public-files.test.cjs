const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { publicFiles, createPublicFileHandler } = require('../scripts/public-files.cjs');
const root = path.resolve(__dirname, '..');

test('local server supplies every registered public resource with the correct MIME type', async t => {
    const server = http.createServer(createPublicFileHandler(root));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [file, mime] of publicFiles) {
        const response = await fetch(`${base}/${file}`);
        assert.equal(response.status, 200, file);
        assert.equal(response.headers.get('content-type'), mime, file);
        assert.equal(response.headers.get('cache-control'), 'no-store', file);
        assert.equal((await response.arrayBuffer()).byteLength, fs.statSync(path.join(root, file)).size, file);
    }
    const head = await fetch(`${base}/typography.css`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.ok(Number(head.headers.get('content-length')) > 0);
    assert.equal(await head.text(), '');
    for (const file of ['package.json', '.git/config', 'game-server.cjs', 'missing.js']) {
        const response = await fetch(`${base}/${file}`);
        assert.equal(response.status, 404, file);
        await response.text();
    }
    const post = await fetch(`${base}/config.js`, { method: 'POST' });
    assert.equal(post.status, 404);
    await post.text();
});

test('HTML and CSS local dependencies are included in the public resource list', () => {
    for (const file of publicFiles.keys()) {
        if (!/\.(html|css)$/.test(file)) continue;
        const content = fs.readFileSync(path.join(root, file), 'utf8');
        const references = [
            ...Array.from(content.matchAll(/<(?:script|img)\b[^>]*\bsrc=["']([^"']+)["']/gi), match => match[1]),
            ...Array.from(content.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["']/gi), match => match[1]),
            ...Array.from(content.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/gi), match => match[1])
        ];
        for (const reference of references) {
            if (/^(?:[a-z]+:|\/\/|#)/i.test(reference)) continue;
            const resolved = new URL(reference, `http://local/${file}`).pathname.slice(1);
            assert.ok(publicFiles.has(resolved), `${file} references an unserved resource: ${reference}`);
        }
    }
});

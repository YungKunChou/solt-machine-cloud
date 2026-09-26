const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require.resolve('../slot-machine.html'), 'utf8');
const script = html.match(/<script id="lever-art-ready">([\s\S]*?)<\/script>/)[1];

function fixture(images) {
    const heads = images.map(image => {
        const classes = new Set();
        const head = { classList: {
            toggle(name, on) { on ? classes.add(name) : classes.delete(name); },
            remove(name) { classes.delete(name); }
        } };
        image.listeners = {};
        image.closest = () => head;
        image.addEventListener = (type, handler) => { image.listeners[type] = handler; };
        return { ready: () => classes.has('ball-ready') };
    });
    vm.runInNewContext(script, { document: { querySelectorAll: () => images } });
    return heads;
}

test('pending and failed sphere images retain the uncut original head', () => {
    const images = [
        { complete: false, naturalWidth: 0, naturalHeight: 0 },
        { complete: true, naturalWidth: 0, naturalHeight: 0 }
    ];
    const heads = fixture(images);
    assert.ok(heads.every(head => !head.ready()));
    images[1].listeners.error();
    assert.equal(heads[1].ready(), false);
});

test('cached and delayed spheres independently enable occlusion after load', () => {
    const images = [
        { complete: true, naturalWidth: 1254, naturalHeight: 1254 },
        { complete: false, naturalWidth: 0, naturalHeight: 0 }
    ];
    const heads = fixture(images);
    assert.equal(heads[0].ready(), true);
    assert.equal(heads[1].ready(), false);
    Object.assign(images[1], { complete: true, naturalWidth: 1254, naturalHeight: 1254 });
    images[1].listeners.load();
    assert.equal(heads[1].ready(), true);
    images[0].listeners.error();
    assert.equal(heads[0].ready(), false);
    assert.equal(heads[1].ready(), true);
});

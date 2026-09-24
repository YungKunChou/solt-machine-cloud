const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rules = require('../settings-rules.js');

// Minimal DOM for functional interaction checks; no browser or visual checks.
function fixture(submit) {
    class Element {
        constructor(tag) {
            this.tag = tag;
            this.children = [];
            this.events = {};
            this.attributes = {};
            this.className = '';
            this.classList = {
                toggle: (name, enabled) => {
                    const classes = new Set(this.className.split(/\s+/).filter(Boolean));
                    if (enabled) classes.add(name); else classes.delete(name);
                    this.className = [...classes].join(' ');
                }
            };
        }
        set textContent(value) { this.text = String(value); this.children = []; }
        get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(''); }
        append(...children) { this.children.push(...children); }
        replaceChildren(...children) { this.text = ''; this.children = children; }
        setAttribute(name, value) {
            this.attributes[name] = String(value);
            if (name === 'class') this.className = value;
            else if (name === 'id') this.id = value;
            else if (name === 'hidden') this.hidden = true;
        }
        set innerHTML(html) {
            this.replaceChildren();
            const stack = [this];
            for (const match of html.matchAll(/<\/(\w+)>|<(\w+)([^>]*)>|([^<]+)/g)) {
                if (match[1]) { stack.pop(); continue; }
                if (match[2]) {
                    const child = new Element(match[2]);
                    for (const attr of match[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) child.setAttribute(attr[1], attr[2] || '');
                    stack.at(-1).append(child);
                    if (!['input', 'img'].includes(child.tag)) stack.push(child);
                } else {
                    const text = new Element('#text');
                    text.textContent = match[4];
                    stack.at(-1).append(text);
                }
            }
        }
        querySelectorAll(selector) {
            const parts = selector.split(' ');
            const first = parts.shift();
            const matches = element => first.startsWith('.') ? element.className.split(/\s+/).includes(first.slice(1))
                : first.startsWith('#') ? element.id === first.slice(1)
                : first.startsWith('[') ? element.attributes[first.slice(1).split('=')[0]] === first.match(/="([^"]*)"/)[1]
                : element.tag === first;
            const walk = element => element.children.flatMap(child => [child, ...walk(child)]);
            const found = walk(this).filter(matches);
            return parts.length ? found.flatMap(element => element.querySelectorAll(parts.join(' '))) : found;
        }
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
        addEventListener(event, handler) { this.events[event] = handler; }
        click() { if (!this.disabled) return this.events.click?.(); }
        focus() { document.activeElement = this; }
    }
    const root = new Element('div');
    const document = { createElement: tag => new Element(tag), getElementById: id => root.querySelector('#' + id) };
    const window = { LotterySettingsRules: rules, addEventListener() {} };
    const sent = [];
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../settings-editor.js'), 'utf8'), { window, document });
    const editor = window.createLotterySettingsEditor(root, async payload => {
        sent.push(JSON.parse(JSON.stringify(payload)));
        return submit ? submit(payload) : { settings: { ...payload, settingsRevision: 1 } };
    });
    editor.update({ prizes: ['咖啡', '茶', '禮券'].map(name => ({ name })), quantities: ['1', '2', '3'].map(name => ({ name })), settingsRevision: 0 }, true);
    const q = selector => root.querySelector(selector);
    const rows = type => q(`#${type}-settings-rows`).children;
    const names = type => rows(type).map(row => row.querySelector('.settings-input')?.value ?? row.querySelector('.settings-value').textContent);
    const column = type => root.querySelectorAll('.settings-column')[type === 'prizes' ? 0 : 1];
    return { root, sent, q, rows, names, column, editor, edit: () => q('#edit-settings-btn').click(),
        remove: (type, index) => rows(type)[index].querySelector('.settings-remove').click() };
}

test('row X deletes only that item; undo restores its position and cancel preserves saved settings', () => {
    const f = fixture();
    assert.equal(f.root.querySelectorAll('.settings-remove').length, 0);
    f.edit();
    assert.equal(f.root.querySelectorAll('input').some(input => input.type === 'checkbox'), false);
    f.remove('prizes', 1);
    f.remove('quantities', 0);
    assert.deepEqual(f.names('prizes'), ['咖啡', '禮券']);
    assert.deepEqual(f.names('quantities'), ['2', '3']);
    assert.equal(f.sent.length, 0);
    f.column('prizes').querySelector('.settings-link').click();
    assert.deepEqual(f.names('prizes'), ['咖啡', '茶', '禮券']);
    f.q('#cancel-settings-btn').click();
    assert.deepEqual(f.names('quantities'), ['1', '2', '3']);
    assert.equal(f.root.querySelectorAll('.settings-remove').length, 0);
});

test('add, rename and per-row deletion save both lists together without selection metadata', async () => {
    const f = fixture();
    f.edit();
    f.column('prizes').querySelector('.settings-tools button').click();
    const input = f.rows('prizes').at(-1).querySelector('.settings-input');
    input.value = '新獎品';
    input.events.input();
    f.remove('prizes', 0);
    f.remove('quantities', 1);
    await f.q('#save-settings-btn').click();
    assert.deepEqual(f.sent, [{ prizes: [{ name: '茶' }, { name: '禮券' }, { name: '新獎品' }], quantities: [{ name: '1' }, { name: '3' }], baseRevision: 0 }]);
    assert.deepEqual(f.names('prizes'), ['茶', '禮券', '新獎品']);
});

test('empty columns cannot be saved and undo recovers the final deleted item', async () => {
    const f = fixture();
    f.edit();
    while (f.rows('prizes').length) f.remove('prizes', 0);
    await f.q('#save-settings-btn').click();
    assert.equal(f.sent.length, 0);
    assert.equal(f.column('prizes').querySelector('.settings-list-message').hidden, false);
    f.column('prizes').querySelector('.settings-link').click();
    await f.q('#save-settings-btn').click();
    assert.deepEqual(f.sent[0].prizes, [{ name: '禮券' }]);
});

test('pending saves lock row deletion, add and undo; failed saves retain the draft', async () => {
    let reject;
    const f = fixture(() => new Promise((resolve, fail) => { reject = fail; }));
    f.edit();
    f.remove('prizes', 1);
    const saving = f.q('#save-settings-btn').click();
    assert.ok(f.rows('prizes').every(row => row.querySelector('.settings-remove').disabled));
    assert.equal(f.column('prizes').querySelector('.settings-tools button').disabled, true);
    assert.equal(f.column('prizes').querySelector('.settings-link').disabled, true);
    f.remove('prizes', 0);
    assert.deepEqual(f.names('prizes'), ['咖啡', '禮券']);
    reject(new Error('連線失敗'));
    await saving;
    assert.deepEqual(f.names('prizes'), ['咖啡', '禮券']);
    assert.ok(f.rows('prizes').every(row => !row.querySelector('.settings-remove').disabled));
    f.column('prizes').querySelector('.settings-link').click();
    assert.deepEqual(f.names('prizes'), ['咖啡', '茶', '禮券']);
});
test('restore defaults sends both columns together and updates displayed settings after success', async () => {
    const f = fixture();
    assert.equal(f.q('.settings-heading-actions').querySelectorAll('button')[1].id, 'restore-settings-btn');
    await f.q('#restore-settings-btn').click();
    assert.deepEqual(f.sent, [{ ...rules.defaults(), baseRevision: 0 }]);
    assert.deepEqual(f.names('prizes'), rules.defaults().prizes.map(x => x.name));
    assert.deepEqual(f.names('quantities'), ['1', '2', '3']);
    assert.match(f.q('.settings-notice').textContent, /已回復預設/);
});
test('restore is hidden during draft edits and disabled during active round, disconnect or pending save', async () => {
    let reject;
    const f = fixture(() => new Promise((resolve, fail) => { reject = fail; }));
    f.edit(); assert.equal(f.q('#restore-settings-btn').hidden, true);
    await f.q('#restore-settings-btn').events.click(); assert.equal(f.sent.length, 0);
    f.q('#cancel-settings-btn').click();
    const saved = { prizes: [{ name: '咖啡' }], quantities: [{ name: '5' }], settingsRevision: 0 };
    f.editor.update({ ...saved, currentTurnData: { playerName: '小明' } }, true);
    assert.equal(f.q('#restore-settings-btn').disabled, true);
    f.editor.update(saved, true); f.editor.disconnect();
    assert.equal(f.q('#restore-settings-btn').disabled, true);
    f.editor.update(saved, true);
    const restoring = f.q('#restore-settings-btn').click();
    assert.equal(f.q('#restore-settings-btn').disabled, true); assert.equal(f.q('#edit-settings-btn').disabled, true);
    reject(Error('連線失敗')); await restoring;
    assert.deepEqual(f.names('quantities'), ['5']);
    assert.match(f.q('.settings-notice').textContent, /連線失敗/);
});

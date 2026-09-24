(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LotteryHistoryStore = factory();
}(typeof window === 'undefined' ? globalThis : window, function () {
    'use strict';
    const VERSION = 1;
    function valid(record) {
        return record?.version === VERSION && typeof record.id === 'string' &&
            typeof record.roomId === 'string' && Number.isFinite(record.createdAt) && Number.isFinite(new Date(record.createdAt).getTime()) &&
            Number.isFinite(record.savedAt) && Number.isFinite(new Date(record.savedAt).getTime()) && Number.isInteger(record.settingsRevision) &&
            ['prizes', 'quantities'].every(key => Array.isArray(record[key]) && record[key].every(row => typeof row?.name === 'string')) &&
            Array.isArray(record.winners) && record.winners.every(row => typeof row?.name === 'string' &&
                typeof row.prize === 'string' && typeof row.quantity === 'string');
    }
    function create(getStorage, backend, now = Date.now) {
        const prefix = `lottery:history:v1:${encodeURIComponent(backend)}:`;
        const key = id => prefix + encodeURIComponent(id);
        function list() {
            const storage = getStorage();
            const records = [];
            let damaged = 0;
            for (let i = 0; i < storage.length; i++) {
                const name = storage.key(i);
                if (!name?.startsWith(prefix)) continue;
                const raw = storage.getItem(name);
                try {
                    const data = JSON.parse(raw);
                    if (!valid(data) || key(data.id) !== name) throw Error('invalid record');
                    records.push({ ...data, raw });
                } catch { damaged++; }
            }
            records.sort((a, b) => b.savedAt - a.savedAt || a.id.localeCompare(b.id));
            return { records, damaged };
        }
        function save(room) {
            if (typeof room.activityId !== 'string' || !Number.isFinite(room.createdAt)) {
                throw Error('服務尚未支援活動保存，請更新並重新啟動後端，再建立新活動。');
            }
            const storage = getStorage();
            const raw = storage.getItem(key(room.activityId));
            let previous = null;
            if (raw !== null) {
                try { previous = JSON.parse(raw); } catch { /* Never overwrite a damaged archive. */ }
                if (!valid(previous)) throw Error('此活動的歷史紀錄無法讀取，已保留原資料；請先匯出目前的 CSV。');
            }
            const record = {
                version: VERSION, id: room.activityId, roomId: room.id, createdAt: room.createdAt,
                savedAt: now(), settingsRevision: room.settingsRevision,
                prizes: room.prizes.map(row => ({ name: row.name })),
                quantities: room.quantities.map(row => ({ name: row.name })),
                winners: room.winners.map(row => ({ name: row.name, prize: row.prize, quantity: String(row.quantity) }))
            };
            if (!valid(record)) throw Error('活動資料不完整，尚未保存；請先匯出目前的 CSV。');
            // Queue/animation updates do not change the saved date. Stale replies cannot erase winners.
            if (previous) {
                if (previous.settingsRevision > record.settingsRevision || previous.winners.length > record.winners.length) return previous;
                const same = ['settingsRevision', 'prizes', 'quantities', 'winners'].every(field =>
                    JSON.stringify(previous[field]) === JSON.stringify(record[field]));
                if (same) return previous;
            }
            storage.setItem(key(record.id), JSON.stringify(record));
            return record;
        }
        function removeUnchanged(record) {
            const storage = getStorage();
            if (storage.getItem(key(record.id)) !== record.raw) return false;
            storage.removeItem(key(record.id));
            return true;
        }
        return { prefix, lockName: id => key(id), list, save, removeUnchanged };
    }
    function csv(winners) {
        const cell = value => {
            let text = String(value ?? '');
            if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
            return '"' + text.replace(/"/g, '""') + '"';
        };
        return '\uFEFF得獎人,獎項,數量\r\n' + winners.map(row =>
            [row.name, row.prize, row.quantity].map(cell).join(',')).join('\r\n') + '\r\n';
    }
    return { create, csv };
}));

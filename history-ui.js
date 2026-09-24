(function () {
    'use strict';
    const store = window.LotteryHistoryStore.create(() => window.localStorage, window.LOTTERY_CONFIG.backendUrl);
    const locks = window.navigator.locks;
    let current = null;
    let stopProtection = null;
    let protectedId = null;
    let generation = 0;
    let suspended = false;
    let dialog, entry, status, toolbar;
    let screen = 'list';
    let renderVersion = 0;
    let pendingClear = [];
    let clearing = false;
    const formatDate = time => new Intl.DateTimeFormat('zh-TW', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(time);
    const title = record => `${formatDate(record.createdAt)} 抽獎`;
    function node(tag, text, className) {
        const element = document.createElement(tag);
        if (text !== undefined) element.textContent = text;
        if (className) element.className = className;
        return element;
    }
    function button(text, action, className) {
        const element = node('button', text, className);
        element.type = 'button';
        element.addEventListener('click', action);
        return element;
    }
    function trash(element) {
        // Static icon only. All activity and winner data is rendered with textContent.
        element.insertAdjacentHTML('afterbegin', '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg>');
        return element;
    }
    function errorText(error) {
        if (error?.name === 'QuotaExceededError') return '瀏覽器儲存空間不足，最新資料尚未保存。請先匯出 CSV，再清除不需要的歷史紀錄。';
        if (error?.name === 'SecurityError') return '瀏覽器不允許保存或讀取歷史紀錄。請允許網站儲存資料，並先匯出 CSV 備份。';
        return error?.message || '歷史紀錄暫時無法存取，請先匯出 CSV 備份。';
    }
    function saveCurrent() {
        if (!current || suspended) return;
        try {
            const record = store.save(current);
            if (status) {
                status.dataset.error = 'false';
                status.textContent = `已保存至此瀏覽器 · ${formatDate(record.savedAt)}`;
            }
        } catch (error) {
            if (status) { status.dataset.error = 'true'; status.textContent = errorText(error); }
        }
    }
    function release() {
        generation++;
        stopProtection?.();
        stopProtection = null;
        protectedId = null;
    }
    function track(room, dealer) {
        if (toolbar) toolbar.hidden = !dealer;
        if (!dealer) { current = null; release(); return; }
        current = room;
        if (suspended) return;
        if (!locks || !room.activityId) { saveCurrent(); return; }
        if (protectedId === room.activityId) { saveCurrent(); return; }
        release();
        protectedId = room.activityId;
        const ticket = generation;
        // A shared lock stays held for the host page's lifetime, even in a sleeping tab.
        // Exclusive deletion therefore cannot remove a currently used activity.
        locks.request(store.lockName(room.activityId), { mode: 'shared' }, async () => {
            if (ticket !== generation || suspended) return;
            await new Promise(resolve => { stopProtection = resolve; saveCurrent(); });
        }).catch(error => {
            if (ticket !== generation) return;
            release();
            if (status) { status.dataset.error = 'true'; status.textContent = errorText(error); }
        });
    }
    function download(winners, filename = '雙滾輪得獎名單.csv') {
        const url = URL.createObjectURL(new Blob([window.LotteryHistoryStore.csv(winners)], { type: 'text/csv;charset=utf-8' }));
        const link = node('a');
        link.href = url;
        link.download = filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    async function inventory() {
        const { records, damaged } = store.list();
        const held = locks ? (await locks.query()).held : [];
        const active = new Set(held.map(lock => lock.name));
        return { records, damaged, active };
    }
    function refreshCount() {
        if (!entry) return;
        try { entry.textContent = `歷史活動（${store.list().records.length}）`; }
        catch { entry.textContent = '歷史活動'; }
    }
    function shell(heading, confirm = false) {
        dialog.replaceChildren();
        dialog.className = `history-dialog${confirm ? ' history-confirm' : ''}`;
        const header = node('div', undefined, 'history-header');
        const h2 = node('h2', heading);
        h2.id = 'history-dialog-title';
        const body = node('div', undefined, 'history-body');
        header.append(h2);
        dialog.append(header, body);
        return { header, body, h2 };
    }
    function closeButton() {
        const close = button('×', () => dialog.close(), 'history-close');
        close.setAttribute('aria-label', '關閉歷史活動');
        return close;
    }
    function focusHeading(h2) { h2.tabIndex = -1; h2.focus(); }
    function notice(body, text) {
        const p = node('p', text, 'history-notice');
        p.setAttribute('role', 'status');
        body.prepend(p);
    }
    function cell(row, text, label) {
        const td = node('td', text);
        if (label) td.dataset.label = label;
        row.append(td);
        return td;
    }
    function table(headings) {
        const t = node('table', undefined, 'history-table');
        const head = node('thead');
        const row = node('tr');
        headings.forEach(text => { const th = node('th', text); th.scope = 'col'; row.append(th); });
        head.append(row);
        const body = node('tbody');
        t.append(head, body);
        return { t, body };
    }
    async function showList(message = '', focus = true) {
        screen = 'list';
        const version = ++renderVersion;
        let data, error;
        try { data = await inventory(); } catch (e) { error = e; }
        if (version !== renderVersion || !dialog.open) return;
        const { header, body, h2 } = shell('歷史活動');
        const actions = node('div', undefined, 'history-header-actions');
        const clear = trash(button('清除歷史紀錄', showConfirmation, 'history-danger'));
        const removable = data?.records.filter(record => !data.active.has(store.lockName(record.id))) || [];
        clear.disabled = !locks || !removable.length || !!error;
        clear.title = !locks ? '此瀏覽器不支援安全清除，請使用新版 Chrome、Edge、Firefox 或 Safari。' : '清除已保存且未使用中的歷史活動';
        actions.append(clear, closeButton());
        header.append(node('span', `${data?.records.length || 0} 場`, 'history-count'), actions);
        body.append(node('p', '僅顯示此瀏覽器保存的活動，新活動不會覆蓋舊紀錄。', 'history-hint'));
        if (message) notice(body, message);
        if (error) notice(body, errorText(error));
        if (data?.damaged) notice(body, `${data.damaged} 筆紀錄格式異常，已保留原資料，未列入清除範圍。`);
        if (!locks) notice(body, '此瀏覽器暫不支援安全清除；仍可查看與匯出紀錄。');
        if (data?.records.length) {
            const list = table(['活動名稱', '最後儲存', '得獎筆數', '操作']);
            for (const record of data.records) {
                const row = node('tr');
                const name = cell(row);
                name.append(node('strong', title(record)), node('span', record.roomId, 'history-meta'));
                if (data.active.has(store.lockName(record.id))) name.append(node('span', '使用中', 'history-active'));
                cell(row, formatDate(record.savedAt), '最後儲存');
                cell(row, `${record.winners.length} 筆`, '得獎筆數');
                const buttons = node('div', undefined, 'history-row-actions');
                const exportButton = button('匯出 CSV', () => exportRecord(record.id));
                exportButton.disabled = !record.winners.length;
                buttons.append(button('查看紀錄', () => showDetail(record.id), 'history-primary'), exportButton);
                cell(row).append(buttons);
                list.body.append(row);
            }
            body.append(list.t);
        } else if (!error) body.append(node('p', '尚無歷史活動。建立活動後，主持人端會自動保存設定與得獎紀錄。', 'history-empty'));
        dialog.append(node('p', '依最後儲存時間排序，最新活動在最上方。使用中的活動會保留。', 'history-footer'));
        refreshCount();
        if (focus) focusHeading(h2);
    }
    function exportRecord(id) {
        try {
            const record = store.list().records.find(row => row.id === id);
            if (!record) { showList('此紀錄已在其他分頁清除。'); return; }
            download(record.winners, `${title(record)}-${record.roomId}.csv`);
        } catch (error) { showList(errorText(error)); }
    }
    function showDetail(id) {
        screen = 'detail';
        renderVersion++;
        let record;
        try { record = store.list().records.find(row => row.id === id); }
        catch (error) { showList(errorText(error)); return; }
        if (!record) { showList('此紀錄已在其他分頁清除。'); return; }
        const { header, body, h2 } = shell('活動紀錄');
        const actions = node('div', undefined, 'history-header-actions');
        actions.append(closeButton()); header.append(actions);
        const controls = node('div', undefined, 'history-detail-actions');
        const exportButton = button('匯出 CSV', () => exportRecord(id), 'history-primary');
        exportButton.disabled = !record.winners.length;
        controls.append(button('← 返回清單', () => showList()), exportButton);
        body.append(controls, node('h3', title(record)), node('p', `${record.roomId} · 最後儲存 ${formatDate(record.savedAt)}`, 'history-meta'),
            node('p', '這是保存的活動快照，可查看與匯出，不會重新啟動抽獎。', 'history-hint'));
        const winners = table(['得獎人', '抽中獎項', '數量']);
        for (const winner of record.winners) {
            const row = node('tr');
            cell(row, winner.name, '得獎人'); cell(row, winner.prize, '抽中獎項'); cell(row, winner.quantity, '數量');
            winners.body.append(row);
        }
        body.append(record.winners.length ? winners.t : node('p', '此活動尚無得獎紀錄。', 'history-empty'));
        const details = node('details', undefined, 'history-details');
        details.append(node('summary', '查看活動設定'));
        const settings = node('div', undefined, 'history-settings');
        for (const [label, rows] of [['獎項', record.prizes], ['數量選項', record.quantities]]) {
            const column = node('div'); const ul = node('ul');
            rows.forEach(row => ul.append(node('li', row.name)));
            column.append(node('h3', label), ul); settings.append(column);
        }
        details.append(settings); body.append(details); focusHeading(h2);
    }
    async function showConfirmation() {
        const version = ++renderVersion;
        let data;
        try { data = await inventory(); } catch (error) { showList(errorText(error)); return; }
        if (version !== renderVersion || !dialog.open) return;
        pendingClear = data.records.filter(record => !data.active.has(store.lockName(record.id)));
        if (!locks || !pendingClear.length) { showList('目前沒有可清除的歷史活動，使用中的活動已保留。'); return; }
        screen = 'confirm';
        const { header, body } = shell('清除歷史紀錄？', true);
        header.prepend(trash(node('span', undefined, 'history-warning-icon')));
        body.append(node('p', `將刪除此瀏覽器保存的 ${pendingClear.length} 場歷史活動，包含設定與得獎名單。`),
            node('p', '清除後無法復原，請先匯出需要保留的 CSV。'),
            node('p', '正在使用中的活動、主持人身分及已下載的 CSV 不受影響。', 'history-hint'));
        const actions = node('div', undefined, 'history-confirm-actions');
        const cancel = button('取消', () => showList());
        const confirm = button(`確認清除 ${pendingClear.length} 場紀錄`, async () => {
            const targets = pendingClear.slice();
            clearing = true;
            confirm.disabled = true; cancel.disabled = true;
            let count = 0;
            let failure = '';
            for (const record of targets) {
                try {
                    await locks.request(store.lockName(record.id), { mode: 'exclusive', ifAvailable: true }, lock => {
                        if (lock && store.removeUnchanged(record)) count++;
                    });
                } catch (error) { failure = errorText(error); break; }
            }
            clearing = false;
            showList(`已清除 ${count} 場歷史活動。${count < targets.length ? '使用中、已更新或已被清除的紀錄未重複刪除。' : ''}${failure ? '\n' + failure : ''}`);
        }, 'history-danger-solid');
        actions.append(cancel, confirm); body.append(actions); cancel.focus();
    }
    function open() {
        dialog.showModal();
        showList();
    }
    window.LOTTERY_HISTORY = Object.freeze({ track, download, stop() { current = null; release(); } });
    document.addEventListener('DOMContentLoaded', () => {
        entry = document.getElementById('history-entry');
        status = document.getElementById('history-save-status');
        toolbar = document.getElementById('history-toolbar');
        // Game pages keep automatic archiving; the history interface only exists in the lobby.
        setInterval(() => { if (current && !suspended) saveCurrent(); }, 30000);
        if (!entry) return;
        dialog = node('dialog', undefined, 'history-dialog');
        dialog.setAttribute('aria-labelledby', 'history-dialog-title');
        dialog.addEventListener('close', () => { renderVersion++; });
        dialog.addEventListener('cancel', event => {
            if (clearing) { event.preventDefault(); return; }
            if (screen === 'confirm') { event.preventDefault(); showList(); }
        });
        document.body.append(dialog);
        entry?.addEventListener('click', open);
        refreshCount();
        window.addEventListener('storage', event => {
            if (event.key !== null && !event.key.startsWith(store.prefix)) return;
            refreshCount();
            if (dialog.open && screen === 'list') showList('', false);
        });
        window.addEventListener('focus', refreshCount);
    });
    window.addEventListener('pagehide', () => { suspended = true; release(); });
    window.addEventListener('pageshow', () => { suspended = false; if (current) track(current, true); });
}());

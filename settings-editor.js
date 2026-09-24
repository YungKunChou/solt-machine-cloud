(function () {
    'use strict';
    const rules = window.LotterySettingsRules;
    const labels = { prizes: '獎項', quantities: '數量' };
    const types = Object.keys(labels);
    const copy = list => list.map(item => ({ name: item.name }));
    window.createLotterySettingsEditor = function (root, submit) {
        let snapshot = { prizes: [], quantities: [], settingsRevision: 0 };
        let draft = null;
        let online = false;
        let dealer = false;
        let saving = false;
        let serial = 0;
        let errors = [];
        let notice = '';
        let savedMessage = '';
        let undo = {};

        root.innerHTML = `
            <div class="settings-heading">
                <div class="settings-heading-title"><h2>獎項與數量設定</h2><span class="settings-badge" hidden>編輯中</span></div>
                <button type="button" class="settings-button" id="edit-settings-btn">編輯設定</button>
            </div>
            <p class="settings-subtitle">設定本次抽獎的獎項與數量</p>
            <div class="settings-columns"></div>
            <p class="settings-notice" role="status" aria-live="polite" hidden></p>
            <div class="settings-footer" hidden>
                <div><div class="settings-status" role="status" aria-live="polite"></div><p class="settings-hint">變更將在儲存後生效</p></div>
                <div class="settings-footer-actions">
                    <button type="button" class="settings-button secondary" id="cancel-settings-btn">取消</button>
                    <button type="button" class="settings-button" id="save-settings-btn">儲存全部變更</button>
                </div>
            </div>`;
        const query = selector => root.querySelector(selector);
        const editButton = query('#edit-settings-btn');
        const cancelButton = query('#cancel-settings-btn');
        const saveButton = query('#save-settings-btn');
        const columns = {};

        function iconButton(label, icon, className, onClick) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'settings-button ' + className;
            const image = document.createElement('img');
            image.src = `assets/icons/${icon}.svg`;
            image.alt = '';
            image.className = 'settings-icon';
            const text = document.createElement('span');
            text.textContent = label;
            button.append(image, text);
            button.addEventListener('click', onClick);
            return button;
        }

        for (const type of types) {
            const column = document.createElement('section');
            column.className = 'settings-column';
            column.setAttribute('aria-labelledby', `${type}-heading`);
            column.innerHTML = `
                <div class="settings-column-top">
                    <h3 id="${type}-heading">${type === 'prizes' ? '獎項項目' : '數量選項'}<span class="settings-count"></span></h3>
                    <div class="settings-tools" hidden>
                        <input type="checkbox" class="settings-checkbox settings-select-all" aria-label="全選${labels[type]}" title="全選${labels[type]}" hidden>
                    </div>
                </div>
                <div id="${type}-settings-rows"></div>
                <p class="settings-list-message" hidden></p>
                <div class="settings-undo" hidden><span></span><button type="button" class="settings-link">復原</button></div>`;
            const q = selector => column.querySelector(selector);
            const add = iconButton('新增', 'plus', '', () => addRow(type));
            add.setAttribute('aria-label', `新增${labels[type]}`);
            const remove = iconButton('刪除選取', 'trash', 'danger', () => deleteRows(type));
            remove.setAttribute('aria-label', `刪除選取${labels[type]}`);
            q('.settings-tools').append(add, remove);
            const all = q('.settings-select-all');
            all.addEventListener('change', () => {
                if (!draft || saving) return;
                draft[type].forEach(row => { row.selected = all.checked; });
                renderRows(type);
                updateControls();
            });
            q('.settings-link').addEventListener('click', () => {
                if (!draft || saving || !undo[type]) return;
                if (draft[type].length + undo[type].length > rules.MAX_ROWS) {
                    notice = `復原後超過 ${rules.MAX_ROWS} 筆，請先刪除多餘項目。`;
                    updateControls();
                    return;
                }
                for (const entry of undo[type]) draft[type].splice(Math.min(entry.index, draft[type].length), 0, { ...entry.row, selected: false });
                delete undo[type];
                errors = [];
                notice = '';
                renderRows(type);
                updateControls();
            });
            columns[type] = { element: column, rows: q(`#${type}-settings-rows`), all, add, remove, query: q };
            query('.settings-columns').append(column);
        }

        function dirty() {
            return draft && types.some(type => JSON.stringify(copy(draft[type])) !== JSON.stringify(draft.original[type]));
        }
        function busy() { return Boolean(snapshot.currentTurnData?.playerName); }
        function canEdit() { return dealer && online && !saving; }

        function renderRows(type) {
            const { rows, query: q } = columns[type];
            rows.replaceChildren();
            const items = draft ? draft[type] : snapshot[type];
            items.forEach((item, index) => {
                const row = document.createElement('div');
                row.className = 'settings-row' + (item.selected ? ' selected' : '');
                if (draft) {
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'settings-checkbox';
                    checkbox.checked = item.selected;
                    checkbox.disabled = saving;
                    checkbox.setAttribute('aria-label', `選取${labels[type]}第 ${index + 1} 筆`);
                    checkbox.addEventListener('change', () => {
                        item.selected = checkbox.checked;
                        row.classList.toggle('selected', item.selected);
                        updateControls();
                    });
                    row.append(checkbox);
                }
                const number = document.createElement('span');
                number.className = 'settings-number';
                number.textContent = index + 1;
                row.append(number);
                const field = document.createElement('div');
                field.className = 'settings-field';
                if (draft) {
                    const input = document.createElement('input');
                    input.className = 'settings-input';
                    input.type = 'text';
                    if (type === 'quantities') input.inputMode = 'numeric';
                    else input.maxLength = rules.MAX_NAME_LENGTH;
                    input.id = 'setting-' + item.id;
                    input.value = item.name;
                    input.disabled = saving;
                    input.autocomplete = 'off';
                    input.setAttribute('aria-label', `${labels[type]}第 ${index + 1} 筆`);
                    input.setAttribute('aria-describedby', input.id + '-error');
                    const error = document.createElement('p');
                    error.className = 'settings-error';
                    error.id = input.id + '-error';
                    const issue = errors.find(e => e.type === type && e.index === index);
                    error.textContent = issue?.message || '';
                    error.hidden = !issue;
                    input.setAttribute('aria-invalid', String(Boolean(issue)));
                    input.addEventListener('input', () => {
                        item.name = input.value;
                        errors = errors.filter(e => e.type !== type || e.index !== index);
                        error.hidden = true;
                        input.setAttribute('aria-invalid', 'false');
                        notice = '';
                        updateControls();
                    });
                    field.append(input, error);
                } else {
                    const value = document.createElement('span');
                    value.className = 'settings-value';
                    value.textContent = item.name;
                    value.title = item.name;
                    field.append(value);
                }
                row.append(field);
                rows.append(row);
            });
            const listIssue = errors.find(e => e.type === type && e.index === -1);
            q('.settings-list-message').textContent = listIssue?.message || (items.length ? '' : `目前沒有${labels[type]}，請新增至少一筆。`);
            q('.settings-list-message').hidden = !listIssue && items.length > 0;
        }

        function updateControls() {
            root.classList.toggle('is-editing', Boolean(draft));
            editButton.hidden = Boolean(draft);
            editButton.disabled = !canEdit();
            query('.settings-badge').hidden = !draft;
            query('.settings-subtitle').textContent = draft ? '直接修改欄位，完成後一次儲存' : '設定本次抽獎的獎項與數量';
            query('.settings-footer').hidden = !draft;
            const changed = dirty();
            const conflict = draft && snapshot.settingsRevision !== draft.baseRevision;
            const status = query('.settings-status');
            status.textContent = saving ? '正在儲存…' : changed ? '尚未儲存' : '尚無變更';
            status.classList.toggle('saved', !changed && !saving);
            cancelButton.disabled = saving;
            saveButton.disabled = !canEdit() || !changed || busy() || Boolean(conflict);
            saveButton.textContent = saving ? '儲存中…' : '儲存全部變更';
            let message = notice || savedMessage;
            if (!online) message = '連線已中斷，草稿仍保留；重新連線後才能儲存。';
            else if (draft && !dealer) message = '目前沒有主持權，草稿仍保留；請先確認主持人身分。';
            else if (conflict && !saving) message = '設定已更新，草稿仍保留。請取消編輯後重新載入最新設定。';
            else if (draft && busy()) message = '玩家正在抽獎，請待本輪結束後儲存。';
            else if (draft && !message) {
                const values = draft.quantities.map(row => row.name.trim()).filter(Boolean).map(Number);
                if (new Set(values).size < values.length) message = '數量有重複選項，重複值會增加抽中機率。';
            }
            const banner = query('.settings-notice');
            banner.textContent = message;
            banner.hidden = !message;
            for (const type of types) {
                const c = columns[type];
                const items = draft ? draft[type] : snapshot[type];
                const selected = items.filter(row => row.selected).length;
                c.query('.settings-count').textContent = `（${items.length} 筆）`;
                c.query('.settings-tools').hidden = !draft;
                c.all.hidden = !draft;
                c.all.disabled = saving || items.length === 0;
                c.all.checked = items.length > 0 && selected === items.length;
                c.all.indeterminate = selected > 0 && selected < items.length;
                c.add.disabled = saving || items.length >= rules.MAX_ROWS;
                c.remove.disabled = saving || !selected;
                c.remove.querySelector('span').textContent = selected ? `刪除選取（${selected}）` : '刪除選取';
                c.query('.settings-undo').hidden = !draft || !undo[type];
                c.query('.settings-undo span').textContent = undo[type] ? `已移除 ${undo[type].length} 筆` : '';
                c.query('.settings-link').disabled = saving;
            }
        }

        function render() {
            types.forEach(renderRows);
            updateControls();
        }
        function addRow(type) {
            if (!draft || saving || draft[type].length >= rules.MAX_ROWS) return;
            const item = { id: ++serial, name: '', selected: false };
            draft[type].push(item);
            errors = errors.filter(e => e.type !== type || e.index !== -1);
            renderRows(type);
            updateControls();
            document.getElementById('setting-' + item.id).focus();
        }
        function deleteRows(type) {
            if (!draft || saving) return;
            const removed = draft[type].map((row, index) => ({ row, index })).filter(entry => entry.row.selected);
            if (!removed.length) return;
            undo[type] = removed;
            draft[type] = draft[type].filter(row => !row.selected);
            errors = [];
            notice = '';
            renderRows(type);
            updateControls();
        }

        editButton.addEventListener('click', () => {
            if (!canEdit()) return;
            draft = { baseRevision: snapshot.settingsRevision, original: {} };
            for (const type of types) {
                draft.original[type] = copy(snapshot[type]);
                draft[type] = snapshot[type].map(item => ({ id: ++serial, name: item.name, selected: false }));
            }
            undo = {};
            errors = [];
            notice = savedMessage = '';
            render();
        });
        cancelButton.addEventListener('click', () => {
            if (saving) return;
            draft = null;
            errors = [];
            undo = {};
            notice = '';
            render();
            editButton.focus();
        });
        saveButton.addEventListener('click', async () => {
            if (!draft || !canEdit() || busy()) return;
            const checked = rules.validate(copy(draft.prizes), copy(draft.quantities));
            errors = checked.errors;
            if (!checked.valid) {
                notice = '請修正標示的欄位後再儲存。';
                render();
                query('[aria-invalid="true"]')?.focus();
                return;
            }
            const payload = { prizes: checked.prizes, quantities: checked.quantities, baseRevision: draft.baseRevision };
            saving = true;
            notice = '';
            render();
            try {
                const result = await submit(payload);
                snapshot = { ...snapshot, ...result.settings };
                draft = null;
                undo = {};
                errors = [];
                savedMessage = '設定已儲存，所有玩家已同步更新。';
            } catch (error) {
                notice = error.message || '儲存失敗，草稿仍保留，請稍後再試。';
            } finally {
                saving = false;
                render();
            }
        });
        window.addEventListener('beforeunload', event => {
            if (!dirty()) return;
            event.preventDefault();
            event.returnValue = '';
        });

        render();
        return {
            update(roomState, isDealer) {
                snapshot = { ...roomState, settingsRevision: roomState.settingsRevision || 0 };
                dealer = isDealer;
                online = true;
                if (!draft) render();
                else updateControls();
            },
            disconnect() { online = false; updateControls(); }
        };
    };
}());

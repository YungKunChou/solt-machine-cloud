document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    const P = window.LotteryProtocol;
    const roomId = new URLSearchParams(location.search).get('room');
    const el = id => document.getElementById(id);
    const input = el('participant-name'), status = el('draw-status');
    const statusLabel = el('draw-status-label'), statusMessage = el('draw-status-message');
    let displayedStatus = '';
    function showStatus(notice) {
        const key = JSON.stringify(notice);
        if (key === displayedStatus) return;
        displayedStatus = key;
        status.dataset.kind = notice.kind;
        statusLabel.textContent = notice.label;
        if (notice.winner) {
            const result = document.createElement('strong');
            result.textContent = `「${notice.winner.prize}」× ${notice.winner.quantity}`;
            statusMessage.replaceChildren(document.createTextNode('恭喜您抽中'), result, document.createTextNode('！'));
        } else statusMessage.textContent = notice.message;
    }
    if (!roomId) { showStatus({ kind: 'error', label: '需要處理', message: '無效的房間網址，請從 VIP 首頁建立房間。' }); return; }
    const socket = io(window.LOTTERY_CONFIG.backendUrl);
    const clock = new window.LotteryClock.ServerClock();
    let activityId = null, participantId = null, dealer = false, joined = false, replaced = false;
    let state = null, buffered = null, generation = 0, recovery = null, registeredName = null;
    let storageUnavailable = false, pendingRemoval = null, namePending = false;
    const pendingReels = new Set();
    const pending = new Map();
    // Connection/session notices outrank action errors; ordinary room updates
    // can refresh the queue without overwriting either one.
    let connectionNotice = { kind: 'connecting', label: '連線中', message: '正在加入房間…' };
    const actionErrors = new Map();
    const envelope = data => ({ roomId, activityId, protocolVersion: P.VERSION, ...data });
    function errorText(error, scope = 'general', event = '') {
        actionErrors.delete(scope);
        actionErrors.set(scope, { kind: 'error', label: '需要處理', message: error.message || String(error), event });
        renderStatus();
    }
    function connectionStatus(kind, label, message) {
        connectionNotice = { kind, label, message };
        renderStatus();
    }
    function renderStatus() {
        if (connectionNotice) { showStatus(connectionNotice); return; }
        if (!state) return;
        const me = state.players[participantId], head = state.queue[0], ahead = state.queue.indexOf(participantId);
        if (me?.completed || me?.removed) {
            actionErrors.delete('name');
            for (const type of P.TYPES) actionErrors.delete('reel:' + type);
        }
        for (const type of P.TYPES) {
            const issue = actionErrors.get('reel:' + type);
            const plan = state.round?.playerId === participantId && state.round.reels[type];
            if (issue && plan && (issue.event === 'startReel' || issue.event === 'stopReel' && plan.stop)) actionErrors.delete('reel:' + type);
        }
        const error = [...actionErrors.values()].at(-1);
        if (error) { showStatus(error); return; }
        if (namePending) { showStatus({ kind: 'connecting', label: '確認中', message: '正在確認姓名…' }); return; }
        if (dealer) showStatus({ kind: 'neutral', label: '主持人', message: '邀請玩家掃描 QR Code 加入遊戲。' });
        else if (me?.removed || storageUnavailable) showStatus({ kind: 'neutral', label: '觀看中', message: '目前為觀看模式，可繼續觀看抽獎。' });
        else if (me?.completed) {
            const winner = state.winners.find(entry => entry.playerId === participantId);
            showStatus(winner ? { kind: 'success', label: '抽獎完成', winner: { prize: winner.prize, quantity: winner.quantity } }
                : { kind: 'connecting', label: '同步中', message: '抽獎結果同步中，請稍候…' });
        } else if (state.round?.playerId === participantId) showStatus({ kind: 'spinning', label: '抽獎中', message: '' });
        else if (head === participantId) showStatus({ kind: 'turn', label: '輪到你了', message: me?.name
            ? '請開始抽獎；操作逾期將由系統完成' : '請先輸入姓名，再開始抽獎。' });
        else showStatus({ kind: 'neutral', label: head ? '等待中' : '等待加入', message: head
            ? `目前由 ${state.players[head]?.name || '下一位玩家'} 抽獎。` + (ahead > 0 ? `前面還有 ${ahead} 位，請稍候。` : '')
            : '目前沒有等待中的玩家。' });
    }
    function rpc(event, payload, attempts = 3) {
        return new Promise((resolve, reject) => {
            const started = generation;
            function send(left) {
                if (!socket.connected || started !== generation) { reject(Error('連線中斷，重新加入後將恢復最新狀態。')); return; }
                socket.timeout(5000).emit(event, payload, (error, result) => {
                    if (started !== generation) { reject(Error('連線已更新，請依目前畫面操作。')); return; }
                    if (error && left > 1) { send(left - 1); return; }
                    if (error) reject(Error('尚未收到確認，請稍後再試；已成立的回合仍由系統完成。'));
                    else resolve(result);
                });
            }
            send(attempts);
        });
    }
    async function operation(event, data) {
        if (!joined) throw Error('請待連線恢復後再操作。');
        const operationId = crypto.randomUUID();
        pending.set(operationId, event);
        try {
            const result = await rpc(event, envelope({ ...data, operationId }));
            if (result?.operationId !== operationId) throw Error('操作確認不符，請重新同步後再試。');
            if (result.success && (result.activityId !== activityId || !P.compatible(result.protocolVersion))) throw Error('操作所屬活動或版本不符，請重新整理。');
            // Acknowledgement and snapshot ordering are deliberately independent.
            pending.delete(operationId);
            if (result.snapshot) receive(result.snapshot);
            if (!result.success) throw Error(result.message || '操作失敗，請再試一次。');
            if (event === 'setPlayerName') actionErrors.delete('name');
            if (event === 'startReel' || event === 'stopReel') actionErrors.delete('reel:' + data.type);
            renderStatus();
            return result;
        } finally { pending.delete(operationId); }
    }
    const settingsStore = window.LotterySettingsStore.create(() => window.localStorage, window.LOTTERY_CONFIG.backendUrl);
    const editor = window.createLotterySettingsEditor(el('prize-management'), async payload => {
        const result = await operation('updateSettings', payload);
        const latest = state?.settingsRevision > result.settings.settingsRevision ? state : result.settings;
        try { settingsStore.save(latest); }
        catch {
            return { ...result, persistenceWarning: '本次活動設定已更新，但此瀏覽器未能保存供下次使用；請允許網站儲存或確認儲存空間。' };
        }
        return result;
    });
    const players = Object.fromEntries(P.TYPES.map(type => [type,
        window.createLotteryReelPlayer(el(type + '-reel'), type, clock, message => {
            connectionStatus('connecting', '同步中', message);
            if (!recovery) recover().catch(errorText);
        }, renderControls)]));
    async function syncClock() {
        const samples = [];
        for (let i = 0; i < 5; i++) {
            const begin = performance.now();
            const result = await rpc('clockSync', {} , 1);
            const end = performance.now();
            if (!P.compatible(result?.protocolVersion)) throw Error('前後端版本不相容，請配套更新後重新整理。');
            samples.push({ begin, end, serverTime: result.serverTime });
        }
        clock.observe(samples);
    }
    function displayedRound() {
        if (state?.round) return state.round;
        return state?.lastRound && state.lastRound.settingsRevision === state.settingsRevision ? state.lastRound : null;
    }
    function renderReels(force = false) {
        if (!state) return;
        const round = displayedRound();
        clock.useRound(round?.id ?? null, force);
        for (const type of P.TYPES) players[type].update(round?.reels[type] || null,
            round?.options[type] || state[type === 'prize' ? 'prizes' : 'quantities'], round?.initialPositions?.[type] ?? 0);
        el('slot-window').classList.toggle('spectator-mode', !!state.round && state.round.playerId !== participantId);
    }
    function receive(next) {
        if (!joined || recovery) {
            if (P.acceptSnapshot(buffered, next, activityId)) buffered = next;
            return;
        }
        if (!P.acceptSnapshot(state, next, activityId)) return;
        if (state?.round && !next.round && next.lastRound?.id === state.round.id) {
            el('window-reveal-glow').classList.add('winner-flash');
            setTimeout(() => el('window-reveal-glow').classList.remove('winner-flash'), 2400);
        }
        state = next;
        render(); renderReels();
    }
    function applyBuffered(snapshot) {
        const next = buffered && buffered.stateVersion > snapshot.stateVersion ? buffered : snapshot;
        buffered = null;
        if (P.acceptSnapshot(state, next, activityId)) state = next;
    }
    async function recover() {
        if (!joined || recovery) return recovery;
        const attempt = generation;
        connectionStatus('connecting', '同步中', '正在同步抽獎進度，請稍候。');
        recovery = (async () => {
            await syncClock();
            const result = await rpc('getSnapshot', envelope({}));
            if (!result?.success) throw Error(result?.message || '同步失敗，請重新整理。');
            if (attempt !== generation) return;
            applyBuffered(result.snapshot);
            connectionNotice = null;
            actionErrors.delete('general');
            render(); renderReels(true);
        })();
        try { await recovery; }
        catch (error) { if (attempt === generation) connectionStatus('error', '同步失敗', error.message || String(error)); }
        finally { recovery = null; if (buffered) { const next = buffered; buffered = null; receive(next); } }
    }
    socket.on('connect', async () => {
        if (replaced) { socket.disconnect(); return; }
        const attempt = ++generation;
        joined = false; connectionStatus('connecting', '連線中', '正在加入房間…'); renderControls();
        try {
            const info = await rpc('getRoomInfo', { roomId }).catch(() => { throw Error('無法確認服務版本，請確認後端已更新並可連線後重新整理。'); });
            if (!info?.success) throw Error(info?.message || '房間不存在。');
            if (!P.compatible(info.protocolVersion)) throw Error('前後端版本不相容，請配套更新後重新整理。');
            if (activityId && info.activityId !== activityId) throw Error('活動已變更，請從首頁重新加入。');
            activityId = info.activityId;
            await syncClock();
            const dealerToken = window.LOTTERY_ROOM_SESSION.read(roomId);
            const identity = dealerToken ? null : window.LOTTERY_PLAYER_SESSION.prepare(roomId, activityId);
            storageUnavailable = !dealerToken && !identity;
            const result = await rpc('joinRoom', envelope({ dealerToken, participantToken: identity?.token,
                spectator: storageUnavailable || !!identity?.removed }));
            if (!result?.success) throw Error(result?.message || '加入失敗。');
            if (attempt !== generation) return;
            participantId = result.participantId; dealer = result.role === 'dealer'; joined = true;
            connectionNotice = null;
            actionErrors.delete('general');
            applyBuffered(result.snapshot);
            render(); renderReels(true);
        } catch (error) { if (attempt === generation) { editor.disconnect(); connectionStatus('error', '連線失敗', error.message || String(error)); } }
    });
    socket.on('updateRoomState', receive);
    socket.on('disconnect', () => {
        generation++; joined = false; buffered = null; pending.clear(); pendingReels.clear(); pendingRemoval = null; namePending = false;
        window.LOTTERY_HISTORY.stop(); editor.disconnect(); renderControls(); renderQueue();
        if (!replaced) connectionStatus('connecting', '重新連線中', '連線中斷，正在重新連線；已成立的回合仍由系統完成。');
    });
    socket.on('connect_error', () => {
        if (replaced) return;
        editor.disconnect(); connectionStatus('connecting', '重新連線中', '無法連線，系統正在自動重試，請稍候。');
    });
    for (const event of ['dealerReplaced', 'participantReplaced']) socket.on(event, data => {
        if (data?.activityId !== activityId) return;
        replaced = true;
        if (event === 'dealerReplaced') window.LOTTERY_ROOM_SESSION.remove(roomId);
        connectionStatus('error', '請切換分頁', '身分已在另一個分頁恢復，請使用最新的分頁。');
        socket.disconnect();
    });
    socket.on('removedFromQueue', data => {
        if (data?.activityId === activityId && !dealer) window.LOTTERY_PLAYER_SESSION.markRemoved(roomId, activityId);
    });
    socket.on('error', errorText);
    function renderControls() {
        const me = state?.players[participantId];
        input.disabled = !joined || dealer || me?.removed || me?.completed || state?.round?.playerId === participantId;
        input.placeholder = dealer ? '您是莊家，不參加抽獎' : me?.removed ? '目前為觀看模式' : '在此輸入姓名…';
        for (const type of P.TYPES) {
            const lever = el(type === 'prize' ? 'lever-left' : 'lever-right');
            const plan = state?.round?.reels[type];
            const visiblePlan = displayedRound()?.reels[type];
            const moving = !!visiblePlan && (!visiblePlan.stop || clock.now() < visiblePlan.stop.stopAt);
            const returning = moving && visiblePlan.stop?.source === 'manual';
            const pulled = !returning && (moving || !visiblePlan && pendingReels.has(type));
            const enabled = joined && !dealer && !me?.removed && !me?.completed && !!me?.name && state?.queue[0] === participantId && !plan?.stop && !pendingReels.has(type);
            const label = type === 'prize' ? '獎項' : '數量';
            const control = el(type + '-control');
            const controlText = pendingReels.has(type) ? '確認中…'
                : !plan ? `抽${label}`
                : plan.stop ? (moving ? '減速中…' : '已停止')
                : `停止${label}`;
            for (const button of [lever, control]) {
                button.disabled = !enabled;
                button.setAttribute('aria-disabled', String(!enabled));
                button.setAttribute('aria-label', controlText.includes(label) ? controlText : `${label}：${controlText}`);
            }
            control.textContent = controlText;
            lever.classList.toggle('pulled', pulled);
            lever.classList.toggle('returning', returning);
        }
    }
    function render() {
        if (!state) return;
        const me = state.players[participantId];
        if (me?.removed && !dealer && !storageUnavailable) window.LOTTERY_PLAYER_SESSION.markRemoved(roomId, activityId);
        const notice = el('queue-spectator-notice');
        notice.hidden = dealer || !me?.removed;
        notice.textContent = storageUnavailable ? '此瀏覽器無法保存分頁身分，目前僅能觀看。請允許此網站使用儲存空間，再重新整理以加入隊伍。'
            : '你已被莊家移出隊伍，目前可繼續觀看；此分頁重新整理後不會自動加入隊伍。';
        if ((me?.name || null) !== registeredName) {
            input.value = me?.name || '';
            if (me?.name) actionErrors.delete('name');
        }
        registeredName = me?.name || null;
        editor.update(state, dealer);
        el('prize-management').style.display = dealer ? 'block' : 'none';
        el('dealer-share-info').style.display = dealer ? 'block' : 'none';
        el('export-csv-btn').style.display = dealer ? 'inline-block' : 'none';
        window.LOTTERY_HISTORY.track(state, dealer);
        renderStatus();
        const head = state.queue[0];
        const indicator = el('current-player-indicator');
        const currentPlayerName = state.round?.playerName || state.players[head]?.name;
        indicator.classList.toggle('awaiting-player-name', !currentPlayerName);
        indicator.textContent = currentPlayerName || (head ? '等待玩家填寫姓名' : '等待玩家加入');
        indicator.style.display = 'block';
        renderControls(); renderQueue(); renderWinners();
    }
    function renderQueue() {
        if (!state) return;
        const list = el('queue-list'); list.replaceChildren();
        el('queue-count').textContent = `${state.queue.length} 人`;
        el('queue-empty').hidden = state.queue.length > 0;
        state.queue.forEach((pid, index) => {
            const person = state.players[pid], active = state.round?.playerId === pid;
            const row = document.createElement('li'); row.className = active ? 'queue-active' : '';
            const number = document.createElement('span'); number.className = 'queue-number'; number.textContent = index + 1;
            const name = document.createElement('span'); name.className = 'queue-name' + (pid === participantId ? ' queue-self' : '');
            const label = person?.name || `玩家 #${index + 1}`;
            name.textContent = label + (pid === participantId ? '（你）' : '');
            if (!person?.name) { const hint = document.createElement('span'); hint.className = 'queue-subtitle'; hint.textContent = '尚未填姓名'; name.append(hint); }
            row.append(number, name);
            if (active) {
                const lock = document.createElement('span'); lock.className = 'queue-locked';
                const icon = document.createElement('span'); icon.className = 'queue-icon'; icon.setAttribute('aria-hidden', 'true');
                lock.append(icon, document.createTextNode('抽獎中')); row.append(lock);
            } else if (dealer) {
                const button = document.createElement('button'); button.type = 'button'; button.className = 'queue-remove';
                button.textContent = pendingRemoval === pid ? '…' : 'X'; button.setAttribute('aria-label', `將${label}移出隊伍`);
                button.disabled = !joined || pendingRemoval !== null;
                button.addEventListener('click', async () => {
                    if (!joined || pendingRemoval !== null) return;
                    const actionGeneration = generation;
                    pendingRemoval = pid; el('queue-feedback').hidden = true; renderQueue();
                    try { await operation('removeQueuedPlayer', { playerId: pid }); }
                    catch (error) { if (actionGeneration === generation) { el('queue-feedback').textContent = error.message; el('queue-feedback').hidden = false; } }
                    finally { if (actionGeneration === generation) { pendingRemoval = null; renderQueue(); } }
                }); row.append(button);
            }
            list.append(row);
        });
    }
    function renderWinners() {
        const list = el('winners-table'); list.replaceChildren();
        if (!state.winners.length) {
            const empty = document.createElement('div'); empty.className = 'text-center text-gray-500 p-4 col-span-3'; empty.textContent = '目前尚無得獎者。'; list.append(empty);
        }
        [...state.winners].reverse().forEach(winner => {
            const row = document.createElement('div'); row.className = 'grid grid-cols-8 items-center';
            ['name', 'prize', 'quantity'].forEach((key, i) => { const cell = document.createElement('div'); cell.className = ['col-span-2', 'col-span-5', 'text-center col-span-1'][i]; cell.textContent = winner[key]; row.append(cell); });
            list.append(row);
        });
    }
    async function submitName() {
        if (input.disabled || namePending) return;
        const name = input.value.trim(); if (!name || name === registeredName) return;
        const actionGeneration = generation;
        namePending = true; renderStatus();
        try { await operation('setPlayerName', { name }); }
        catch (error) { if (actionGeneration === generation) { input.value = registeredName || ''; errorText(error, 'name'); } }
        finally { if (actionGeneration === generation) { namePending = false; renderStatus(); } }
    }
    input.addEventListener('change', submitName);
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submitName(); }
    });
    for (const type of P.TYPES) {
        const activate = async () => {
            const me = state?.players[participantId], round = state?.round;
            if (!joined || dealer || !me?.name || me.removed || me.completed || state.queue[0] !== participantId || pendingReels.has(type) || round?.reels[type]?.stop) return;
            const actionGeneration = generation;
            const event = round?.reels[type] ? 'stopReel' : 'startReel';
            pendingReels.add(type); renderControls();
            try { await operation(event, { type, roundId: round?.id ?? null }); }
            catch (error) { if (actionGeneration === generation) errorText(error, 'reel:' + type, event); }
            finally { if (actionGeneration === generation) { pendingReels.delete(type); renderControls(); } }
        };
        el(type === 'prize' ? 'lever-left' : 'lever-right').addEventListener('click', activate);
        el(type + '-control').addEventListener('click', activate);
    }
    el('export-csv-btn').addEventListener('click', () => { if (dealer && state?.winners.length) window.LOTTERY_HISTORY.download(state.winners); });
    const share = new URL(location.href); share.search = ''; share.hash = ''; share.searchParams.set('room', roomId);
    el('room-url-input').value = share.href;
    el('qrcode').replaceChildren();
    new QRCode(el('qrcode'), share.href);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) recover().catch(errorText); });
    window.addEventListener('pageshow', event => { if (event.persisted) recover().catch(errorText); });
    let lastWall = Date.now(), lastMono = performance.now();
    setInterval(async () => {
        const wall = Date.now(), mono = performance.now();
        const resumed = Math.abs((wall - lastWall) - (mono - lastMono)) > 1000 || mono - lastMono > 45000;
        lastWall = wall; lastMono = mono;
        if (!joined || document.hidden || recovery) return;
        try {
            if (resumed) await recover();
            else { await syncClock(); if (Math.abs(clock.drift()) > P.TIMING.recoveryThresholdMs) await recover(); }
        } catch (error) { errorText(error); }
    }, P.TIMING.sampleMaxAgeMs);
    renderControls();
    renderStatus();
    // Read-only diagnostics for manual synchronization measurement; no credentials or private draws.
    window.LOTTERY_DIAGNOSTICS = () => ({ activityId, stateVersion: state?.stateVersion ?? null,
        clock: clock.diagnostics(), reels: Object.fromEntries(P.TYPES.map(type => {
            const plan = displayedRound()?.reels[type];
            return [type, { planId: plan?.planId ?? null, planVersion: plan?.planVersion ?? null,
                position: players[type].position(), startAt: plan?.startAt ?? null,
                brakeAt: plan?.stop?.brakeAt ?? null, stopAt: plan?.stop?.stopAt ?? null,
                targetOptionId: plan?.stop?.optionId ?? null }];
        })) });
});

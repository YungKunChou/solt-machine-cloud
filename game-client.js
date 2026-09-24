document.addEventListener('DOMContentLoaded', () => {
    'use strict';
    const P = window.LotteryProtocol;
    const roomId = new URLSearchParams(location.search).get('room');
    const el = id => document.getElementById(id);
    const input = el('participant-name'), status = el('draw-status');
    if (!roomId) { status.textContent = '無效的房間網址，請從 VIP 首頁建立房間。'; return; }
    const socket = io(window.LOTTERY_CONFIG.backendUrl);
    const clock = new window.LotteryClock.ServerClock();
    let activityId = null, participantId = null, dealer = false, joined = false, replaced = false;
    let state = null, buffered = null, generation = 0, recovery = null, registeredName = null;
    let storageUnavailable = false, pendingRemoval = null, namePending = false;
    const pendingReels = new Set();
    const pending = new Map();
    const envelope = data => ({ roomId, activityId, protocolVersion: P.VERSION, ...data });
    const errorText = error => { status.textContent = error.message || String(error); };
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
            status.textContent = message;
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
            el('slot-window').classList.add('winner-flash');
            setTimeout(() => el('slot-window').classList.remove('winner-flash'), 3000);
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
        recovery = (async () => {
            await syncClock();
            const result = await rpc('getSnapshot', envelope({}));
            if (!result?.success) throw Error(result?.message || '同步失敗，請重新整理。');
            applyBuffered(result.snapshot);
            render(); renderReels(true);
        })();
        try { await recovery; } finally { recovery = null; if (buffered) { const next = buffered; buffered = null; receive(next); } }
    }
    socket.on('connect', async () => {
        if (replaced) { socket.disconnect(); return; }
        const attempt = ++generation;
        joined = false; status.textContent = '正在加入房間…';
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
            applyBuffered(result.snapshot);
            render(); renderReels(true);
        } catch (error) { if (attempt === generation) { editor.disconnect(); errorText(error); } }
    });
    socket.on('updateRoomState', receive);
    socket.on('disconnect', () => {
        generation++; joined = false; buffered = null; pending.clear(); pendingReels.clear(); pendingRemoval = null; namePending = false;
        window.LOTTERY_HISTORY.stop(); editor.disconnect(); renderControls(); renderQueue();
        if (!replaced) status.textContent = '連線中斷，正在重新連線；已成立的回合仍由系統完成。';
    });
    socket.on('connect_error', () => { editor.disconnect(); status.textContent = '無法連線，正在重試…'; });
    for (const event of ['dealerReplaced', 'participantReplaced']) socket.on(event, data => {
        if (data?.activityId !== activityId) return;
        replaced = true;
        if (event === 'dealerReplaced') window.LOTTERY_ROOM_SESSION.remove(roomId);
        socket.disconnect(); status.textContent = '身分已在另一個分頁恢復，請使用最新的分頁。';
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
            lever.setAttribute('aria-disabled', String(!enabled));
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
        if ((me?.name || null) !== registeredName) input.value = me?.name || '';
        registeredName = me?.name || null;
        editor.update(state, dealer);
        el('prize-management').style.display = dealer ? 'block' : 'none';
        el('dealer-share-info').style.display = dealer ? 'block' : 'none';
        el('export-csv-btn').style.display = dealer ? 'inline-block' : 'none';
        window.LOTTERY_HISTORY.track(state, dealer);
        const head = state.queue[0], ahead = state.queue.indexOf(participantId);
        if (dealer) status.textContent = '這是莊家頁面，邀請玩家刷 QR Code 加入遊戲';
        else if (me?.removed) status.textContent = '觀看模式';
        else if (me?.completed) status.textContent = '您已完成抽獎。';
        else if (state.round?.playerId === participantId) status.textContent = '再次拉動旋轉中的拉桿即可煞停；操作逾期將由系統完成。';
        else if (head === participantId) status.textContent = me?.name ? `你好，${me.name}！請拉動拉桿！操作逾期將由系統完成。` : '輪到你了！請先輸入姓名！';
        else status.textContent = head ? `現在輪到 ${state.players[head]?.name || '下一位玩家'}...` + (ahead > 0 ? ` 再等 ${ahead} 人就輪到您了` : '') : '目前沒有等待中的玩家。';
        const indicator = el('current-player-indicator');
        indicator.textContent = state.round ? `${state.round.playerName} 正在抽獎` : '';
        indicator.style.display = state.round ? 'block' : 'none';
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
        namePending = true; status.textContent = '正在確認姓名…';
        try { await operation('setPlayerName', { name }); }
        catch (error) { if (actionGeneration === generation) { input.value = registeredName || ''; errorText(error); } }
        finally { if (actionGeneration === generation) namePending = false; }
    }
    input.addEventListener('change', submitName);
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); submitName(); }
    });
    for (const type of P.TYPES) el(type === 'prize' ? 'lever-left' : 'lever-right').addEventListener('click', async () => {
        const me = state?.players[participantId], round = state?.round;
        if (!joined || dealer || !me?.name || me.removed || me.completed || state.queue[0] !== participantId || pendingReels.has(type) || round?.reels[type]?.stop) return;
        const actionGeneration = generation;
        pendingReels.add(type); renderControls();
        try { await operation(round?.reels[type] ? 'stopReel' : 'startReel', { type, roundId: round?.id ?? null }); }
        catch (error) { if (actionGeneration === generation) errorText(error); }
        finally { if (actionGeneration === generation) { pendingReels.delete(type); renderControls(); } }
    });
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

(function () {
    'use strict';
    // sessionStorage survives reloads but does not grant another browser host access.
    const key = roomId => `lottery:dealer:${window.LOTTERY_CONFIG.backendUrl}:${roomId}`;
    window.LOTTERY_ROOM_SESSION = Object.freeze({
        read(roomId) {
            try { return window.sessionStorage.getItem(key(roomId)); }
            catch { return null; }
        },
        save(roomId, token) {
            if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return false;
            try {
                window.sessionStorage.setItem(key(roomId), token);
                return window.sessionStorage.getItem(key(roomId)) === token;
            } catch { return false; }
        },
        remove(roomId) {
            try { window.sessionStorage.removeItem(key(roomId)); }
            catch { /* The page can still stop reconnecting when storage is blocked. */ }
        }
    });
    const participantKey = roomId => `lottery:participant:${window.LOTTERY_CONFIG.backendUrl}:${roomId}`;
    const memory = new Map();
    function saveParticipant(roomId, session) {
        memory.set(roomId, session);
        try {
            const value = JSON.stringify(session);
            window.sessionStorage.setItem(participantKey(roomId), value);
            return window.sessionStorage.getItem(participantKey(roomId)) === value;
        } catch { return false; }
    }
    window.LOTTERY_PLAYER_SESSION = Object.freeze({
        prepare(roomId) {
            if (memory.has(roomId)) return memory.get(roomId);
            try {
                const raw = window.sessionStorage.getItem(participantKey(roomId));
                const saved = JSON.parse(raw);
                if (saved && typeof saved.token === 'string' && /^[a-f0-9]{64}$/.test(saved.token) && typeof saved.removed === 'boolean') {
                    memory.set(roomId, saved);
                    return saved;
                }
                // Damaged identity must not silently become a fresh place in the queue.
                if (raw !== null) return null;
                const bytes = window.crypto.getRandomValues(new Uint8Array(32));
                const session = { token: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''), removed: false };
                if (saveParticipant(roomId, session)) return session;
            } catch { /* Viewing still works when persistent tab identity is unavailable. */ }
            memory.delete(roomId);
            return null;
        },
        markRemoved(roomId) {
            const session = memory.get(roomId) || this.prepare(roomId);
            return session ? saveParticipant(roomId, { ...session, removed: true }) : false;
        }
    });
}());

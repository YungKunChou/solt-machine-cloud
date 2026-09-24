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
}());

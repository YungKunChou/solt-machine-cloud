(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LotterySettingsRules = factory();
}(typeof window === 'undefined' ? globalThis : window, function () {
    'use strict';
    const MAX_ROWS = 100;
    const MAX_NAME_LENGTH = 120;
    function validate(prizes, quantities) {
        const errors = [];
        const result = {};
        for (const [type, list] of [['prizes', prizes], ['quantities', quantities]]) {
            const label = type === 'prizes' ? '獎項' : '數量';
            if (!Array.isArray(list) || list.length < 1 || list.length > MAX_ROWS) {
                errors.push({ type, index: -1, message: `${label}須保留 1 至 ${MAX_ROWS} 筆。` });
                continue;
            }
            result[type] = list.map((item, index) => {
                const name = typeof item?.name === 'string' ? item.name.trim() : '';
                let message = '';
                if (type === 'prizes') {
                    if (!name || name.length > MAX_NAME_LENGTH) message = `獎項名稱須為 1 至 ${MAX_NAME_LENGTH} 個字。`;
                } else if (!/^\d+$/.test(name) || !Number.isSafeInteger(Number(name)) || Number(name) < 1) {
                    message = '請輸入大於 0 的整數。';
                }
                if (message) errors.push({ type, index, message });
                return { name: type === 'quantities' && !message ? String(Number(name)) : name };
            });
        }
        return { valid: errors.length === 0, errors, ...result };
    }
    return { validate, MAX_ROWS, MAX_NAME_LENGTH };
}));

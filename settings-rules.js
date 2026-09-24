(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LotterySettingsRules = factory();
}(typeof window === 'undefined' ? globalThis : window, function () {
    'use strict';
    const MAX_ROWS = 10;
    const MAX_NAME_LENGTH = 120;
    function defaults() {
        return {
            prizes: ['大杯美式咖啡', '特大美式咖啡', '大杯拿鐵咖啡', '特大拿鐵咖啡', '星巴克焦糖瑪奇朵'].map(name => ({ name })),
            quantities: ['1', '2', '3'].map(name => ({ name }))
        };
    }
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
                if (item?.optionId !== undefined && (typeof item.optionId !== 'string' || !item.optionId)) {
                    errors.push({ type, index, message: '選項識別無效，請重新載入設定。' });
                }
                if (type === 'prizes') {
                    if (!name || name.length > MAX_NAME_LENGTH) message = `獎項名稱須為 1 至 ${MAX_NAME_LENGTH} 個字。`;
                } else if (!/^\d+$/.test(name) || !Number.isSafeInteger(Number(name)) || Number(name) < 1) {
                    message = '請輸入大於 0 的整數。';
                }
                if (message) errors.push({ type, index, message });
                return { ...(typeof item?.optionId === 'string' ? { optionId: item.optionId } : {}),
                    name: type === 'quantities' && !message ? String(Number(name)) : name };
            });
        }
        return { valid: errors.length === 0, errors, ...result };
    }
    return { validate, defaults, MAX_ROWS, MAX_NAME_LENGTH };
}));

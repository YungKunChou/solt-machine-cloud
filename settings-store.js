(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./settings-rules.js'));
    else root.LotterySettingsStore = factory(root.LotterySettingsRules);
}(typeof window === 'undefined' ? globalThis : window, function (rules) {
    'use strict';
    function clean(settings) {
        const checked = rules.validate(settings?.prizes, settings?.quantities);
        if (!checked.valid) throw Error('獎項與數量設定不完整，無法保存。');
        // Activity option IDs are never reused by a newly created room.
        return { prizes: checked.prizes.map(({ name }) => ({ name })), quantities: checked.quantities.map(({ name }) => ({ name })) };
    }
    function create(storage, backendUrl) {
        const key = 'lottery:settings:' + backendUrl;
        return {
            key,
            read() {
                try {
                    const saved = JSON.parse(storage().getItem(key));
                    return saved?.version === 1 ? clean(saved) : null;
                } catch { return null; }
            },
            save(settings) {
                const value = JSON.stringify({ version: 1, ...clean(settings) });
                const target = storage();
                target.setItem(key, value);
                if (target.getItem(key) !== value) throw Error('瀏覽器未能保存設定。');
            }
        };
    }
    return { create };
}));

(function () {
    'use strict';
    const hostname = window.location.hostname;
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
    window.LOTTERY_CONFIG = Object.freeze({
        backendUrl: isLocal
            ? 'http://127.0.0.1:3001'
            : 'https://solt-machine.onrender.com'
    });
}());

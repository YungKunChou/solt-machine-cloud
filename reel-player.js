(function () {
    'use strict';
    const Motion = window.LotteryMotion;
    // Every role uses the same bounded node pool and server-time position function.
    window.createLotteryReelPlayer = function (root, type, clock, onError, onPhase = () => {}) {
        let plan = null, order = [], frame = null, height = 1, center = 0, ready = false;
        let lastPosition = 0, lastPlanId = null, lastPhase = null, idlePosition = 0;
        const fits = new Map();
        const nodes = Array.from({ length: 9 }, () => {
            const item = document.createElement('div');
            item.className = 'reel-item' + (type === 'quantity' ? ' quantity-item' : '');
            item.style.position = 'absolute';
            item.style.overflow = 'hidden';
            const text = document.createElement('span');
            text.style.cssText = 'display:block;width:100%;overflow-wrap:anywhere;line-height:1.15;';
            if (type === 'quantity') text.style.textAlign = 'center';
            item.append(text); root.append(item);
            return item;
        });
        function measure() {
            const rect = nodes[0].getBoundingClientRect();
            height = rect.height;
            center = root.parentElement.clientHeight / 2;
            ready = height > 0 && center > 0;
            // Long names shrink inside the fixed-height cell; they never alter the path.
            for (const node of nodes) {
                const text = node.firstElementChild;
                const base = parseFloat(getComputedStyle(node).fontSize);
                const key = [height, rect.width, base, node.dataset.optionId].join(':');
                if (fits.has(key)) { text.style.fontSize = fits.get(key) + 'px'; continue; }
                text.style.fontSize = '';
                let size = base;
                while (size > 1 && text.scrollHeight > height - 6) {
                    size -= 1; text.style.fontSize = size + 'px';
                }
                fits.set(key, size);
            }
        }
        function paint() {
            if (!ready || !order.length) return;
            const time = clock.now();
            const phase = Motion.phase(plan, time);
            if (phase !== lastPhase) { lastPhase = phase; onPhase(phase); }
            const q = plan ? Motion.position(plan, time) : idlePosition;
            if (!Number.isFinite(q)) { onError('滾輪播放資料異常，正在重新同步。'); return; }
            lastPosition = q;
            const base = Math.floor(q);
            let labelsChanged = false;
            nodes.forEach((node, i) => {
                const logical = base + i - 4;
                const option = order[Motion.mod(logical, order.length)];
                if (node.dataset.optionId !== option.optionId || node.firstElementChild.textContent !== option.name) {
                    node.dataset.optionId = option.optionId;
                    node.firstElementChild.textContent = option.name;
                    node.title = option.name;
                    labelsChanged = true;
                }
                node.style.transform = `translateY(${center - height / 2 + (logical - q) * height}px)`;
            });
            if (labelsChanged) measure();
            if (plan?.stop && time >= plan.stop.stopAt) {
                // Verify identity and logical center; never replace the winner text to hide an error.
                const actual = order[Motion.mod(Math.round(q), order.length)];
                if (actual.optionId !== plan.stop.optionId || Math.abs(q - plan.stop.target) > 1e-7) {
                    onError('停止位置核對失敗，正在重新同步。');
                }
            }
        }
        function tick() {
            frame = null;
            paint();
            if (plan && (!plan.stop || clock.now() < plan.stop.stopAt)) frame = requestAnimationFrame(tick);
        }
        function restart() {
            if (frame !== null) cancelAnimationFrame(frame);
            frame = null; measure(); tick();
        }
        const observer = new ResizeObserver(() => { measure(); paint(); });
        observer.observe(root.parentElement);
        return {
            update(next, fallback, initialPosition = 0) {
                const same = next && lastPlanId === next.planId;
                if (same && plan && next.planVersion < plan.planVersion) return;
                if (lastPlanId !== next?.planId) fits.clear();
                plan = next; order = next ? next.order : fallback;
                idlePosition = initialPosition;
                lastPlanId = next?.planId || null;
                root.style.transition = 'none'; root.style.transform = 'none';
                restart();
            },
            refresh: restart,
            position: () => lastPosition,
            dispose() { if (frame !== null) cancelAnimationFrame(frame); observer.disconnect(); }
        };
    };
}());

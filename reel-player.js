(function () {
    'use strict';
    const Motion = window.LotteryMotion;
    // Every role uses the same bounded node pool and server-time position function.
    window.createLotteryReelPlayer = function (root, type, clock, onError, onPhase = () => {}) {
        let plan = null, order = [], frame = null, height = 1, center = 0, ready = false;
        let lastPosition = 0, lastPlanId = null, lastPhase = null, idlePosition = 0;
        const fits = new Map();
        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        const nodes = Array.from({ length: 9 }, () => {
            const item = document.createElement('div');
            item.className = 'reel-item' + (type === 'quantity' ? ' quantity-item' : '');
            item.style.position = 'absolute';
            item.style.overflow = 'hidden';
            const text = document.createElement('span');
            text.className = 'reel-label';
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
            // Presentation only: never change the server-time position or measured cell.
            // Blur follows current velocity, not a generic "spinning" flag, so late
            // joins, braking, resize and the final stopped frame all stay consistent.
            const speed = plan ? Math.abs(Motion.velocity(plan, time)) : 0;
            const speedRatio = plan?.speed > 0 ? Math.min(1, speed / plan.speed) : 0;
            const motionBlur = reducedMotion?.matches ? 0
                : Math.min(1.2, height * .009) * Math.pow(speedRatio, 1.4);
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
                const offset = (logical - q) * height;
                node.style.transform = `translateY(${center - height / 2 + offset}px)`;
                const text = node.firstElementChild;
                const edge = Math.min(1, Math.max(0, (Math.abs(offset) / center - .2) / .8));
                const curve = reducedMotion?.matches ? 0 : edge * edge * (3 - 2 * edge);
                const visible = Math.abs(offset) < center + height / 2;
                const blur = visible ? motionBlur * (.65 + .35 * curve) : 0;
                text.style.transform = `scaleY(${(1 - .45 * curve).toFixed(4)})`;
                text.style.opacity = (1 - .28 * curve).toFixed(4);
                text.style.filter = [curve > 0 ? `brightness(${(1 - .18 * curve).toFixed(4)})` : '',
                    blur >= .01 ? `blur(${blur.toFixed(3)}px)` : ''].filter(Boolean).join(' ') || 'none';
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
        const refreshEffects = () => paint();
        reducedMotion?.addEventListener('change', refreshEffects);
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
            dispose() {
                if (frame !== null) cancelAnimationFrame(frame);
                observer.disconnect();
                reducedMotion?.removeEventListener('change', refreshEffects);
            }
        };
    };
}());

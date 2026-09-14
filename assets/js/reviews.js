(function () {
    const API = '/api/reviews.php';
    const AVATAR_COUNT = 20;
    const AVATAR_PATH = '/assets/img/avatar/';
    const LIMIT = 9;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const STAR_POINTS = '12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26';
    const RETRY_ERRORS = new Set(['token_invalid', 'timing', 'expired']);
    const FETCH_HEADERS = { 'X-Requested-With': 'fetch' };

    let formToken = '';
    let currentOffset = 0;
    let totalReviews = 0;

    const fadeObserver = new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (e.isIntersecting) { e.target.classList.add('visible'); fadeObserver.unobserve(e.target); }
        });
    }, { threshold: 0.1 });

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    /* ---------- построение DOM без innerHTML: текст отзывов никогда не трактуется как HTML ---------- */

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function starNode(on) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', on ? 'star star--on' : 'star');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        const poly = document.createElementNS(SVG_NS, 'polygon');
        poly.setAttribute('points', STAR_POINTS);
        svg.appendChild(poly);
        return svg;
    }

    function starsFragment(count) {
        const frag = document.createDocumentFragment();
        for (let i = 1; i <= 5; i++) frag.appendChild(starNode(i <= count));
        return frag;
    }

    function initials(name) {
        const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
        return parts.map(w => w[0].toUpperCase()).join('') || '•';
    }

    function avatarNode(avatar, name) {
        if (avatar && /^avatar\d{2}\.png$/.test(avatar)) {
            const img = el('img', 'review-avatar');
            img.src = AVATAR_PATH + avatar;
            img.alt = '';
            img.loading = 'lazy';
            return img;
        }
        return el('div', 'review-avatar review-avatar--initials', initials(name));
    }

    function cardNode(r) {
        const card = el('div', 'review-card fade-up');

        const head = el('div', 'review-card__head');
        head.appendChild(avatarNode(r.avatar, r.name));

        const meta = el('div', 'review-card__meta');
        meta.appendChild(el('span', 'review-card__name', r.name));
        const stars = el('span', 'review-card__stars');
        stars.appendChild(starsFragment(Number(r.stars) || 0));
        meta.appendChild(stars);
        head.appendChild(meta);

        head.appendChild(el('span', 'review-card__date muted', r.date));
        card.appendChild(head);

        card.appendChild(el('p', 'review-card__text', r.text));

        const more = el('button', 'review-card__more', 'Читать далее');
        more.type = 'button';
        more.hidden = true;
        card.appendChild(more);
        return card;
    }

    function checkClamped(list) {
        list.querySelectorAll('.review-card').forEach(card => {
            const text = card.querySelector('.review-card__text');
            const btn  = card.querySelector('.review-card__more');
            if (btn && text && text.scrollHeight > text.clientHeight + 2) btn.hidden = false;
        });
    }

    function updateMoreBtn() {
        const wrap = document.getElementById('reviewsMore');
        const btn  = document.getElementById('loadMoreBtn');
        if (!wrap || !btn) return;
        const remaining = totalReviews - currentOffset;
        if (remaining > 0) {
            btn.textContent = `Загрузить ещё (${remaining})`;
            wrap.hidden = false;
        } else {
            wrap.hidden = true;
        }
    }

    function plural(n, one, few, many) {
        const m10 = n % 10, m100 = n % 100;
        if (m10 === 1 && m100 !== 11) return one;
        if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
        return many;
    }

    function renderSummary(total, avg) {
        const wrap = document.getElementById('reviewsSummary');
        if (!wrap) return;
        if (!total) { wrap.hidden = true; return; }
        document.getElementById('summaryScore').textContent = Number(avg).toFixed(1);
        document.getElementById('summaryStars').replaceChildren(starsFragment(Math.round(avg)));
        document.getElementById('summaryCount').textContent = `${total} ${plural(total, 'отзыв', 'отзыва', 'отзывов')}`;
        wrap.hidden = false;
    }

    function renderEmpty(list) {
        list.replaceChildren(el('p', 'muted reviews-empty', 'Пока отзывов нет. Будьте первым!'));
    }

    function renderReviews(data, append) {
        const list = document.getElementById('reviewsList');
        const reviews = Array.isArray(data.reviews) ? data.reviews : [];
        totalReviews  = Number(data.total) || 0;
        currentOffset = (Number(data.offset) || 0) + reviews.length;
        if (!append) renderSummary(totalReviews, Number(data.avg_stars) || 0);

        if (!append && !reviews.length) {
            renderEmpty(list);
            updateMoreBtn();
            return;
        }

        if (!append) list.replaceChildren();
        const frag = document.createDocumentFragment();
        reviews.forEach(r => frag.appendChild(cardNode(r)));
        list.appendChild(frag);
        list.querySelectorAll('.review-card:not(.visible)').forEach(node => fadeObserver.observe(node));
        checkClamped(list);
        updateMoreBtn();
    }

    async function loadReviews(offset = 0, append = false) {
        const list = document.getElementById('reviewsList');
        if (!list) return;
        try {
            const res = await fetch(`${API}?offset=${offset}`, { headers: FETCH_HEADERS, credentials: 'same-origin' });
            if (!res.ok) throw new Error('http ' + res.status);
            const data = await res.json();
            if (data && data.token) formToken = data.token;
            renderReviews(data, append);
        } catch (err) {
            if (!append) renderEmpty(list);
        }
    }

    async function refreshToken() {
        try {
            const res = await fetch(`${API}?action=token`, { headers: FETCH_HEADERS, credentials: 'same-origin' });
            const data = await res.json();
            if (data && data.token) formToken = data.token;
        } catch (err) { /* обработается при отправке */ }
        return Boolean(formToken);
    }

    async function postReview(payload) {
        const res = await fetch(API, {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, FETCH_HEADERS),
            credentials: 'same-origin',
            body: JSON.stringify(payload),
        });
        try {
            return await res.json();
        } catch (err) {
            return { ok: false, error: 'network' };
        }
    }

    function initLoadMore() {
        const btn = document.getElementById('loadMoreBtn');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            try { await loadReviews(currentOffset, true); } finally { btn.disabled = false; }
        });
    }

    function initAvatarPicker() {
        const picker = document.getElementById('avatarPicker');
        if (!picker) return;

        const noneBtn = el('button', 'avatar-pick-btn is-selected');
        noneBtn.type = 'button';
        noneBtn.dataset.avatar = '';
        noneBtn.setAttribute('aria-label', 'Без аватарки');
        noneBtn.title = 'Без аватарки';
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.4');
        svg.setAttribute('stroke-linecap', 'round');
        const circle = document.createElementNS(SVG_NS, 'circle');
        circle.setAttribute('cx', '12'); circle.setAttribute('cy', '8'); circle.setAttribute('r', '4');
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', 'M4 20c0-4 3.6-7 8-7s8 3 8 7');
        svg.append(circle, path);
        noneBtn.appendChild(svg);
        picker.appendChild(noneBtn);

        for (let i = 1; i <= AVATAR_COUNT; i++) {
            const file = 'avatar' + String(i).padStart(2, '0') + '.png';
            const btn = el('button', 'avatar-pick-btn');
            btn.type = 'button';
            btn.dataset.avatar = file;
            btn.setAttribute('aria-label', `Аватарка ${i}`);
            const img = el('img');
            img.src = AVATAR_PATH + file;
            img.alt = '';
            img.loading = 'lazy';
            btn.appendChild(img);
            picker.appendChild(btn);
        }

        picker.dataset.value = '';
        picker.addEventListener('click', e => {
            const btn = e.target.closest('.avatar-pick-btn');
            if (!btn) return;
            picker.querySelectorAll('.avatar-pick-btn').forEach(b => b.classList.remove('is-selected'));
            btn.classList.add('is-selected');
            picker.dataset.value = btn.dataset.avatar;
        });
    }

    function initStarPicker() {
        const picker = document.getElementById('starPicker');
        if (!picker) return;

        let selected = 0;
        for (let i = 1; i <= 5; i++) {
            const btn = el('button', 'star-pick-btn');
            btn.type = 'button';
            btn.dataset.val = String(i);
            btn.setAttribute('aria-label', `${i} ${plural(i, 'звезда', 'звезды', 'звёзд')}`);
            btn.appendChild(starNode(false));
            picker.appendChild(btn);
        }

        function highlight(upTo) {
            picker.querySelectorAll('.star-pick-btn .star').forEach((s, idx) => {
                s.classList.toggle('star--on', idx < upTo);
            });
        }

        picker.addEventListener('mouseover', e => {
            const btn = e.target.closest('.star-pick-btn');
            if (btn) highlight(+btn.dataset.val);
        });
        picker.addEventListener('mouseleave', () => highlight(selected));
        picker.addEventListener('click', e => {
            const btn = e.target.closest('.star-pick-btn');
            if (!btn) return;
            selected = +btn.dataset.val;
            highlight(selected);
            picker.dataset.value = String(selected);
        });
    }

    function resetForm() {
        const ap = document.getElementById('avatarPicker');
        ap.dataset.value = '';
        ap.querySelectorAll('.avatar-pick-btn').forEach(b => b.classList.remove('is-selected'));
        const none = ap.querySelector('[data-avatar=""]');
        if (none) none.classList.add('is-selected');

        const sp = document.getElementById('starPicker');
        sp.dataset.value = '';
        sp.querySelectorAll('.star').forEach(s => s.classList.remove('star--on'));

        document.getElementById('reviewName').value = '';
        const ta = document.getElementById('reviewText');
        ta.value = '';
        ta.style.height = '';
    }

    function showMsg(node, text, type, duration = 4000) {
        node.textContent = text;
        node.className = 'review-msg review-msg--' + type;
        node.hidden = false;
        clearTimeout(node._hideTimer);
        node._hideTimer = setTimeout(() => { node.hidden = true; }, duration);
    }

    function initForm() {
        const form = document.getElementById('reviewForm');
        if (!form) return;

        const ta = document.getElementById('reviewText');
        ta.addEventListener('input', () => {
            ta.style.height = 'auto';
            ta.style.height = ta.scrollHeight + 'px';
        });

        form.addEventListener('submit', async e => {
            e.preventDefault();
            const msg    = document.getElementById('reviewMsg');
            const btn    = form.querySelector('[type=submit]');
            const stars  = +(document.getElementById('starPicker').dataset.value || 0);
            const avatar = document.getElementById('avatarPicker').dataset.value || '';
            const name   = document.getElementById('reviewName').value.trim();
            const text   = document.getElementById('reviewText').value.trim();
            const honey  = form.querySelector('[name=website]').value;

            if (name.length < 2)  { showMsg(msg, 'Укажите имя', 'error'); return; }
            if (!stars)           { showMsg(msg, 'Выберите оценку в звёздах', 'error'); return; }
            if (text.length < 10) { showMsg(msg, 'Напишите чуть подробнее, минимум 10 символов', 'error'); return; }

            btn.disabled = true;
            btn.textContent = 'Отправляю...';

            const payload = () => ({ name, stars, text, avatar, website: honey, token: formToken });

            try {
                if (!formToken && await refreshToken()) await sleep(3200);
                let data = await postReview(payload());
                // Токен устарел или ещё «слишком свежий»: берём новый, выжидаем и повторяем один раз.
                if (!data.ok && RETRY_ERRORS.has(data.error) && await refreshToken()) {
                    await sleep(3200);
                    data = await postReview(payload());
                }

                if (data.ok) {
                    showMsg(msg, data.message || 'Спасибо! Отзыв появится на сайте после проверки', 'ok', 8000);
                    resetForm();
                } else {
                    showMsg(msg, data.message || 'Ошибка, попробуйте позже', 'error', 6000);
                }
            } catch (err) {
                showMsg(msg, 'Ошибка соединения', 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Отправить';
            }
        });
    }

    function initExpandButtons() {
        const list = document.getElementById('reviewsList');
        if (!list) return;
        list.addEventListener('click', e => {
            const btn = e.target.closest('.review-card__more');
            if (!btn) return;
            const text = btn.previousElementSibling;
            if (text) text.classList.add('is-expanded');
            btn.remove();
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        loadReviews(0, false);
        initLoadMore();
        initAvatarPicker();
        initStarPicker();
        initForm();
        initExpandButtons();
    });
})();

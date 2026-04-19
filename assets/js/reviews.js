(function () {
    const API = '/api/reviews.php';
    const PAGE_LOADED = Date.now();
    const AVATAR_COUNT = 20;
    const AVATAR_PATH = '/assets/img/avatar/';
    const LIMIT = 9;

    const fadeObserver = new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (e.isIntersecting) { e.target.classList.add('visible'); fadeObserver.unobserve(e.target); }
        });
    }, { threshold: 0.1 });

    let currentOffset = 0;
    let totalReviews = 0;

    function initials(name) {
        return name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    }

    function starsHtml(count) {
        let out = '';
        for (let i = 1; i <= 5; i++) {
            out += `<svg class="star${i <= count ? ' star--on' : ''}" viewBox="0 0 24 24" aria-hidden="true">
                <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
            </svg>`;
        }
        return out;
    }

    function avatarHtml(avatar, name) {
        if (avatar) {
            return `<img class="review-avatar" src="${AVATAR_PATH}${avatar}" alt="" loading="lazy">`;
        }
        return `<div class="review-avatar review-avatar--initials">${initials(name)}</div>`;
    }

    function cardHtml(r) {
        return `<div class="review-card fade-up">
            <div class="review-card__head">
                ${avatarHtml(r.avatar, r.name)}
                <div class="review-card__meta">
                    <span class="review-card__name">${r.name}</span>
                    <span class="review-card__stars">${starsHtml(r.stars)}</span>
                </div>
                <span class="review-card__date muted">${r.date}</span>
            </div>
            <p class="review-card__text">${r.text}</p>
            <button class="review-card__more" type="button" hidden>Читать далее</button>
        </div>`;
    }

    function checkClamped(list) {
        list.querySelectorAll('.review-card').forEach(card => {
            const text = card.querySelector('.review-card__text');
            const btn  = card.querySelector('.review-card__more');
            if (btn && text.scrollHeight > text.clientHeight + 2) {
                btn.hidden = false;
            }
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

    function renderSummary(total, avg) {
        const wrap  = document.getElementById('reviewsSummary');
        if (!wrap || !total) return;
        document.getElementById('summaryScore').textContent = avg.toFixed(1);
        document.getElementById('summaryStars').innerHTML = starsHtml(Math.round(avg));
        document.getElementById('summaryCount').textContent = `${total} ${
            total % 10 === 1 && total % 100 !== 11 ? 'отзыв' :
            [2,3,4].includes(total % 10) && ![12,13,14].includes(total % 100) ? 'отзыва' : 'отзывов'
        }`;
        wrap.hidden = false;
    }

    function renderReviews(data, append) {
        const list = document.getElementById('reviewsList');
        const reviews = data.reviews || [];
        totalReviews  = data.total || 0;
        currentOffset = (data.offset || 0) + reviews.length;
        if (!append) renderSummary(totalReviews, data.avg_stars || 0);

        if (!append && !reviews.length) {
            list.innerHTML = '<p class="muted reviews-empty">Пока отзывов нет - будьте первым!</p>';
            updateMoreBtn();
            return;
        }

        if (!append) list.innerHTML = '';
        list.insertAdjacentHTML('beforeend', reviews.map(cardHtml).join(''));
        list.querySelectorAll('.review-card:not(.visible)').forEach(el => fadeObserver.observe(el));
        checkClamped(list);
        updateMoreBtn();
    }

    function loadReviews(offset = 0, append = false) {
        const list = document.getElementById('reviewsList');
        if (!list) return;

        fetch(`${API}?offset=${offset}&limit=${LIMIT}`)
            .then(r => { if (!r.ok) throw new Error(); return r.json(); })
            .then(data => renderReviews(data, append))
            .catch(() => {
                if (!append) list.innerHTML = '<p class="muted reviews-empty">Пока отзывов нет - будьте первым!</p>';
            });
    }

    function initLoadMore() {
        const btn = document.getElementById('loadMoreBtn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            btn.disabled = true;
            loadReviews(currentOffset, true);
            btn.disabled = false;
        });
    }

    function initAvatarPicker() {
        const picker = document.getElementById('avatarPicker');
        if (!picker) return;

        const noneBtn = document.createElement('button');
        noneBtn.type = 'button';
        noneBtn.className = 'avatar-pick-btn is-selected';
        noneBtn.dataset.avatar = '';
        noneBtn.setAttribute('aria-label', 'Без аватарки');
        noneBtn.setAttribute('title', 'Без аватарки');
        noneBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
        </svg>`;
        picker.appendChild(noneBtn);

        for (let i = 1; i <= AVATAR_COUNT; i++) {
            const file = 'avatar' + String(i).padStart(2, '0') + '.png';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'avatar-pick-btn';
            btn.dataset.avatar = file;
            btn.setAttribute('aria-label', `Аватарка ${i}`);
            btn.innerHTML = `<img src="${AVATAR_PATH}${file}" alt="" loading="lazy">`;
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
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'star-pick-btn';
            btn.dataset.val = i;
            btn.setAttribute('aria-label', `${i} звезд`);
            btn.innerHTML = `<svg class="star" viewBox="0 0 24 24" aria-hidden="true">
                <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
            </svg>`;
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
            picker.dataset.value = selected;
        });
    }

    function resetForm() {
        const ap = document.getElementById('avatarPicker');
        ap.dataset.value = '';
        ap.querySelectorAll('.avatar-pick-btn').forEach(b => b.classList.remove('is-selected'));
        ap.querySelector('[data-avatar=""]').classList.add('is-selected');

        const sp = document.getElementById('starPicker');
        sp.dataset.value = '';
        sp.querySelectorAll('.star').forEach(s => s.classList.remove('star--on'));

        document.getElementById('reviewName').value = '';
        document.getElementById('reviewText').value = '';
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
            const msg   = document.getElementById('reviewMsg');
            const btn   = form.querySelector('[type=submit]');
            const stars = +(document.getElementById('starPicker').dataset.value || 0);
            const avatar = document.getElementById('avatarPicker').dataset.value || '';
            const name  = document.getElementById('reviewName').value.trim();
            const text  = document.getElementById('reviewText').value.trim();
            const honey = form.querySelector('[name=website]').value;

            if (!stars) { showMsg(msg, 'Выберите оценку в звёздах', 'error'); return; }

            btn.disabled = true;
            btn.textContent = 'Отправляю...';

            try {
                const res = await fetch(API, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, stars, text, avatar, website: honey, loadedAt: PAGE_LOADED }),
                });
                const data = await res.json();

                if (data.ok) {
                    showMsg(msg, 'Спасибо за отзыв!', 'ok');
                    resetForm();
                    currentOffset = 0;
                    loadReviews(0, false);
                } else {
                    showMsg(msg, data.message || 'Ошибка, попробуйте позже', 'error');
                }
            } catch {
                showMsg(msg, 'Ошибка соединения', 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Отправить';
            }
        });
    }

    function showMsg(el, text, type) {
        el.textContent = text;
        el.className = 'review-msg review-msg--' + type;
        el.hidden = false;
        setTimeout(() => { el.hidden = true; }, 4000);
    }

    function initExpandButtons() {
        document.getElementById('reviewsList').addEventListener('click', e => {
            const btn = e.target.closest('.review-card__more');
            if (!btn) return;
            const text = btn.previousElementSibling;
            text.classList.add('is-expanded');
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

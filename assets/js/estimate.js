/**
 * Оценка сроков по принципу треугольника компромисса: быстро / качественно / дёшево.
 * Пользователь двигает два ползунка (срочность и глубина проработки), уровень стоимости
 * (Бюджетно / Оптимально / Премиум) считается автоматически по матрице. Сложность изделия
 * задаётся кнопками и влияет только на срок.
 * Все ориентиры и тексты в ESTIMATE: правьте здесь, код трогать не нужно. Цен нет намеренно.
 */
const ESTIMATE = {
  complexity: [
    { label: "Деталь", days: [2, 4], hint: "Одна деталь: 3D-модель и рабочий чертёж с допусками и посадками.", docs: [] },
    { label: "Сборка", days: [6, 12], hint: "Узел из нескольких деталей: сборочный чертёж и деталировка.", docs: ["Сборочный чертёж и деталировка"] },
    { label: "Комплект", days: [12, 25], hint: "Изделие целиком: несколько узлов и полный комплект КД.", docs: ["Сборочные чертежи узлов и деталировка"] },
  ],
  urgency: [
    { label: "Обычный", factor: 1, hint: "Спокойный ритм: этапы и дедлайны фиксируем заранее." },
    { label: "Ускоренный", factor: 0.7, hint: "Приоритет в очереди, согласования каждые один-два дня." },
    { label: "Срочно", factor: 0.5, hint: "Работа без очереди и ежедневные согласования." },
  ],
  depth: [
    { label: "Базовый", factor: 1, hint: "3D-модель и рабочие чертежи по ЕСКД.", docs: ["3D-модель (STEP / STL)", "Рабочие чертежи по ЕСКД"] },
    { label: "Расширенный", factor: 1.3, hint: "Плюс спецификация, файлы для производства и помощь с ТЗ.", docs: ["Спецификация", "DXF / STEP для производства", "Помощь с ТЗ"] },
    { label: "Максимальный", factor: 1.7, hint: "Плюс паспорт, руководство по эксплуатации и ведомость ЗИП.", docs: ["Паспорт (ПС)", "Руководство по эксплуатации (РЭ)", "Ведомость ЗИП"] },
  ],
  // уровень по матрице: строки — срочность, столбцы — глубина проработки
  matrix: [
    ["budget", "optimal", "optimal"],
    ["optimal", "optimal", "premium"],
    ["optimal", "premium", "premium"],
  ],
  levels: {
    budget: { name: "Бюджетно", cheap: 1, desc: "Обычный срок и базовый комплект: самый экономный вариант для типовых деталей." },
    optimal: { name: "Оптимально", cheap: 0.5, desc: "Баланс сроков и глубины проработки. Подходит большинству проектов." },
    premium: { name: "Премиум", cheap: 0, desc: "Быстро и по максимуму: приоритет в очереди, ежедневные согласования." },
  },
  // подсказки-связки: показываются на крайних положениях под соседним ползунком
  links: [
    { u: [2], q: [0], under: "depth", text: "Быстро и экономно: это «Оптимально». Любой комплект глубже при срочном сроке переводит в «Премиум»." },
    { u: [2], q: [1, 2], under: "depth", text: "Быстро и глубоко: это «Премиум». Чтобы остаться в «Оптимально», снимите срочность или оставьте базовый комплект." },
    { u: [0], q: [2], under: "urgency", text: "Полный комплект в обычном ритме: «Оптимально». Любое ускорение переводит в «Премиум»." },
    { u: [1], q: [2], under: "urgency", text: "Полный комплект с ускорением: это «Премиум». В обычном ритме тот же комплект остаётся «Оптимально»." },
    { u: [0], q: [0], under: "urgency", text: "Самый экономный вариант: «Бюджетно». Расширенный комплект или ускорение переведут в «Оптимально»." },
  ],
};

const CONTACTS = {
  telegram: "Konstruktor_Mikhail",
  whatsapp: "79515256278",
  email: "vovrenyuk_work@rambler.ru",
};

// вершины треугольника в координатах SVG (см. viewBox в разметке)
const TRI = { fast: [75, 22], quality: [138, 96], cheap: [12, 96] };

export function initEstimate() {
  const root = document.getElementById("estimate");
  if (!root) return;

  const $ = id => document.getElementById(id);
  const seg = $("estComplexity");
  const sliders = {
    urgency: { input: $("estUrgency"), value: $("estUrgencyValue"), hint: $("estUrgencyHint"), ticks: $("estUrgencyTicks"), link: $("estUrgencyLink") },
    depth:   { input: $("estDepth"),   value: $("estDepthValue"),   hint: $("estDepthHint"),   ticks: $("estDepthTicks"),   link: $("estDepthLink") },
  };
  const out = {
    days: $("estDays"), daysUnit: $("estDaysUnit"), level: $("estLevel"), levelName: $("estLevelName"), levelDesc: $("estLevelDesc"),
    docs: $("estDocs"), telegram: $("estTelegram"), whatsapp: $("estWhatsApp"), email: $("estEmail"), copy: $("estCopy"),
    complexityHint: $("estComplexityHint"),
    triDot: $("estTriDot"), triLabels: { fast: $("estTriFast"), quality: $("estTriQuality"), cheap: $("estTriCheap") },
  };
  if (!seg || !sliders.urgency.input || !sliders.depth.input) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let complexity = Number(seg.querySelector(".is-active")?.dataset.value ?? 1);
  let shown = { min: 0, max: 0 };
  let anim = null;

  const u = () => Number(sliders.urgency.input.value);
  const q = () => Number(sliders.depth.input.value);

  // «21 рабочий день», «2–4 рабочих дня», «8–16 рабочих дней»: согласуем с последним числом
  function daysUnit(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return "рабочий день";
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "рабочих дня";
    return "рабочих дней";
  }

  function compute() {
    const c = ESTIMATE.complexity[complexity];
    const ur = ESTIMATE.urgency[u()];
    const d = ESTIMATE.depth[q()];
    const f = d.factor * ur.factor;
    const min = Math.max(1, Math.round(c.days[0] * f));
    const max = Math.max(min + 1, Math.round(c.days[1] * f));
    const levelKey = ESTIMATE.matrix[u()][q()];
    const level = { key: levelKey, ...ESTIMATE.levels[levelKey] };
    const docs = ESTIMATE.depth.slice(0, q() + 1).flatMap(x => x.docs).concat(c.docs);
    const link = ESTIMATE.links.find(l => l.u.includes(u()) && l.q.includes(q())) || null;
    return { c, ur, d, min, max, level, docs, link };
  }

  function animateDays(min, max) {
    const text = (a, b) => `${a}–${b}`;
    if (anim) cancelAnimationFrame(anim);
    if (reduced || (shown.min === 0 && shown.max === 0)) {
      shown = { min, max };
      out.days.textContent = text(min, max);
      return;
    }
    const from = { ...shown };
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / 320);
      const e = 1 - Math.pow(1 - k, 3);
      out.days.textContent = text(Math.round(from.min + (min - from.min) * e), Math.round(from.max + (max - from.max) * e));
      if (k < 1) anim = requestAnimationFrame(step);
      else { shown = { min, max }; anim = null; }
    };
    anim = requestAnimationFrame(step);
  }

  // точка внутри треугольника: барицентрическое среднее по трём «сколько выбрали»
  function renderTriangle(level) {
    const scores = { fast: u() / 2, quality: q() / 2, cheap: level.cheap };
    const sum = scores.fast + scores.quality + scores.cheap || 1;
    const x = (scores.fast * TRI.fast[0] + scores.quality * TRI.quality[0] + scores.cheap * TRI.cheap[0]) / sum;
    const y = (scores.fast * TRI.fast[1] + scores.quality * TRI.quality[1] + scores.cheap * TRI.cheap[1]) / sum;
    if (out.triDot) out.triDot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    const minKey = Object.keys(scores).reduce((a, b) => (scores[b] < scores[a] ? b : a));
    for (const [key, node] of Object.entries(out.triLabels)) {
      if (!node) continue;
      node.style.opacity = String(0.4 + 0.6 * scores[key]);
      node.classList.toggle("is-sacrificed", key === minKey && scores[key] < 0.5);
    }
  }

  function messageText(r) {
    return [
      "Расчёт с сайта VovrenyukTechDraft",
      `Изделие: ${r.c.label}`,
      `Проработка: ${r.d.label} (${r.docs.join(", ")})`,
      `Срочность: ${r.ur.label}`,
      `Ориентир: ${r.min}–${r.max} ${daysUnit(r.max)}, уровень «${r.level.name}»`,
      "",
      "Описание задачи: ",
    ].join("\n");
  }

  function render() {
    const r = compute();

    seg.querySelectorAll(".est-seg__btn").forEach(b => {
      const on = Number(b.dataset.value) === complexity;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    if (out.complexityHint) out.complexityHint.textContent = r.c.hint;

    for (const [key, f] of Object.entries(sliders)) {
      const opt = ESTIMATE[key][Number(f.input.value)];
      if (f.value) f.value.textContent = opt.label;
      if (f.hint) f.hint.textContent = opt.hint;
      if (f.ticks) Array.from(f.ticks.children).forEach((t, i) => t.classList.toggle("is-active", i === Number(f.input.value)));
      f.input.setAttribute("aria-valuetext", opt.label);
      if (f.link) {
        const show = r.link && r.link.under === key;
        f.link.textContent = show ? r.link.text : "";
        f.link.hidden = !show;
      }
    }

    animateDays(r.min, r.max);
    if (out.daysUnit) out.daysUnit.textContent = daysUnit(r.max);
    if (out.level.dataset.level !== r.level.key) {
      out.level.dataset.level = r.level.key;
      out.level.classList.remove("is-changed");
      void out.level.offsetWidth;
      out.level.classList.add("is-changed");
    }
    out.levelName.textContent = r.level.name;
    out.levelDesc.textContent = r.level.desc;
    out.docs.replaceChildren(...r.docs.map(text => { const li = document.createElement("li"); li.textContent = text; return li; }));
    renderTriangle(r.level);

    const text = messageText(r);
    const enc = encodeURIComponent(text);
    if (out.telegram) out.telegram.href = `https://t.me/${CONTACTS.telegram}?text=${enc}`;
    if (out.whatsapp) out.whatsapp.href = `https://wa.me/${CONTACTS.whatsapp}?text=${enc}`;
    if (out.email) out.email.href = `mailto:${CONTACTS.email}?subject=${encodeURIComponent("Расчёт с сайта: " + r.c.label + ", " + r.d.label.toLowerCase() + ", " + r.ur.label.toLowerCase())}&body=${enc}`;
    root.dataset.message = text;
  }

  seg.addEventListener("click", e => {
    const btn = e.target.closest(".est-seg__btn");
    if (!btn) return;
    complexity = Number(btn.dataset.value);
    render();
  });
  Object.values(sliders).forEach(f => f.input.addEventListener("input", render));

  out.copy?.addEventListener("click", async () => {
    const label = out.copy.textContent;
    try {
      await navigator.clipboard.writeText(root.dataset.message || "");
      out.copy.textContent = "Скопировано";
      out.copy.classList.add("is-done");
    } catch (e) {
      out.copy.textContent = "Не удалось";
    }
    setTimeout(() => { out.copy.textContent = label; out.copy.classList.remove("is-done"); }, 1800);
  });

  render();
}

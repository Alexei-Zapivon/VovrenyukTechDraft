/**
 * Оценка сроков: три ползунка компромисса вместо прайса.
 * Все ориентиры в одном месте (ESTIMATE): правьте дни и коэффициенты здесь, код трогать не нужно.
 * Цен нет намеренно: только диапазон рабочих дней, уровень и состав работ.
 */
const ESTIMATE = {
  complexity: [
    { label: "Деталь", days: [2, 4], hint: "Одна деталь: 3D-модель и рабочий чертёж с допусками и посадками.", docs: [] },
    { label: "Сборка", days: [6, 12], hint: "Узел из нескольких деталей: сборочный чертёж и деталировка.", docs: ["Сборочный чертёж и деталировка"] },
    { label: "Комплект", days: [12, 25], hint: "Изделие целиком: несколько узлов и полный комплект КД.", docs: ["Сборочные чертежи узлов и деталировка"] },
  ],
  depth: [
    { label: "Базовый", factor: 1, weight: 0, hint: "3D-модель и рабочие чертежи по ЕСКД.", docs: ["3D-модель (STEP / STL)", "Рабочие чертежи по ЕСКД"] },
    { label: "Расширенный", factor: 1.3, weight: 1, hint: "Плюс спецификация, файлы для производства и помощь с ТЗ.", docs: ["Спецификация", "DXF / STEP для производства", "Помощь с ТЗ"] },
    { label: "Максимальный", factor: 1.7, weight: 2, hint: "Плюс паспорт, руководство по эксплуатации и ведомость ЗИП.", docs: ["Паспорт (ПС)", "Руководство по эксплуатации (РЭ)", "Ведомость ЗИП"] },
  ],
  urgency: [
    { label: "Обычный", factor: 1, weight: 0, hint: "Спокойный ритм: этапы и дедлайны фиксируем заранее." },
    { label: "Ускоренный", factor: 0.7, weight: 1.5, hint: "Приоритет в очереди, согласования каждые один-два дня." },
    { label: "Срочно", factor: 0.5, weight: 3, hint: "Работа без очереди и ежедневные согласования." },
  ],
  // уровень по сумме весов глубины и срочности
  levels: [
    { max: 1.4, key: "standard", name: "Стандарт", desc: "Обычный ритм и базовый или расширенный комплект. Подходит для типовых деталей и узлов." },
    { max: 2.9, key: "optimal", name: "Оптимально", desc: "Баланс сроков и глубины проработки. Лучший вариант для большинства проектов." },
    { max: Infinity, key: "premium", name: "Премиум", desc: "Срочная работа или максимальный комплект документации с приоритетом в очереди." },
  ],
};

const CONTACTS = {
  telegram: "Konstruktor_Mikhail",
  whatsapp: "79515256278",
  email: "vovrenyuk_work@rambler.ru",
};

export function initEstimate() {
  const root = document.getElementById("estimate");
  if (!root) return;

  const $ = id => document.getElementById(id);
  const fields = {
    complexity: { input: $("estComplexity"), value: $("estComplexityValue"), hint: $("estComplexityHint"), ticks: $("estComplexityTicks") },
    depth:      { input: $("estDepth"),      value: $("estDepthValue"),      hint: $("estDepthHint"),      ticks: $("estDepthTicks") },
    urgency:    { input: $("estUrgency"),    value: $("estUrgencyValue"),    hint: $("estUrgencyHint"),    ticks: $("estUrgencyTicks") },
  };
  const out = {
    days: $("estDays"), daysUnit: $("estDaysUnit"), level: $("estLevel"), levelName: $("estLevelName"), levelDesc: $("estLevelDesc"),
    docs: $("estDocs"), telegram: $("estTelegram"), whatsapp: $("estWhatsApp"), email: $("estEmail"), copy: $("estCopy"),
  };
  if (Object.values(fields).some(f => !f.input)) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let shown = { min: 0, max: 0 };
  let anim = null;

  const pick = key => ESTIMATE[key][Number(fields[key].input.value)];

  // «21 рабочий день», «2–4 рабочих дня», «8–16 рабочих дней»: согласуем с последним числом
  function daysUnit(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return "рабочий день";
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "рабочих дня";
    return "рабочих дней";
  }

  function compute() {
    const c = pick("complexity"), d = pick("depth"), u = pick("urgency");
    const f = d.factor * u.factor;
    const min = Math.max(1, Math.round(c.days[0] * f));
    const max = Math.max(min + 1, Math.round(c.days[1] * f));
    const weight = d.weight + u.weight;
    const level = ESTIMATE.levels.find(l => weight <= l.max);
    const docs = [...d.docs, ...ESTIMATE.depth.slice(0, ESTIMATE.depth.indexOf(d)).flatMap(x => x.docs), ...c.docs];
    // порядок: базовые документы первыми
    const ordered = ESTIMATE.depth.slice(0, ESTIMATE.depth.indexOf(d) + 1).flatMap(x => x.docs).concat(c.docs);
    return { c, d, u, min, max, level, docs: ordered.length ? ordered : docs };
  }

  function daysText(min, max) {
    return `${min}–${max}`;
  }

  function animateDays(min, max) {
    if (anim) cancelAnimationFrame(anim);
    if (reduced || (shown.min === 0 && shown.max === 0)) {
      shown = { min, max };
      out.days.textContent = daysText(min, max);
      return;
    }
    const from = { ...shown };
    const t0 = performance.now();
    const dur = 320;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      out.days.textContent = daysText(Math.round(from.min + (min - from.min) * e), Math.round(from.max + (max - from.max) * e));
      if (k < 1) anim = requestAnimationFrame(step);
      else { shown = { min, max }; anim = null; }
    };
    anim = requestAnimationFrame(step);
  }

  function messageText(r) {
    return [
      "Расчёт с сайта VovrenyukTechDraft",
      `Изделие: ${r.c.label}`,
      `Проработка: ${r.d.label} (${r.docs.join(", ")})`,
      `Срочность: ${r.u.label}`,
      `Ориентир: ${r.min}–${r.max} ${daysUnit(r.max)}, уровень «${r.level.name}»`,
      "",
      "Описание задачи: ",
    ].join("\n");
  }

  function render() {
    const r = compute();

    for (const key of Object.keys(fields)) {
      const f = fields[key];
      const opt = pick(key);
      if (f.value) f.value.textContent = opt.label;
      if (f.hint) f.hint.textContent = opt.hint;
      if (f.ticks) Array.from(f.ticks.children).forEach((t, i) => t.classList.toggle("is-active", i === Number(f.input.value)));
      f.input.setAttribute("aria-valuetext", opt.label);
    }

    animateDays(r.min, r.max);
    if (out.daysUnit) out.daysUnit.textContent = daysUnit(r.max);
    out.level.dataset.level = r.level.key;
    out.levelName.textContent = r.level.name;
    out.levelDesc.textContent = r.level.desc;
    out.docs.replaceChildren(...r.docs.map(text => { const li = document.createElement("li"); li.textContent = text; return li; }));

    const text = messageText(r);
    const enc = encodeURIComponent(text);
    if (out.telegram) out.telegram.href = `https://t.me/${CONTACTS.telegram}?text=${enc}`;
    if (out.whatsapp) out.whatsapp.href = `https://wa.me/${CONTACTS.whatsapp}?text=${enc}`;
    if (out.email) out.email.href = `mailto:${CONTACTS.email}?subject=${encodeURIComponent("Расчёт с сайта: " + r.c.label + ", " + r.d.label.toLowerCase() + ", " + r.u.label.toLowerCase())}&body=${enc}`;
    root.dataset.message = text;
  }

  Object.values(fields).forEach(f => f.input.addEventListener("input", render));

  out.copy?.addEventListener("click", async () => {
    const text = root.dataset.message || "";
    const label = out.copy.textContent;
    try {
      await navigator.clipboard.writeText(text);
      out.copy.textContent = "Скопировано";
      out.copy.classList.add("is-done");
    } catch (e) {
      out.copy.textContent = "Не удалось";
    }
    setTimeout(() => { out.copy.textContent = label; out.copy.classList.remove("is-done"); }, 1800);
  });

  render();
}

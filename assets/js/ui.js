export function initUI() {
  const html = document.documentElement;
  const burger = document.getElementById("burger");
  const closeBtn = document.getElementById("mobileClose");
  const backdrop = document.getElementById("mobileBackdrop");
  const panel = document.getElementById("mobilePanel");
  let hideMenuTimer = null;

  const openMenu = () => {
    if (hideMenuTimer) {
      window.clearTimeout(hideMenuTimer);
      hideMenuTimer = null;
    }
    if (panel) {
      panel.hidden = false;
      panel.setAttribute("aria-hidden", "false");
    }
    if (backdrop) {
      backdrop.hidden = false;
    }
    requestAnimationFrame(() => html.classList.add("mobile-open"));
    burger?.setAttribute("aria-expanded", "true");
  };
  const closeMenu = () => {
    html.classList.remove("mobile-open");
    burger?.setAttribute("aria-expanded", "false");
    if (panel) panel.setAttribute("aria-hidden", "true");
    hideMenuTimer = window.setTimeout(() => {
      if (html.classList.contains("mobile-open")) return;
      if (panel) panel.hidden = true;
      if (backdrop) backdrop.hidden = true;
    }, 260);
  };

  // Переключатель темы. Без сохранённого выбора тема следует системной настройке.
  const themeBtn = document.getElementById("themeToggle");
  themeBtn?.addEventListener("click", () => {
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const current = html.getAttribute("data-theme") || (systemDark ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) { /* приватный режим */ }
  });

  burger?.addEventListener("click", () => {
    if (html.classList.contains("mobile-open")) {
      closeMenu();
    } else {
      openMenu();
    }
  });
  closeBtn?.addEventListener("click", closeMenu);
  backdrop?.addEventListener("click", closeMenu);
  panel?.addEventListener("click", evt => evt.stopPropagation());
  document.addEventListener("pointerdown", evt => {
    if (!html.classList.contains("mobile-open")) return;
    if (panel?.contains(evt.target)) return;
    if (burger?.contains(evt.target)) return;
    closeMenu();
  });
  window.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });

  document.querySelectorAll(".copy-btn").forEach(btn => {
    const iconDefault = btn.querySelector(".icon-copy");
    const iconSuccess = btn.querySelector(".icon-check");
    const baseLabel = btn.getAttribute("aria-label") || "Скопировать";
    const copiedLabel = btn.dataset.copiedLabel || "Скопировано";
    let resetTimer = null;

    const setState = copied => {
      btn.classList.toggle("copied", copied);
      btn.setAttribute("aria-label", copied ? copiedLabel : baseLabel);
      if (iconDefault) iconDefault.hidden = copied;
      if (iconSuccess) iconSuccess.hidden = !copied;
    };

    setState(false);

    btn.addEventListener("click", async () => {
      const value = btn.getAttribute("data-copy");
      if (!value) return;
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
        else {
          const ta = document.createElement("textarea");
          ta.value = value;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
        }
        setState(true);
        resetTimer = window.setTimeout(() => setState(false), 1800);
      } catch (e) {
        setState(false);
        console.error("Не удалось скопировать", e);
      }
    });
  });


  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) e.target.classList.add("visible");
  }), { threshold: .2 });
  document.querySelectorAll(".fade-up").forEach(el => io.observe(el));

  document.querySelectorAll("[data-phone]").forEach(block => {
    const valueEl = block.querySelector("[data-phone-value]");
    const toggleBtn = block.querySelector("[data-phone-toggle]");
    if (!valueEl || !toggleBtn) return;

    const masked = valueEl.dataset.phoneMask || valueEl.textContent.trim();
    const full = valueEl.dataset.phoneFull || masked;
    let isRevealed = valueEl.textContent.trim() === full;
    let animating = false;

    const iconShow = toggleBtn.querySelector(".icon-eye");
    const iconHide = toggleBtn.querySelector(".icon-eye-off");
    const labelShow = toggleBtn.dataset.labelShow || "Показать полностью";
    const labelHide = toggleBtn.dataset.labelHide || "Скрыть номер";

    const updateButton = () => {
      const label = isRevealed ? labelHide : labelShow;
      toggleBtn.setAttribute("aria-label", label);
      toggleBtn.setAttribute("aria-expanded", String(isRevealed));
      if (iconShow) iconShow.hidden = isRevealed;
      if (iconHide) iconHide.hidden = !isRevealed;
      toggleBtn.classList.toggle("is-active", isRevealed);
    };

    valueEl.addEventListener("transitionend", evt => {
      if (evt.propertyName !== "opacity") return;

      if (valueEl.classList.contains("is-fading-out")) {
        valueEl.classList.remove("is-fading-out");
        isRevealed = !isRevealed;
        valueEl.textContent = isRevealed ? full : masked;
        updateButton();

        void valueEl.offsetWidth;
        valueEl.classList.add("is-fading-in");
        return;
      }

      if (valueEl.classList.contains("is-fading-in")) {
        valueEl.classList.remove("is-fading-in");
        animating = false;
      }
    });

    toggleBtn.addEventListener("click", () => {
      if (animating) return;
      animating = true;
      valueEl.classList.remove("is-fading-in");
      valueEl.classList.add("is-fading-out");
    });

    updateButton();
    valueEl.textContent = isRevealed ? full : masked;
  });

  const galleryImages = Array.from(document.querySelectorAll("#portfolio .gallery img"));
  const lightbox = document.getElementById("galleryLightbox");
  const lightboxImage = document.getElementById("lightboxImage");
  const lightboxCaption = document.getElementById("lightboxCaption");
  const lightboxPrev = lightbox?.querySelector(".lightbox-prev");
  const lightboxNext = lightbox?.querySelector(".lightbox-next");
  const lightboxClose = lightbox?.querySelector(".lightbox-close");
  let currentIndex = 0;
  let lastFocused = null;
  let keydownBound = null;

  if (galleryImages.length && lightbox && lightboxImage) {
    const setImage = idx => {
      if (!galleryImages.length) return;
      if (idx < 0) idx = galleryImages.length - 1;
      if (idx >= galleryImages.length) idx = 0;
      currentIndex = idx;
      const srcEl = galleryImages[currentIndex];
      const nextSrc = srcEl.dataset.full || srcEl.currentSrc || srcEl.src;
      lightboxImage.src = nextSrc;
      lightboxImage.alt = srcEl.alt || "";
      if (lightboxCaption) lightboxCaption.textContent = srcEl.alt || "";
    };

    const closeLightbox = () => {
      lightbox.classList.remove("is-active");
      lightbox.setAttribute("aria-hidden", "true");
      lightbox.hidden = true;
      html.classList.remove("lightbox-open");
      if (keydownBound) {
        window.removeEventListener("keydown", keydownBound);
        keydownBound = null;
      }
      if (lastFocused instanceof HTMLElement) {
        lastFocused.focus({ preventScroll: true });
      }
    };

    const openLightbox = idx => {
      lastFocused = document.activeElement;
      setImage(idx);
      lightbox.hidden = false;
      lightbox.classList.add("is-active");
      lightbox.setAttribute("aria-hidden", "false");
      html.classList.add("lightbox-open");
      keydownBound = evt => {
        if (evt.key === "Escape") {
          evt.preventDefault();
          closeLightbox();
          return;
        }
        if (evt.key === "ArrowRight") {
          evt.preventDefault();
          setImage(currentIndex + 1);
          return;
        }
        if (evt.key === "ArrowLeft") {
          evt.preventDefault();
          setImage(currentIndex - 1);
        }
      };
      window.addEventListener("keydown", keydownBound);
      lightboxClose?.focus({ preventScroll: true });
    };

    galleryImages.forEach((img, idx) => {
      img.setAttribute("role", "button");
      img.setAttribute("tabindex", "0");
      const label = img.alt ? `${img.alt}. Открыть в увеличении` : "Открыть фото в увеличении";
      img.setAttribute("aria-label", label);
      img.addEventListener("click", () => openLightbox(idx));
      img.addEventListener("keydown", evt => {
        if (evt.key === "Enter" || evt.key === " ") {
          evt.preventDefault();
          openLightbox(idx);
        }
      });
    });

    lightboxClose?.addEventListener("click", closeLightbox);
    lightboxPrev?.addEventListener("click", () => setImage(currentIndex - 1));
    lightboxNext?.addEventListener("click", () => setImage(currentIndex + 1));

    lightbox.addEventListener("click", evt => {
      if (evt.target === lightbox) closeLightbox();
    });
  }
}

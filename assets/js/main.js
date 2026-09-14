import { initUI } from "./ui.js";

initUI();

/* 3D-вьюер (three.js ~165 КБ gzip + модель ~250 КБ) грузится после страницы, чтобы не мешать
   первому экрану. При включённой экономии трафика или медленной сети показываем кнопку. */
const html = document.documentElement;
const loadBtn = document.getElementById("viewerLoad");
let started = false;

function startViewer() {
  if (started) return;
  started = true;
  if (loadBtn) loadBtn.hidden = true;
  import("./viewer.bundle.js")
    .then(m => m.initViewer())
    .catch(err => {
      html.classList.add("no-3d");
      console.warn("3D-сцена недоступна", err);
    });
}

const conn = navigator.connection;
const slowNetwork = Boolean(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || "")));

if (slowNetwork && loadBtn) {
  loadBtn.hidden = false;
  loadBtn.addEventListener("click", startViewer);
} else {
  const idle = window.requestIdleCallback || (fn => setTimeout(fn, 200));
  if (document.readyState === "complete") idle(startViewer);
  else window.addEventListener("load", () => idle(startViewer), { once: true });
}

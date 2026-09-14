import { initUI } from "./ui.js";
import { initEstimate } from "./estimate.js";

initUI();
initEstimate();

/* 3D-вьюер: код (~165 КБ gzip) и модель (~250 КБ) начинают грузиться сразу и параллельно,
   пока панель показывает индикатор. При экономии трафика или 2G ждём нажатия кнопки. */
const html = document.documentElement;
const loadBtn = document.getElementById("viewerLoad");
const status = document.getElementById("viewerStatus");
const statusText = document.getElementById("viewerStatusText");
let started = false;

function showStatus(text, isError) {
  if (!status) return;
  if (statusText) statusText.textContent = text;
  status.classList.toggle("is-error", Boolean(isError));
  status.hidden = !text;
}

function startViewer() {
  if (started) return;
  started = true;
  if (loadBtn) loadBtn.hidden = true;
  showStatus("Загрузка 3D-модели");
  const model = fetch("/models/model.glb", { credentials: "same-origin" });
  model.catch(() => { /* ошибку покажет вьюер */ });
  import("./viewer.bundle.js")
    .then(m => m.initViewer({ model }))
    .catch(err => {
      html.classList.add("no-3d");
      showStatus("3D-модель недоступна в этом браузере", true);
      console.warn("3D-сцена недоступна", err);
    });
}

const conn = navigator.connection;
const slowNetwork = Boolean(conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || "")));

if (slowNetwork && loadBtn) {
  showStatus("");
  loadBtn.hidden = false;
  loadBtn.addEventListener("click", startViewer);
} else {
  startViewer();
}

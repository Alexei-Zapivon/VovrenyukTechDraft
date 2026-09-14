import { initUI } from "./ui.js";

initUI();

// 3D-сцена тянет three.js с CDN. Если CDN недоступен или браузер не поддерживает importmap,
// остальной интерфейс продолжает работать, а панель модели остаётся пустой.
import("./three-scene.js")
  .then(m => m.initThree())
  .catch(err => {
    document.documentElement.classList.add("no-3d");
    console.warn("3D-сцена недоступна", err);
  });

# 3D-вьюер: сборка и модель

Браузер получает один файл `assets/js/viewer.bundle.js` (three.js + загрузчики + код вьюера)
и модель `models/model.glb` (glTF, квантование + meshopt-сжатие). Исходники здесь.

## Пересобрать бандл

```
cd viewer
npm install
npm run build        # -> ../assets/js/viewer.bundle.js
```

Код вьюера: `src/scene.js`. Версия three.js закреплена в `package.json`.

## Заменить модель

1. Положите STL в `models/model.stl` (миллиметры, ось Z вверх, как в CAD).
2. Конвертируйте в glTF с раздельными нормалями на острых рёбрах (нужны python3, trimesh, networkx, scipy):

```
python3 -c "
import trimesh, math
m = trimesh.load('models/model.stl', process=True, force='mesh')
trimesh.graph.smooth_shade(m, angle=math.radians(30)).export('models/model_raw.glb')"
```

3. Упростите и сожмите (`-si 0.4` оставляет 40 % треугольников, для мелких деталей поставьте 1.0 в package.json):

```
cd viewer && npm run model
```

Габариты на чертеже считаются из модели автоматически, единицы предполагаются миллиметры.

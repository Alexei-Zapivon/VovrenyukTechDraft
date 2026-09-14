#!/usr/bin/env python3
"""
Подготовка фото для блока «О себе»: кадрирование 4:5 под вёрстку (.about .photo),
два размера (1x и 2x для колонки 300 px) в WebP и JPEG.

    python3 tools/photo.py путь/к/исходнику.jpg

Результат: images/hero/engineer-640.webp, engineer-640.jpg, engineer-1280.webp, engineer-1280.jpg.
Нужен Pillow: pip install Pillow
"""
import sys, os
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'images', 'hero')
RATIO = (4, 5)
WIDTHS = (640, 1280)
FACE_BIAS = 0.35   # при обрезке по высоте оставляем больше сверху: лицо обычно в верхней трети


def crop_to_ratio(im):
    w, h = im.size
    target = w * RATIO[1] / RATIO[0]
    if h > target:                       # слишком высокое: режем по высоте
        cut = h - target
        top = int(cut * FACE_BIAS)
        return im.crop((0, top, w, top + int(target)))
    tw = h * RATIO[0] / RATIO[1]          # слишком широкое: режем по ширине по центру
    left = int((w - tw) / 2)
    return im.crop((left, 0, left + int(tw), h))


def main(src):
    im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
    print('source:', src, im.size)
    im = crop_to_ratio(im)
    os.makedirs(OUT, exist_ok=True)
    for w in WIDTHS:
        if im.width < w:                 # не растягиваем маленький исходник: файл того же имени, но меньшего размера
            print(f'исходник уже {im.width} px шириной, вариант {w} сохраняю без увеличения')
            w2 = im.width
        else:
            w2 = w
        h = int(w2 * RATIO[1] / RATIO[0])
        r = im.resize((w2, h), Image.LANCZOS)
        webp = os.path.join(OUT, f'engineer-{w}.webp')
        jpg = os.path.join(OUT, f'engineer-{w}.jpg')
        r.save(webp, 'WEBP', quality=82, method=6)
        r.save(jpg, 'JPEG', quality=84, optimize=True, progressive=True)
        print(f'{os.path.basename(webp)}: {os.path.getsize(webp) // 1024} KB, {os.path.basename(jpg)}: {os.path.getsize(jpg) // 1024} KB ({w2}x{h})')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1])

#!/usr/bin/env python3
"""
Варианты фото портфолио под srcset. Исходники: images/projects/NN.jpg (любой размер).
Результат рядом: NN-480.webp, NN-800.webp, NN-1200.webp (сетка), NN-800.jpg (запасной src),
NN-1600.jpg (лайтбокс). Исходники не трогаются.

    python3 tools/gallery.py            # все NN.jpg в images/projects
    python3 tools/gallery.py 07.jpg     # один файл (положите его в images/projects)
"""
import sys, os, re
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'images', 'projects')
WEBP = (480, 800, 1200)
JPG = {'800': 800, '1600': 1600}


def resize(im, w):
    if im.width <= w:
        return im.copy()
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


def process(name):
    src = os.path.join(DIR, name)
    stem = os.path.splitext(name)[0]
    im = ImageOps.exif_transpose(Image.open(src)).convert('RGB')
    out = []
    for w in WEBP:
        p = os.path.join(DIR, f'{stem}-{w}.webp')
        resize(im, w).save(p, 'WEBP', quality=80, method=6)
        out.append(f'{os.path.basename(p)} {os.path.getsize(p) // 1024}K')
    for suffix, w in JPG.items():
        p = os.path.join(DIR, f'{stem}-{suffix}.jpg')
        resize(im, w).save(p, 'JPEG', quality=82, optimize=True, progressive=True)
        out.append(f'{os.path.basename(p)} {os.path.getsize(p) // 1024}K')
    print(f'{name} ({im.width}x{im.height}): ' + ', '.join(out))


if __name__ == '__main__':
    names = sys.argv[1:] or sorted(n for n in os.listdir(DIR) if re.fullmatch(r'\d+\.jpe?g', n, re.I))
    for n in names:
        process(n)

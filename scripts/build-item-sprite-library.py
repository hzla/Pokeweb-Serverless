#!/usr/bin/env python3
"""Build the optional item-icon archive from local reference checkouts."""
import argparse
import io
import json
import re
import subprocess
import tarfile
import zipfile
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--emerald', type=Path, required=True, help='pokeemerald-expansion Git checkout with upstream/master')
parser.add_argument('--hg', type=Path, required=True, help='hg-engine checkout')
parser.add_argument('--output', type=Path, default=Path('public/data/item-sprite-library.zip'))
args = parser.parse_args()
archive = subprocess.run(['git', 'archive', 'upstream/master', 'graphics/items/icons', 'graphics/items/icon_palettes', 'src/data/items.h', 'src/data/graphics/items.h'], cwd=args.emerald, check=True, stdout=subprocess.PIPE).stdout
with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
    files = {m.name: tar.extractfile(m).read() for m in tar if m.isfile()}
entries = []
images = {}
for path, data in sorted(files.items()):
    if not path.startswith('graphics/items/icons/') or not path.endswith('.png'):
        continue
    name = Path(path).stem
    target = f'emerald/{name}.png'
    images[target] = data
    entries.append({'source': 'emerald', 'name': name.replace('_', ' ').title(), 'path': target})
# Item definitions often pair shared artwork with a distinct palette (gems,
# mints, herbs, and others). Materialize those named pairs for direct import.
graphics = files['src/data/graphics/items.h'].decode()
symbols = dict(re.findall(r'const\s+u(?:16|32)\s+(gItemIcon(?:Palette)?_\w+)\[\]\s*=\s*INCGFX_U(?:16|32)\("([^"]+)"', graphics))
blocks = re.split(r'(?m)^\s*\[(ITEM_[A-Z0-9_]+)\]\s*=\s*\{', files['src/data/items.h'].decode())
existing = {entry['path'] for entry in entries}
for i in range(1, len(blocks), 2):
    name, body = blocks[i][5:].lower(), blocks[i + 1]
    icon = re.search(r'\.iconPic\s*=\s*(gItemIcon_\w+)', body)
    palette = re.search(r'\.iconPalette\s*=\s*(gItemIconPalette_\w+)', body)
    if not icon or not palette or icon[1] not in symbols or palette[1] not in symbols:
        continue
    icon_path, palette_path = symbols[icon[1]], symbols[palette[1]]
    if icon_path not in files or palette_path not in files:
        continue
    image = Image.open(io.BytesIO(files[icon_path]))
    pal = files[palette_path].decode().splitlines()
    colors = [int(value) for line in pal[3:] for value in line.split()]
    if image.mode != 'P' or len(colors) % 3 or not 1 <= len(colors) // 3 <= 16 or image.getextrema()[1] >= len(colors) // 3:
        raise ValueError(f'Unexpected image or palette format for {name}')
    image.putpalette(colors + [0] * (768 - len(colors)))
    output = io.BytesIO()
    image.save(output, format='PNG', transparency=0)
    target = f'emerald/{name}.png'
    images[target] = output.getvalue()
    if target not in existing:
        entries.append({'source': 'emerald', 'name': name.replace('_', ' ').title(), 'path': target})
        existing.add(target)
names = (args.hg / 'data/text/222.txt').read_text().splitlines()
for index, name in enumerate(names):
    if index <= 536:
        continue
    graphic = args.hg / 'data/graphics/item' / f'{807 + (index - 537) * 2:04}.png'
    if not graphic.is_file():
        continue
    target = f'hg/{graphic.name}'
    images[target] = graphic.read_bytes()
    entries.append({'source': 'hg', 'name': re.sub(r'\s+', ' ', name).strip(), 'path': target})
entries.sort(key=lambda entry: (entry['name'].casefold(), entry['source'], entry['path']))
args.output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
    for name, data in [('manifest.json', json.dumps({'version': 1, 'entries': entries}, ensure_ascii=False, separators=(',', ':')).encode()), *sorted(images.items())]:
        info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        output.writestr(info, data)
credits = args.output.with_name('item-sprite-hg-credits.txt')
credits.write_text((args.hg / 'CREDITS.md').read_text())
print(f'Wrote {len(entries)} sprites to {args.output}')

"""Bake the reference Three Cards artwork into editable Nitro BG resources."""
import os
from pathlib import Path
import struct
import subprocess
from tempfile import TemporaryDirectory

from ndspy.narc import NARC


def nitro_file(magic, section, payload):
    block = struct.pack('<4sI', section, 8 + len(payload)) + payload
    return struct.pack('<4sHHIHH', magic, 0xfffe, 0x0100, 16 + len(block), 16, 1) + block


def archive(source, build, face, font_colors, game=None):
    with TemporaryDirectory(dir=build) as directory:
        path = Path(directory)
        generator = path / 'art.cpp'
        generator.write_text(f'''
#include <cstdio>
#include "three_card_art.h"
int main() {{
    using namespace learnset;
    u8 pixels[256 * 192 / 2] = {{}};
    u16 palette[256] = {{}};
    threeCardPalette(palette, {face}, {font_colors[1]}, {font_colors[2]}, {font_colors[15]});
    paintThreeCardArt(pixels, true);
    std::fwrite(palette, sizeof(palette), 1, stdout);
    std::fwrite(pixels, sizeof(pixels), 1, stdout);
}}
''')
        exe = path / 'bake-art'
        subprocess.run([os.environ.get('CXX', 'c++'), '-std=c++17', '-I', str(source),
                        '-I', str(build), *([f'-DGAME_{game}'] if game else []), str(generator), '-o', str(exe)], check=True)
        data = subprocess.check_output([str(exe)])
    palette, pixels = data[:512], data[512:]
    assert len(pixels) == 32 * 24 * 32
    indexed = {}
    screen = []
    for y in range(24):
        bank = 14 if y < 3 else 13 if y >= 18 else 9
        for x in range(32):
            start = (y * 32 + x) * 32
            tile = pixels[start:start + 32]
            screen.append(indexed.setdefault(tile, len(indexed)) | bank << 12)
    chars = b''.join(indexed)
    assert len(indexed) <= 895
    screen += [0] * (32 * 8)
    result = NARC()
    result.endiannessOfBeginning = ">"
    result.filenames.files = ["tiles.ncgr", "screen.nscr", "palette.nclr"]
    result.files = [
        nitro_file(b'RGCN', b'RAHC', struct.pack('<HHIIIII', 0xffff, 0xffff, 3, 0, 0, len(chars), 24) + chars),
        nitro_file(b'RCSN', b'NRCS', struct.pack('<HHII', 256, 256, 0, len(screen) * 2) + struct.pack('<1024H', *screen)),
        nitro_file(b'RLCN', b'TTLP', struct.pack('<IIII', 3, 0, len(palette), 16) + palette),
    ]
    print(f'Three Cards art: {len(indexed)} unique 4bpp tiles')
    return result.save()

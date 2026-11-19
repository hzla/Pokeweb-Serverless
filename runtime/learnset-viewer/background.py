"""Extract a clean, full-width stripe profile from verified retail tutor art.

The upper map is member 4, sharing tiles (1) and colors (0) with the lower
screen. Sample unobstructed background, not the old move bars/name plate.
Only seven RGB555 colors and row runs are embedded: no runtime ROM reads or
extra bitmap allocations are required. build.py pins each game's resources.
"""
import itertools
import struct


def palette_index(files, member, x, y):
    palette, characters, screen = files[0], files[1], files[member]
    assert palette[:4] == b'RLCN' and characters[:4] == b'RGCN' and screen[:4] == b'RCSN'
    assert struct.unpack_from('<HH', screen, 24) == (256, 256)
    entry = struct.unpack_from('<H', screen, 36 + 2 * ((y // 8) * 32 + x // 8))[0]
    tx, ty = x % 8, y % 8
    if entry & 1024:
        tx = 7 - tx
    if entry & 2048:
        ty = 7 - ty
    packed = characters[48 + (entry & 1023) * 32 + ty * 4 + tx // 2]
    index = (packed >> ((tx & 1) * 4)) & 15
    return (entry >> 12) * 16 + index


def pixel_color(files, member, x, y):
    return struct.unpack_from('<H', files[0], 40 + 2 * palette_index(files, member, x, y))[0]


def profile(files):
    rows = []
    for y in range(192):
        # The left edge is clear above the list. Beyond that, use the right
        # edge, shifting the name-plate rows to an identical clear stripe pair.
        rows.append(pixel_color(files, 4, 0 if y < 40 else 248, y + 32 if 40 <= y < 72 else y))
    assert rows[41] == 0x24e7 and rows[40] == 0x2929
    for y in range(40, 169, 16):
        assert rows[y] == rows[40]
    # Confirm the lower-screen clear areas use these exact body/line colors.
    for y in (72, 73, 88, 89, 120, 121, 136, 137):
        assert pixel_color(files, 2, 248, y) == rows[y]
    return rows


def header(rows):
    # Reserve icon/arrow, gold-bar, hidden-ability and text colors unchanged.
    indices = {0x24e7: 1, 0x0c63: 3, 0x2929: 4, 0x316b: 5,
               0x5f09: 6, 0x14a4: 13, 0x56ce: 14}
    assert set(rows) == set(indices)
    lines = ['#pragma once', '// Generated from verified US W2/B2 tutor resources.',
             'struct TutorBackgroundColor { u16 value; u8 index; };',
             'constexpr TutorBackgroundColor TutorBackgroundColors[] = {']
    lines += [f'    {{0x{value:04x}, {index}}},' for value, index in indices.items()]
    lines += ['};', 'struct TutorBackgroundRun { u8 y, height, color; };',
              'constexpr TutorBackgroundRun TutorBackgroundRuns[] = {']
    y = 0
    for color, group in itertools.groupby(rows):
        height = len(list(group))
        lines.append(f'    {{{y}, {height}, {indices[color]}}},')
        y += height
    lines += ['};', 'constexpr u16 TutorBackgroundBaseColor = 0x24e7;', '']
    return '\n'.join(lines)


def lower_grid_header(files):
    """Replace the exposed move-list backdrop while retaining its row art."""
    first_tile, bank = 128, 6
    rows = struct.unpack_from('<1024H', files[2], 36)
    aux = struct.unpack_from('<256H', files[3], 36)
    assert all((entry & 1023) < first_tile and entry >> 12 != bank for entry in rows + aux)
    palette_bytes = struct.unpack_from('<I', files[0], 32)[0]
    assert 64 <= palette_bytes <= bank * 32
    palette_map = files[0][40+palette_bytes:]
    assert palette_map[:4] == b'PMCP'
    count, _, offsets_at = struct.unpack_from('<HHI', palette_map, 8)
    destinations = struct.unpack_from(f'<{count}H', palette_map, 8+offsets_at)
    assert count*32 == palette_bytes and destinations[1] == 1 and bank not in destinations
    chars = files[1][48:]
    assert struct.unpack_from('<I', files[1], 40)[0] == 8192 and len(chars) >= 8192

    replacements, tiles = [], {}
    for y in range(8, 21):
        row = list(rows[y*32:(y+1)*32])
        row[18:23] = row[17:18]*3 + row[18:20]
        for x, entry in enumerate(row):
            assert entry >> 10 == 4, 'Expected unflipped move-list art in native palette bank 1'
            tile = entry & 1023
            data = chars[tile*32:(tile+1)*32]
            pixels = [ink for byte in data for ink in (byte & 15, byte >> 4)]
            if not any(ink in (8, 9) for ink in pixels):
                replacements.append(0)
                continue
            assert 3 not in pixels, 'The major grid color must not replace existing row ink'
            for i, ink in enumerate(pixels):
                if ink in (8, 9):
                    px, py = i % 8, i // 8
                    pixels[i] = 3 if px == 0 and x % 4 == 0 else 8 if px == 0 or py == 0 else 9
            patterned = bytes(a | (b << 4) for a,b in zip(pixels[::2],pixels[1::2]))
            replacements.append(tiles.setdefault(patterned,first_tile+len(tiles)))
    assert first_tile+len(tiles) <= 256

    def array(name, values, item_type, wrap, prefix=''):
        values = list(values)
        lines = ['    '+', '.join(hex(v) for v in values[i:i+wrap])+',' for i in range(0,len(values),wrap)]
        return f'{prefix}constexpr {item_type} {name}[]={{\n'+'\n'.join(lines)+'\n};'

    return '\n'.join([
        '#pragma once',
        '// Generated from the verified US tutor character and screen resources.',
        f'constexpr u32 LowerGridFirstTile={first_tile}, LowerGridBank={bank}, LowerGridMapStart=8*32;',
        array('LowerGridPalette',struct.unpack_from('<16H',files[0],72),'u16',8),
        array('LowerGridMap',replacements,'u8',16),
        array('LowerGridCharacters',b''.join(tiles),'u8',16,'alignas(4) '),
        '',
    ])

"""Compile the left-edge tab with the retail battle Bag's item icons."""
import struct
from collections import Counter

import ndspy.narc

BALLS = (*range(1, 17), 576)
WIDTH, HEIGHT = 32, 64
TAB_HEIGHT = 44


def rgb555(r, g, b):
    return (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10)


def nitro(magic, block, payload):
    return struct.pack("<4sHHIHH4sI", magic, 0xfeff, 0x100, 24 + len(payload), 16, 1,
                       block, 8 + len(payload)) + payload


def icon(archive, character, palette):
    art, pal = archive.files[character], archive.files[palette]
    assert art[:4] == b"RGCN" and len(art) >= 560 and pal[:4] == b"RLCN"
    colours = struct.unpack_from("<16H", pal, 40)
    pixels = {}
    for y in range(32):
        for x in range(32):
            address = ((y // 8) * 4 + x // 8) * 32 + (y % 8) * 4 + x % 8 // 2
            colour = (art[48 + address] >> ((x & 1) * 4)) & 15
            if colour:
                pixels[x, y] = colours[colour]
    left, top = min(x for x, _ in pixels), min(y for _, y in pixels)
    right, bottom = max(x for x, _ in pixels), max(y for _, y in pixels)
    assert right - left < 24 and bottom - top < 24
    return {(x - left + 13 - (right - left) // 2, y - top + 21 - (bottom - top) // 2): c
            for (x, y), c in pixels.items()}


def tab(pixels):
    # Entry zero is transparent. The same art serves both poses, with the
    # keycap, bevel and arrows changing palette when holding L.
    chrome = [0, rgb555(16, 16, 16), rgb555(33, 33, 33), rgb555(53, 53, 53),
              rgb555(173, 173, 173), rgb555(247, 247, 247), rgb555(41, 41, 49)]
    art = [[0] * WIDTH for _ in range(HEIGHT)]
    for y in range(TAB_HEIGHT):
        cut = max(0, 6 - y, y - (TAB_HEIGHT - 9))
        right = WIDTH - cut
        for x in range(right):
            if y < TAB_HEIGHT - 2 and x < right - 1:
                inside = 2 < y < TAB_HEIGHT - 5 and x < right - 4
                art[y][x] = 2 + ((x // 2 + y // 2) & 1) if inside else 4
                if y == 1 or (x == right - 2 and y < TAB_HEIGHT - 6):
                    art[y][x] = 5
                if y in (0, TAB_HEIGHT - 3):
                    art[y][x] = 1
            else:
                art[y][x] = 6
    for y in range(3, 12):
        for x in range(8, 20):
            if (x in (8, 19)) and y in (3, 11):
                continue
            art[y][x] = 1 if x in (8, 19) or y in (3, 11) else 4
    for y in range(5, 10):
        for x in range(12, 15 if y == 9 else 13):
            art[y][x] = 1
    # Reserve one colour for the arrows. In the idle palette it matches their
    # solid backing. Leave one checkerboard pixel between the backing and bevel.
    for y in range(14, 29):
        art[y][22:27] = [2] * 5
    for x, y in [(24, 15), (23, 16), (24, 16), (25, 16), (23, 25), (24, 25), (25, 25), (24, 26)]:
        art[y][x] = 7
    chrome.append(chrome[2])

    icon_colours = [colour for colour, _ in Counter(pixels.values()).most_common() if colour not in chrome[1:]]
    palette = (chrome + icon_colours)[:16]
    palette += [0] * (16 - len(palette))

    def nearest(colour):
        # Reserve index 7 exclusively for the changing arrows.
        def distance(index):
            return sum((((colour >> shift) & 31) - ((palette[index] >> shift) & 31)) ** 2
                       for shift in (0, 5, 10))
        return min((i for i in range(1, min(16, len(chrome) + len(icon_colours))) if i != 7), key=distance)

    for (x, y), colour in pixels.items():
        art[y][x] = nearest(colour)
    tiles = bytes(art[ty + y][tx + x] | (art[ty + y][tx + x + 1] << 4)
                  for ty in range(0, HEIGHT, 8) for tx in range(0, WIDTH, 8)
                  for y in range(8) for x in range(0, 8, 2))
    held = palette.copy()
    held[4] = held[7] = rgb555(41, 189, 255)
    held[5] = rgb555(173, 239, 255)
    return tiles + struct.pack("<32H", *palette, *held)


def build_archive(rom, arm):
    items = ndspy.narc.NARC(rom.getFileByName("a/0/2/5"))
    bw1 = rom.idCode in (b"IRBO", b"IRAO")
    pockets = ndspy.narc.NARC(rom.getFileByName("a/2/3/2" if bw1 else "a/2/2/8")).files[0]
    assert tuple(i for i, flags in enumerate(pockets) if flags & 1) == BALLS
    pointer = {b"IRBO": 0x02020ef4, b"IRAO": 0x02020f10, b"IREO": 0x02026700, b"IRDO": 0x0202672c}
    at = pointer[bytes(rom.idCode)] - rom.arm9RamAddress
    address = struct.unpack_from("<I", arm, at)[0]
    assert address == struct.unpack_from("<I", arm, at + 0x88)[0]
    icon_table = address - rom.arm9RamAddress
    # A single vertical 32×64 cell with its origin at the tab's top-left.
    cell = struct.pack("<HHI", 1, 1, 24) + bytes(16)
    cell += struct.pack("<HHI4h", 1, 0x0808, 0, 32, 64, 0, 0)
    cell += struct.pack("<3H", 0x8000, 0xc000, 0) + bytes(2)
    anim = struct.pack("<HHIII", 1, 1, 24, 40, 48) + bytes(8)
    anim += struct.pack("<HHIII", 1, 0, 0x10000, 1, 0)
    anim += struct.pack("<IHHI", 0, 1, 0, 0)
    palette = nitro(b"RLCN", b"TTLP", struct.pack("<IIII", 3, 0, 32, 16) + bytes(32))
    archive = ndspy.narc.NARC()
    archive.files = [palette, nitro(b"RECN", b"KBEC", cell), nitro(b"RNAN", b"KNBA", anim)]
    for ball in BALLS:
        archive.files.append(tab(icon(items, *struct.unpack_from("<HH", arm, icon_table + ball * 4))))
    return bytes(archive.save())

#!/usr/bin/env python3
"""Build Pokeweb's Fairy Type Support patches for Black / White from Frost's Black patch.

    python3 runtime/fairy-bw1/build.py --black-patch Black1Fairy.Vpatch --black clean_black.nds --white clean_white.nds

Frost's `Black1Fairy.Vpatch` (the patch format Pokeweb already reads for Black 2 / White 2, see
src/pokeweb/generalPatchModel.ts) makes type 17 Fairy on US Black: an 18x18 type chart, the "typeless" tests moved
from 17 to 18, the move-handler table moved to make room, the type names, icons and move-button palette. It is copied
unchanged to src/assets/patches/fairy-b.bin.

White is Black with every overlay 0x20 bytes higher and the same overlay contents (aletheia's matched_white tables:
all functions of overlays 93, 94, 131, 180 and 208 are at Black + 0x20; the files differ only in relocated words), so
the White patch is the Black one with:

* the overlay table entries taken from White's own table, transformed as the Black patch transforms Black's (checked
  against Black's below),
* every pointer the patch writes (into overlay 93's new prefix or overlay 180's table, and the 258 move-handler
  addresses of the prefix) moved by 0x20,
* the ARM9 type-icon palette byte at White's table (found by its retail bytes),
* the overlay section headers at White's addresses.

Each patched span's retail bytes are checked to be equal in both games except at the pointer words, so no other
relocation is hidden in a span. The branches the patch writes are relative within an overlay or between overlays that
move together (overlay 94 -> overlay 93's prefix), so they are unchanged. The NARC members it replaces are identical
in both games' retail ROMs (checked by src/test/fairyTypeBw1.test.ts) and are kept.
"""
import argparse
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "runtime/anim-streams"))
import bw1  # noqa: E402

WHITE_SHIFT = 0x20  # every overlay of White is 0x20 higher than Black's
PREFIX_SIZE = 0x2100  # what the patch prepends to overlay 93
HANDLER_TABLE_ENTRIES = 258  # retail move-handler pairs moved to the start of the prefix
# Patched spans whose words are pointers, by section and patch address: offsets of the pointer words in the span.
POINTERS = {
    ("ov_93", 0x23998): [0],  # BTL_CALC_GetTypeAffinity: the 18x18 chart in the prefix
    ("ov_93", 0x23AD0): [0],  # BTL_CALC_ListResistingTypes: the chart
    ("ov_93", 0x2C348): [0, 8],  # HAND_WAZA_AddMoveHandler: the moved handler table (+ count 0x180 between)
    ("ov_180", 0x6B0): [0],  # HALL_OF_FAME_CreateMonParticle: its new 18-entry table in overlay 180
}
TYPE_ICON_PALETTES = 17  # arm9 byte table, one per type; the patch sets entry 17 (Fairy)


def parse(data):
    out, o = [], 0
    while o < len(data):
        assert data[o] == 0x7B
        e = data.index(0x7C, o + 1)
        name = data[o + 1:e].decode()
        n = struct.unpack_from("<I", data, e + 1)[0]
        assert data[e + 5] == 0x3A
        out.append((name, bytearray(data[e + 6:e + 6 + n])))
        o = e + 6 + n
        assert data[o] == 0x7D
        o += 1
    return out


def serialize(sections):
    out = bytearray()
    for name, payload in sections:
        out += b"{" + name.encode() + b"|" + struct.pack("<I", len(payload)) + b":" + payload + b"}"
    return bytes(out)


def chunks(payload, start):
    o, out = start, []
    while o < len(payload):
        a, n = struct.unpack_from("<II", payload, o)
        out.append((a, o + 8, n))
        o += 8 + n
    return out


def overlay_table(rom):
    off, size = struct.unpack_from("<II", rom, 0x50)
    return rom[off:off + size]


def transform_entry(retail, patched_black, retail_black):
    """White's entry changed as the Black patch changes Black's: the RAM address and size by the same amounts, the
    flags word as the uncompressed size."""
    r = list(struct.unpack("<8I", retail))
    pb = struct.unpack("<8I", patched_black)
    rb = struct.unpack("<8I", retail_black)
    out = r[:]
    out[1] = r[1] + (pb[1] - rb[1])
    out[2] = r[2] + (pb[2] - rb[2])
    out[3] = pb[3]  # BSS
    assert pb[4] == rb[4] and pb[5] == rb[5] and pb[6] == rb[6], "the patch moves only the code"
    assert pb[7] == 0x02000000 | pb[2], "the patch stores the overlay uncompressed"
    out[7] = 0x02000000 | out[2]
    return struct.pack("<8I", *out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--black-patch", required=True)
    parser.add_argument("--black", required=True, help="clean US Black ROM")
    parser.add_argument("--white", required=True, help="clean US White ROM")
    parser.add_argument("--out-dir", default=str(REPO / "src/assets/patches"))
    args = parser.parse_args()

    black_patch = Path(args.black_patch).read_bytes()
    sections = parse(black_patch)
    names = [name for name, _ in sections]
    assert names[0] == "version" and bytes(sections[0][1]) == b"pokemon b", "expected Frost's Black patch"
    b_rom, w_rom = Path(args.black).read_bytes(), Path(args.white).read_bytes()
    assert b_rom[0x0C:0x10] == b"IRBO" and w_rom[0x0C:0x10] == b"IRAO", "expected US Black and US White"
    B, W = bw1.RomBinaries(args.black), bw1.RomBinaries(args.white)
    b_table, w_table = overlay_table(b_rom), overlay_table(w_rom)

    white = []
    for name, payload in sections:
        p = bytearray(payload)
        if name == "version":
            p = bytearray(b"pokemon w")
        elif name == "y9":
            remove, add = struct.unpack_from("<II", p, 0)
            assert remove == 0 and add == 0
            for o in range(8, len(p), 32):
                ov = struct.unpack_from("<I", p, o)[0]
                entry = transform_entry(w_table[ov * 32:ov * 32 + 32], p[o:o + 32], b_table[ov * 32:ov * 32 + 32])
                # The transform reproduces the Black patch's entry from Black's table.
                assert transform_entry(b_table[ov * 32:ov * 32 + 32], p[o:o + 32], b_table[ov * 32:ov * 32 + 32]) == bytes(p[o:o + 32])
                p[o:o + 32] = entry
        elif name == "arm9":
            spans = chunks(p, 1)
            for address, at, n in spans:
                if address == 0xFC4:  # the module parameters' compressed-static end: 0 (stored uncompressed)
                    assert w_rom and bytes(p[at:at + n]) == b"\0\0\0\0"
                    continue
                # The type icons' palette table: entry 17 (and the 3 bytes after it, unchanged, as Black writes them).
                start = address - TYPE_ICON_PALETTES
                retail_b = B.arm9[start:start + TYPE_ICON_PALETTES]
                assert bytes(p[at + 1:at + n]) == B.arm9[address + 1:address + n], "only entry 17 changes"
                found = [i for i in range(len(W.arm9) - TYPE_ICON_PALETTES) if W.arm9[i:i + TYPE_ICON_PALETTES] == retail_b]
                assert len(found) == 1, "the White type-icon palette table"
                w_address = found[0] + TYPE_ICON_PALETTES
                struct.pack_into("<I", p, at - 8, w_address)
                p[at + 1:at + n] = W.arm9[w_address + 1:w_address + n]
        elif name.startswith("ov_"):
            ov = int(name[3:])
            start, size, old_start, old_size = struct.unpack_from("<IIII", p, 0)
            b_base, b_data = B.overlays[ov]
            w_base, w_data = W.overlays[ov]
            assert old_start == b_base and old_size == len(b_data) and w_base == b_base + WHITE_SHIFT
            assert len(w_data) == len(b_data)
            struct.pack_into("<IIII", p, 0, start + WHITE_SHIFT, size, w_base, old_size)
            lead = b_base - start  # bytes prepended (overlay 93's prefix)
            for address, at, n in chunks(p, 16):
                if ov == 93 and address == 0:
                    assert n == PREFIX_SIZE == lead
                    for i in range(HANDLER_TABLE_ENTRIES):
                        move, handler = struct.unpack_from("<II", p, at + i * 8)
                        assert 0 < move < 0x400 and b_base <= handler & ~1 < b_base + len(b_data), (i, move, hex(handler))
                        struct.pack_into("<I", p, at + i * 8 + 4, handler + WHITE_SHIFT)
                    assert not any(p[at + HANDLER_TABLE_ENTRIES * 8:at + 0x1F03]), "nothing else before the helper"
                    continue
                o = address - lead
                retail_b, retail_w = b_data[o:o + n], w_data[o:o + n]
                pointers = POINTERS.get((name, address), [])
                for k in range(0, n, 4):
                    if k in pointers:
                        continue
                    if k + 4 <= n:
                        assert retail_b[k:k + 4] == retail_w[k:k + 4], f"{name} 0x{address:x}+{k}: a relocated word"
                    else:
                        assert retail_b[k:] == retail_w[k:], f"{name} 0x{address:x}+{k}"
                for k in pointers:
                    value = struct.unpack_from("<I", p, at + k)[0]
                    struct.pack_into("<I", p, at + k, value + WHITE_SHIFT)
        white.append((name, p))

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "fairy-b.bin").write_bytes(black_patch)
    (out_dir / "fairy-w.bin").write_bytes(serialize(white))
    print("fairy-b.bin", len(black_patch), "fairy-w.bin", len(serialize(white)))


if __name__ == "__main__":
    main()

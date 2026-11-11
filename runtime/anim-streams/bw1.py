"""Black / White inputs for the stream runtime build: symbols from the aletheia decomp, binaries from a clean ROM.

aletheia (a byte-matching decomp of Black and White) lists every function with its Black address in
`layout/function_addrs.tsv` and its White address in `layout/matched_white/<region>.json`.
"""
import csv
import json
import re
import struct
from pathlib import Path


class Bw1Symbols:
    """name -> (segment, address | thumb bit, size, isa) for one game ("B" or "W")."""

    def __init__(self, aletheia, game):
        self.game = game
        self.funcs = {}
        root = Path(aletheia) / "layout"
        white = {}
        if game == "W":
            for path in (root / "matched_white").glob("*.json"):
                for fn in json.loads(path.read_text()).get("functions", []):
                    if fn.get("white_address"):
                        white[(path.stem, int(fn["black_address"], 16))] = int(fn["white_address"], 16)
        with open(root / "function_addrs.tsv") as tsv:
            for row in csv.DictReader(tsv, delimiter="\t"):
                region = row["region"]
                if region == "arm9":
                    segment = "ARM9"
                elif re.fullmatch(r"ov\d+", region):
                    segment = str(int(region[2:]))
                else:
                    continue
                address = int(row["address"], 16)
                if game == "W":
                    address = white.get((region, address))
                    if address is None:
                        continue
                entry = (segment, address | (row["isa"] == "thumb"), int(row["size"]), row["isa"])
                self.funcs.setdefault(row["name"], entry)

    def get(self, name):
        if name not in self.funcs:
            raise KeyError(f"{self.game}: aletheia has no function {name}")
        return self.funcs[name]

    # The item expansion's link_dll interface.
    def resolve(self, name, segments):
        entry = self.funcs.get(name)
        if not entry or entry[0] not in segments:
            return None, None
        segment, address, size, isa = entry
        return segment, (address & ~1, "function", isa, size)

    def size_at(self, segment, address):
        for seg, addr, size, _ in self.funcs.values():
            if seg == segment and addr & ~1 == address:
                return size
        return None


def _blz(data):
    data = bytearray(data)
    header, extra = struct.unpack_from("<II", data, len(data) - 8)
    if extra == 0:
        return bytes(data)
    out = bytearray(len(data) + extra)
    out[: len(data)] = data
    src, dst, end = len(data) - (header >> 24), len(out), len(data) - (header & 0xFFFFFF)
    while src > end:
        src -= 1
        flags = data[src]
        for _ in range(8):
            if src <= end:
                break
            if flags & 0x80:
                src -= 2
                value = data[src] | data[src + 1] << 8
                for _ in range((value >> 12) + 3):
                    dst -= 1
                    out[dst] = out[dst + (value & 0xFFF) + 3]
            else:
                src -= 1
                dst -= 1
                out[dst] = data[src]
            flags = (flags << 1) & 0xFF
    return bytes(out)


class RomBinaries:
    """ARM9 (decompressed through its module params) and overlays (decompressed) of a clean ROM."""

    def __init__(self, rom_path):
        rom = Path(rom_path).read_bytes()
        offset, _, ram, size = struct.unpack_from("<IIII", rom, 0x20)
        arm9 = rom[offset: offset + size]
        params = arm9.find(struct.pack("<II", 0x2106C0DE, 0xDEC00621)) - 0x1C
        compressed_end = struct.unpack_from("<I", arm9, params + 0x14)[0]
        if compressed_end:
            arm9 = _blz(arm9[: compressed_end - ram]) + arm9[compressed_end - ram:]
        self.arm9, self.arm9_base = arm9, ram
        fat = struct.unpack_from("<I", rom, 0x48)[0]
        table, length = struct.unpack_from("<II", rom, 0x50)
        self.overlays = {}
        for n in range(length // 32):
            ov, base, size, _, _, _, file_id, flags = struct.unpack_from("<8I", rom, table + n * 32)
            start, end = struct.unpack_from("<II", rom, fat + file_id * 8)
            data = rom[start:end]
            if flags & 0x01000000:
                data = _blz(data)
            if len(data) != size:
                raise RuntimeError(f"overlay {ov}: {len(data)} bytes, table says {size}")
            self.overlays[ov] = (base, data)

    def read(self, segment, address, size):
        if segment == "ARM9":
            base, data = self.arm9_base, self.arm9
        else:
            base, data = self.overlays[int(segment)]
        if address < base or address + size > base + len(data):
            raise RuntimeError(f"{segment} {address:#x}+{size:#x} is outside the binary")
        return data[address - base: address - base + size]


class ExtractBinaries(RomBinaries):
    """The same from an extract directory: arm9.bin (decompressed) and arm9_overlays/ovNNN.bin + overlays.yaml."""

    def __init__(self, root):  # pylint: disable=super-init-not-called
        root = Path(root)
        self.arm9, self.arm9_base = (root / "arm9.bin").read_bytes(), 0x02004000
        self.overlays, current = {}, None
        for line in (root / "arm9_overlays/overlays.yaml").read_text().splitlines():
            match = re.match(r"\s*- id: (\d+)", line)
            if match:
                current = int(match.group(1))
            match = re.match(r"\s*base_address: (\d+)", line)
            if match and current is not None:
                self.overlays[current] = (int(match.group(1)), (root / f"arm9_overlays/ov{current:03d}.bin").read_bytes())

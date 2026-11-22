"""Measure the native PMC allocator from a fresh DS-mode boot."""

import argparse
from binascii import crc_hqx
from collections import Counter
import json
from pathlib import Path
from struct import unpack_from

from melonds import MelonDS


class Arm7StagingTrace:
    """Observe the reclaimed physical RAM, including all four DS mirrors."""

    def __init__(self, emu):
        self.before_pmc = Counter()
        self.with_pmc = Counter()
        self.allocations = []
        self.resets = 0
        self.active = False
        start, end = 0x0239ABA4, 0x023A8F84
        for mirror in range(0, 0x1000000, 0x400000):
            emu.memory.register_read(start + mirror, self._read, cpu="arm7", size=end - start)
            emu.memory.register_write(start + mirror, self._write, cpu="arm7", size=end - start)
            emu.memory.register_exec(start + mirror, self._exec, cpu="arm7", size=end - start)

        def create_pool(_cpu, _address):
            registers = emu.memory.register_arm9
            self.allocations.append([registers.r1, registers.r2])
            self.active = True

        def reset(_cpu, _address):
            self.resets += 1
            self.active = False

        emu.memory.register_exec(0x021FD3B6, create_pool)
        emu.memory.register_exec(0x0207C2C8, reset)

    def _record(self, kind):
        counters = self.with_pmc if self.active else self.before_pmc
        counters[kind] += 1

    def _read(self, *_args):
        self._record("read")

    def _write(self, *_args):
        self._record("write")

    def _exec(self, *_args):
        self._record("execute")

    def result(self):
        return {"beforePmc": dict(self.before_pmc), "whilePmcActive": dict(self.with_pmc),
                "allocations": self.allocations, "softResets": self.resets}


def measure(read):
    arena_end = read(0x02FFFDC4)
    area = arena_end
    start, size, free = (read(area + offset) for offset in (4, 8, 12))
    assert 0x02000000 <= start < start + size <= 0x023E0000
    free_headers = set()
    while free:
        assert start <= free < start + size and free not in free_headers
        free_headers.add(free)
        free = read(free + 4)
    cursor = start
    free_sizes = []
    while cursor < start + size:
        block = read(cursor)
        assert block % 8 == 0 and cursor + 16 + block <= start + size
        if cursor in free_headers:
            free_sizes.append(block)
        else:
            assert read(cursor + 12) == area
        cursor += 16 + block
    assert cursor == start + size and len(free_sizes) == len(free_headers)
    arm7_start, arm7_size = read(0x02FFFE38), read(0x02FFFE3C)
    return {"arena": hex(arena_end), "gameArenaEnd": hex(read(0x02FFFDA0)),
            "arm7ImageEnd": hex(arm7_start + arm7_size), "usableBytes": size, "freeBytes": sum(free_sizes),
            "largestFreeBytes": max(free_sizes, default=0)}


def validate_flash(image, block_table, expected_magic):
    assert len(image) == 0x80000
    footer_at = 0x25FA4 - 16
    counts = []
    for base in (0, 0x26000):
        count, size, magic, _, crc = unpack_from("<IIIHH", image, base + footer_at)
        assert size == 0x25FA4 and magic == expected_magic
        crcs_at = base + footer_at - 148
        assert crc_hqx(image[crcs_at:base + footer_at], 0xFFFF) == crc
        for i, (offset, size) in enumerate(block_table):
            start = base + offset
            expected, = unpack_from("<H", image, crcs_at + i * 2)
            stored, = unpack_from("<H", image, start + size + 2)
            assert stored == expected == crc_hqx(image[start:start + size], 0xFFFF), (base, i)
        counts.append(count)
    return counts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("rom", type=Path)
    parser.add_argument("library", type=Path)
    parser.add_argument("--screenshot", type=Path)
    parser.add_argument("--reject", type=lambda value: int(value, 0))
    parser.add_argument("--verify-flash", action="store_true")
    parser.add_argument("--trace-arm7", action="store_true")
    options = parser.parse_args()
    emu = MelonDS(options.library)
    try:
        emu.open(options.rom)
        read = emu.memory.read_long
        trace = Arm7StagingTrace(emu) if options.trace_arm7 else None
        emu.run_frames(650)
        if options.screenshot:
            emu.screenshot().save(options.screenshot)
        result = measure(read)
        ctrl = read(0x02140FA0)
        assert 0x02000000 <= ctrl < 0x023E0000
        save = read(ctrl + 16)
        assert 0x02000000 <= save < 0x023E0000
        save_data = read(save + 52)
        assert emu.memory.read_short(save_data - 44) == 0x5544
        assert emu.memory.read_short(save_data - 28) == 7
        result["saveBufferBytes"] = read(save_data - 40) - 28
        result["flashSaveSize"] = read(save + 48)
        result["flashMagic"] = hex(read(save + 12))
        result["loaded"] = emu.memory.read_byte(save + 28) == 1
        if trace:
            assert trace.before_pmc["read"] > 0 and len(trace.allocations) == 1
            assert not trace.with_pmc, trace.result()
            result["arm7Trace"] = trace.result()
        if options.reject is not None:
            result["rejection"] = read(options.reject)
        if options.verify_flash:
            assert result["loaded"]
            table = read(save + 44)
            blocks = read(table + 20)
            layout = [(read(blocks + i * 12 + 8), read(blocks + i * 12 + 4)) for i in range(read(table + 4))]
            assert len(layout) == 73
            result["flashCounts"] = validate_flash(options.rom.with_suffix(".sav").read_bytes(), layout, read(save + 12))
        print(json.dumps(result), flush=True)
    finally:
        emu.destroy()


if __name__ == "__main__":
    main()

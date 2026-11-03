"""Run the built hooks inside each game's retail phenomenon handler (Unicorn).

Links the compiled runtime at a fixed address, redirects the three native call
sites to its thunks and executes the retail code from the roll argument to the
battle or item-script call, with the retail ARM9 random generator. Each case
checks the outcome distribution against its configuration. Run build.py first.
Uses the same --dumps directory or workspace ROMs as build.py.
"""
import argparse
import struct
import subprocess
from pathlib import Path

from unicorn import UC_ARCH_ARM, UC_HOOK_CODE, UC_MODE_THUMB, Uc
from unicorn.arm_const import UC_ARM_REG_R1, UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_SP, UC_CPU_ARM_946

import build

BASE = 0x02300000
SPOT = 0x02380000
STACK = 0x023F0000
RNG = 0x02390000


def encode(dust_permille=400, shadow_permille=200, dust=(), shadow=(), groups=(), magic=0x314E4850):
    def table(entries):
        out = struct.pack("<HH", len(entries), 0) + b"".join(struct.pack("<HH", i, w) for i, w in entries)
        return out + bytes(196 - len(out))
    body = struct.pack("<IHHHH", magic, 1, len(groups), dust_permille, shadow_permille) + table(dust) + table(shadow)
    for kind, zones, permille, items in groups:
        g = struct.pack("<BBH", kind, len(zones), 0xFFFF if permille is None else permille)
        g += struct.pack("<%dH" % len(zones), *zones) + bytes(64 - 2 * len(zones)) + table(items)
        body += g
    body += bytes(2516 - len(body))
    assert len(body) == 2516
    return body


class Harness:
    def __init__(self, game, spec, image):
        self.game, self.spec = game, spec
        # Thumb trampolines to the retail functions (the DLL gets these from PMC).
        stubs = build.BUILD / f"verifyStubs{game}.s"
        stubs.write_text(".syntax unified\n.thumb\n.text\n" + "".join(
            f".global {name}\n.type {name},%function\n.thumb_func\n{name}:\n ldr r3, ={address | 1:#x}\n bx r3\n.ltorg\n"
            for name, address in (("Phen_NativeRandom", spec["random"]), ("Phen_NativeDustItem", spec["nativeDust"]),
                                  ("Phen_NativeShadowItem", spec["nativeShadow"]))))
        stub_obj = build.BUILD / f"verifyStubs{game}.o"
        build.run(build.TOOLS / "arm-none-eabi-as", "-mthumb", "-march=armv5t", stubs, "-o", stub_obj)
        objs = [build.BUILD / f"phenomena{game}.o", build.BUILD / f"hooks{game}.o", stub_obj]
        elf = build.BUILD / f"verify{game}.elf"
        build.run(build.TOOLS / "arm-none-eabi-ld", f"-Ttext=0x{BASE:x}", "-e", "0", *objs, "-o", elf)
        binary = build.BUILD / f"verify{game}.bin"
        build.run(build.TOOLS / "arm-none-eabi-objcopy", "-O", "binary", elf, binary)
        nm = subprocess.check_output([str(build.TOOLS / "arm-none-eabi-nm"), str(elf)], text=True)
        self.sym = {line.split()[2]: int(line.split()[0], 16) for line in nm.splitlines() if len(line.split()) == 3}
        u = self.u = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        u.ctl_set_cpu_model(UC_CPU_ARM_946)
        u.mem_map(0x02000000, 0x400000)
        u.mem_write(image.arm9_ram, image.arm9)
        overlay = bytearray(image.overlay)
        t = spec["trigger"]
        for key, thunk in (("roll", "Roll"), ("shadow", "Shadow"), ("dust", "Dust")):
            site = t + spec[key]
            target = self.sym[f"THUMB_BRANCH_LINK_{spec['overlay']}_0x{site:x}"]
            overlay[site - image.overlay_ram:site - image.overlay_ram + 4] = build.thumb_bl(site, target)
        u.mem_write(image.overlay_ram, bytes(overlay))
        u.mem_write(BASE, binary.read_bytes())
        # Point the retail generator at a seeded state with the GFL LCG constants.
        literal = struct.unpack("<I", image.read((spec["random"] + 4 + 4 + 40) & ~3, 4))[0]
        u.mem_write(literal + (16 if spec["overlay"] == 21 else 20), struct.pack("<I", RNG))
        u.mem_write(RNG, struct.pack("<QQQ", 0x1234567890ABCDEF, 0x5D588B656C078965, 0x269EC3))
        self.config = self.sym["Phen_Config"]
        self.start = t + spec["roll"] - 4
        # Retail call sites reached after the decision: item script (r1 = item) or wild battle.
        bw2 = spec["overlay"] == 36
        self.item_calls = {t + o for o in ((0x88, 0xB4) if bw2 else (0x84,))}
        self.battle_call = t + (0xC2 if bw2 else 0xA6)
        for site in [*self.item_calls, self.battle_call]:
            build.bl_target(image.read(site, 4), 0, site)

    def configure(self, data):
        self.u.mem_write(self.config, data)

    def trial(self, kind, zone=0):
        u = self.u
        u.mem_write(SPOT, struct.pack("<H", zone) + bytes(10) + bytes([kind, 1]) + bytes(2))
        u.reg_write(UC_ARM_REG_R4, SPOT)
        u.reg_write(UC_ARM_REG_R5, 0x02381000)
        u.reg_write(UC_ARM_REG_SP, STACK)
        result = {}

        def hook(uc, address, size, data):
            if address in self.item_calls:
                result["item"] = uc.reg_read(UC_ARM_REG_R1)
                uc.emu_stop()
            elif address == self.battle_call:
                result["battle"] = True
                uc.emu_stop()
        handle = u.hook_add(UC_HOOK_CODE, hook, begin=self.spec["trigger"], end=self.spec["trigger"] + 0x124)
        try:
            u.emu_start(self.start | 1, 0, count=200000)
        finally:
            u.hook_del(handle)
        assert result, f"{self.game}: no outcome"
        return result


def distribution(h, kind, n, zone=0):
    battles, items = 0, {}
    for _ in range(n):
        r = h.trial(kind, zone)
        if "battle" in r: battles += 1
        else: items[r["item"]] = items.get(r["item"], 0) + 1
    return battles / n, items


def close(value, expected, tolerance, label):
    assert abs(value - expected) <= tolerance, f"{label}: {value:.3f} != {expected:.3f}"


def check(game, spec, image):
    h = Harness(game, spec, image)
    n = 4000
    # Bare DLL: native thresholds and native item pickers.
    rate, items = distribution(h, 7, n)
    close(rate, 0.2, 0.03, f"{game} default shadow battle rate")
    assert set(items) <= set(build.WINGS + [build.PRETTY_WING]), items
    close(items.get(build.PRETTY_WING, 0) / (n * (1 - rate)), 0.1, 0.03, f"{game} default Pretty Wing")
    rate, items = distribution(h, 4, n)
    close(rate, 0.4, 0.03, f"{game} default dust battle rate")
    assert set(items) <= set(build.GEMS + [build.EVERSTONE] + list(range(72, 76)) + [80, 81, 82, 83, 84, 85, 107, 108, 109, 110]), items
    # Configured odds and weighted tables.
    h.configure(encode(1000, 0, dust=[(1, 1)], shadow=[(42, 3), (43, 1)]))
    assert distribution(h, 4, 300)[0] == 1.0, "dust always battles"
    rate, items = distribution(h, 7, n)
    assert rate == 0 and set(items) == {42, 43}, items
    close(items[42] / n, 0.75, 0.03, f"{game} weighted shadow item")
    h.configure(encode(0, 1000, dust=[(17, 1), (18, 0)], shadow=[(42, 1)]))
    rate, items = distribution(h, 4, 300)
    assert rate == 0 and items == {17: 300}, items
    assert distribution(h, 7, 300)[0] == 1.0
    # Zone groups: own encounter chance and items, inherited items, first match wins.
    h.configure(encode(0, 0, dust=[(5, 1)], shadow=[(6, 1)], groups=[(0, [100, 101], 500, [(7, 1)]), (0, [102], None, []), (1, [100], None, [(8, 1)])]))
    rate, items = distribution(h, 4, n, zone=101)
    close(rate, 0.5, 0.03, f"{game} zone encounter override")
    assert set(items) == {7}, items
    assert distribution(h, 4, 200, zone=102) == (0, {5: 200})
    assert distribution(h, 7, 200, zone=100) == (0, {8: 200})
    assert distribution(h, 7, 200, zone=103) == (0, {6: 200})
    # Invalid blocks fall back to native behavior.
    h.configure(encode(1000, 1000, magic=0))
    rate, _ = distribution(h, 4, n)
    close(rate, 0.4, 0.03, f"{game} invalid config dust fallback")
    h.configure(encode(0, 0))
    rate, items = distribution(h, 7, 500)
    assert rate == 0 and set(items) <= set(build.WINGS + [build.PRETTY_WING]), "empty table uses the native picker"
    # Other phenomena keep the native roll (always a battle).
    assert distribution(h, 0, 100)[0] == 1.0
    print(game, "hooks verified in the retail handler")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dumps", type=Path)
    args = parser.parse_args()
    for game, spec in build.GAMES.items():
        image = build.load_image(game, spec, args.dumps)
        if image is None:
            print(game, "skipped: clean ROM not available")
            continue
        check(game, spec, image)


if __name__ == "__main__":
    main()

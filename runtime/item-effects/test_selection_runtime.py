"""Exercise the compiled item selection adapter with isolated native-service stubs."""
from pathlib import Path
import os
import struct
import subprocess
import tempfile

from unicorn import Uc, UC_ARCH_ARM, UC_HOOK_CODE, UC_MODE_THUMB
from unicorn.arm_const import UC_ARM_REG_LR, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_SP

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TOOLS = Path(os.environ.get("ARM_TOOLCHAIN_BIN", ROOT.parent / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"))


def build_config():
    config = bytearray(1280)
    def add(item, conditions, category=1, move_type=18):
        struct.pack_into("<H", config, item * 2, len(config))
        config.extend((1, len(conditions), 0, 4))
        for op, argument, value in conditions:
            config.extend((op, argument, value & 255, value >> 8))
        config.extend((140, category, move_type, 0) + (0,) * 12)
    always = [(128, 0, 0)]
    add(85, always)
    add(86, always, category=0, move_type=9)
    add(87, [(1, 0, 50), (128, 1, 0)])
    add(88, [(6, 0, 0), (5, 0, 9), (129, 2, 0)])
    add(89, [(3, 0, 1), (128, 1, 0)])
    return bytes(config)


def main():
    with tempfile.TemporaryDirectory(prefix="pokeweb-item-selection-") as directory:
        out = Path(directory)
        script = out / "rules.ld"
        script.write_text("SECTIONS { . = 0x02100000; .text : { *(.text*) *(.rodata*) } .data : { *(.data*) } .bss : { *(.bss*) *(COMMON) } }\n")
        def run(tool, *args):
            return subprocess.run([str(TOOLS / f"arm-none-eabi-{tool}"), *map(str, args)], check=True, capture_output=True, text=True).stdout
        run("gcc", "-std=c11", "-mthumb", "-mcpu=arm946e-s", "-Os", "-ffreestanding", "-fno-builtin", "-fno-jump-tables", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables", "-fvisibility=hidden", "-c", HERE / "rules_v7.c", "-o", out / "rules.o")
        run("ld", "-T", script, out / "rules.o", "-o", out / "rules.elf")
        run("objcopy", "-O", "binary", out / "rules.elf", out / "rules.bin")
        symbols = {parts[2]: int(parts[0], 16) for line in run("nm", "-n", out / "rules.elf").splitlines() if len(parts := line.split()) == 3}
        emu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        emu.mem_map(0x02000000, 0x400000)
        emu.mem_write(0x02100000, (out / "rules.bin").read_bytes())
        emu.mem_write(0x02200000, build_config())
        def word(address, value): emu.mem_write(address, struct.pack("<I", value))
        word(symbols["ItemRuleData"], 0x02200000)
        for index in range(51):
            word(symbols["ItemRuleApi"] + index * 4, 0x02010001 + index * 16)
            emu.mem_write(0x02010000 + index * 16, b"\x70\x47")  # bx lr
        stop = 0x0200f000
        emu.mem_write(stop, b"\x70\x47")
        state = {"held": 85, "usable": 1, "native": 0, "hp": 100, "calls": []}
        def trace(uc, address, _size, _context):
            if address == stop:
                uc.emu_stop()
                return
            if not 0x02010000 <= address < 0x02010400 or (address - 0x02010000) % 16:
                return
            index = (address - 0x02010000) // 16
            args = [uc.reg_read(reg) for reg in (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3)]
            state["calls"].append(index)
            values = {48: lambda: state["native"], 33: lambda: state["held"], 49: lambda: state["usable"],
                      17: lambda: 0 if args[0] == 45 else 1, 50: lambda: 9 if args[0] == 52 else 0,
                      15: lambda: 0, 3: lambda: state["hp"] if args[1] == 13 else 100, 6: lambda: 1}
            if index not in values: raise AssertionError(("Unexpected native service", index, args))
            uc.reg_write(UC_ARM_REG_R0, values[index]())
        emu.hook_add(UC_HOOK_CODE, trace)
        def select(move, held=85, usable=1, native=0, hp=100):
            state.update(held=held, usable=usable, native=native, hp=hp, calls=[])
            emu.mem_write(0x02040000, bytes(36))
            for reg, value in ((UC_ARM_REG_R0, 0x02020000), (UC_ARM_REG_R1, 0x02030000), (UC_ARM_REG_R2, move),
                               (UC_ARM_REG_R3, 0x02040000), (UC_ARM_REG_SP, 0x023ff000), (UC_ARM_REG_LR, stop | 1)):
                emu.reg_write(reg, value)
            emu.emu_start(symbols["RuleItemSelect"] | 1, 0, count=100000)
            return emu.reg_read(UC_ARM_REG_R0), struct.unpack("<H", bytes(emu.mem_read(0x02040000, 2)))[0]
        assert select(45) == (1, 905) and select(33) == (0, 0) and select(52) == (0, 0)
        assert select(45, usable=0) == (0, 0) and select(45, held=0) == (0, 0)
        assert select(165) == (0, 0) and select(33, native=1) == (1, 0)
        assert select(52, held=86) == (1, 905) and select(45, held=86) == (0, 0)
        assert select(45, held=87, hp=100) == (0, 0) and select(45, held=87, hp=40) == (1, 905)
        assert select(45, held=88) == (1, 905) and select(33, held=88) == (0, 0)
        word(symbols["lastFlow"], 0x02050000)
        assert select(33, held=89) == (0, 0) and 6 not in state["calls"]
        assert select(45, held=89) == (1, 905) and state["calls"].count(6) == 1
    print("Item selection runtime: status, type, conditions, suppression and weather query checks passed.")


if __name__ == "__main__":
    main()

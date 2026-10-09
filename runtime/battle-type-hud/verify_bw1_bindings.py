"""Execute retail BW1 mode/proxy getters and compiled mode-aware RAM checks.

This verifies selected native ABIs, not the pending icon renderer or gameplay.
"""
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'summary-stat-viewer/build/python'))
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_ARM, UC_HOOK_CODE
from unicorn.arm_const import *
from configure_bw1 import HERE, WORKSPACE, load

TOOLS = Path(os.environ.get('BTH_TOOLCHAIN_BIN', os.environ.get('ARM_TOOLCHAIN_BIN', WORKSPACE / 'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin')))
STOP, STACK = 0x02008000, 0x023f0000
REGS = [UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3,
        UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7,
        UC_ARM_REG_R8, UC_ARM_REG_R9, UC_ARM_REG_R10, UC_ARM_REG_R11]


def main():
    for game, default in [('B', WORKSPACE / 'cleanblack.nds'), ('W', Path.home() / 'Downloads/cleanroms/cleanwhite.nds')]:
        profile = json.loads((HERE / f'profile-TypeIcons-{game}.json').read_text())
        _, blobs = load(os.environ.get(f'BTH_{game}_ROM', default), b'IRBO' if game == 'B' else b'IRAO')
        for sig in profile['signatures']:
            base, data = blobs[sig['segment']]
            at = sig['address'] - base
            assert data[at:at + len(bytes.fromhex(sig['bytes']))].hex() == sig['bytes']
        build = HERE / 'build'
        source, elf = build / 'bw1-pointer-probe.cpp', build / f'bw1-pointer-probe-{game}.elf'
        source.write_text('#include "../hud_common.h"\nextern "C" unsigned ValidatePointer(unsigned p) { return ram(reinterpret_cast<void*>(p)); }\n')
        subprocess.run([str(TOOLS / 'arm-none-eabi-g++'), '-std=c++14', '-mthumb', '-march=armv5t', '-Os',
                        '-ffreestanding', '-fno-builtin', '-fno-exceptions', '-fno-rtti', '-nostdlib',
                        '-fno-unwind-tables', '-fno-asynchronous-unwind-tables', f'-DGAME_{game}',
                        '-Wl,-Ttext=0x2300000,-e,ValidatePointer', str(source), '-o', str(elf)], check=True)
        cpu = Uc(UC_ARCH_ARM, UC_MODE_ARM)
        cpu.ctl_set_cpu_model(UC_CPU_ARM_946)
        cpu.mem_map(0x02000000, 0x1000000)
        cpu.mem_map(0x04000000, 0x10000)
        for base, data in blobs.values():
            cpu.mem_write(base, bytes(data))
        with elf.open('rb') as f:
            binary = ELFFile(f)
            for sec in binary.iter_sections():
                if sec['sh_flags'] & 2 and sec['sh_type'] != 'SHT_NOBITS':
                    cpu.mem_write(sec['sh_addr'], sec.data())
            probe = next(s['st_value'] for s in binary.get_section_by_name('.symtab').iter_symbols() if s.name == 'ValidatePointer')
        addresses = profile['functions']
        mode = addresses['IsDsi']
        assert not mode & 1, 'BW1 mode getter is ARM'
        state = struct.unpack('<I', cpu.mem_read(mode + 68, 4))[0]
        hardware = struct.unpack('<I', cpu.mem_read(mode + 72, 4))[0]
        assert hardware == 0x04004000
        calls = []
        cpu.hook_add(UC_HOOK_CODE, lambda _u, a, _n, _d: calls.append(a), begin=mode, end=mode)

        def write(address, value):
            cpu.mem_write(address, struct.pack('<I', value))

        def invoke(entry, *args):
            cpu.reg_write(UC_ARM_REG_CPSR, 0x1f)
            for i, reg in enumerate(REGS):
                cpu.reg_write(reg, args[i] if i < len(args) else 0x11110000 + i)
            cpu.reg_write(UC_ARM_REG_SP, STACK)
            cpu.reg_write(UC_ARM_REG_LR, STOP | 1)
            cpu.emu_start(entry, STOP, count=100000)
            assert cpu.reg_read(UC_ARM_REG_PC) == STOP
            assert cpu.reg_read(UC_ARM_REG_SP) == STACK
            assert [cpu.reg_read(r) for r in REGS[4:]] == [0x11110000 + i for i in range(4, 12)]
            return cpu.reg_read(UC_ARM_REG_R0)

        for device, expected in [(0, 0), (1, 1), (2, 0), (3, 0)]:
            write(state + 28, 0)
            cpu.mem_write(hardware, bytes([device]))
            assert invoke(mode) == expected
            assert struct.unpack('<I', cpu.mem_read(state + 28, 4))[0] == 1
            # Native cached result remains stable after the hardware byte changes.
            cpu.mem_write(hardware, bytes([device ^ 1]))
            assert invoke(mode) == expected
        for dsi in (0, 1):
            write(state + 28, 1)
            write(state + 4, dsi)
            for pointer, result in [(0, False), (0x01fffffc, False), (0x02000000, True),
                                    (0x023ffffc, True), (0x02400000, bool(dsi)),
                                    (0x02800000, bool(dsi)), (0x02fffffc, bool(dsi)),
                                    (0x02800001, False), (0x03000000, False)]:
                before = len(calls)
                assert invoke(probe, pointer) == int(result), (game, dsi, hex(pointer))
                assert len(calls) - before == int(pointer in (0x02400000, 0x02800000, 0x02fffffc))
        for heap in (0x02200000, 0x02800000):
            values = [0xa5000000 + i for i in range(9)]
            cpu.mem_write(heap + 28, struct.pack('<9I', *values))
            invoke(addresses['GetProxy'], heap, heap + 0x100)
            assert bytes(cpu.mem_read(heap + 0x100, 36)) == struct.pack('<9I', *values)
        print(f'{game}: retail ARM mode getter/cache, compiled DS/DSi pointer bounds, nine-word proxy ABI, registers and stack passed; renderer/gameplay pending')


if __name__ == '__main__':
    main()

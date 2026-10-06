"""Exercise packaged PWAN guards and retail mode getters without running a game."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys

import ndspy.codeCompression
import ndspy.rom
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB
from unicorn.arm_const import *

HERE = Path(__file__).resolve().parent
APP = HERE.parents[1]
WORKSPACE = APP.parent
SOURCE = Path(os.environ.get('W2U_RUNTIME_ROOT', WORKSPACE.parent / 'White2Upgrade-Original-pokeweb'))
BUILD = SOURCE / 'build-stripped/src'
JAR = SOURCE / 'tools/CTRMap/CTRMapV-dirty.jar'
sys.path.insert(0, str(APP / 'runtime/battle-type-hud'))
from rpm_read import read_rpm, thumb_bl

BASE, STOP, STACK = 0x02300000, 0x02008000, 0x023ef000
REGS = [UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3]
SAVED = [UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7,
         UC_ARM_REG_R8, UC_ARM_REG_R9, UC_ARM_REG_R10, UC_ARM_REG_R11]


def load(module):
    code = bytearray(module['code']) + bytes(module['bss'])
    for relocation in module['relocations']:
        if relocation['module'] != 'base':
            continue
        symbol = module['symbols'][relocation['symbol']]
        assert not symbol['attributes'] & 2, 'Unexpected unresolved import'
        target = symbol['address'] + (0 if symbol['attributes'] & 4 else BASE)
        if symbol['type'] == 3:
            target |= 1
        at = relocation['address']
        if relocation['type'] == 'OFFSET':
            struct.pack_into('<I', code, at, target)
        elif relocation['type'] == 'THUMB_BRANCH_LINK':
            code[at:at + 4] = thumb_bl(BASE + at, target)
        else:
            raise AssertionError(relocation)
    return bytes(code)


def call(cpu, target, *arguments):
    for reg, value in zip(REGS, arguments):
        cpu.reg_write(reg, value)
    for i, reg in enumerate(SAVED):
        cpu.reg_write(reg, 0x12340000 + i)
    cpu.reg_write(UC_ARM_REG_SP, STACK)
    cpu.reg_write(UC_ARM_REG_LR, STOP | 1)
    cpu.emu_start(target | 1, STOP, count=100000)
    assert cpu.reg_read(UC_ARM_REG_PC) == STOP
    assert cpu.reg_read(UC_ARM_REG_SP) == STACK
    assert all(cpu.reg_read(reg) == 0x12340000 + i for i, reg in enumerate(SAVED))
    return cpu.reg_read(UC_ARM_REG_R0)


def check(game, rom_path):
    mode = 0x0207ac8c if game == 'B2' else 0x0207acb8
    expected_code = b'IREO' if game == 'B2' else b'IRDO'
    raw = rom_path.read_bytes()
    assert raw[12:16] == expected_code and raw[30] == 0
    rom = ndspy.rom.NintendoDSRom(raw)
    arm9 = ndspy.codeCompression.decompress(rom.arm9)
    at = mode - rom.arm9RamAddress
    native = bytes(arm9[at:at + 48])
    # Require the exact native bytes already verified by the HUD profile.
    profile = json.loads((APP / f'runtime/battle-type-hud/profile-{game}.json').read_text())
    signature = next(s for s in profile['signatures'] if s['name'] == 'IsDsi')
    assert native.hex() == signature['bytes']
    mode_cache = struct.unpack_from('<I', native, 40)[0]
    results = []
    for scope in ('Summary', 'Battle', 'Misc', 'Trainer'):
        name = f'PokewebPwan{scope}{game}'
        debug = HERE / f'build/{name}.dll'
        debug.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(['java', '-cp', str(JAR), 'rpm.cli.RPMTool', '-i', str(BUILD / f'{name}.elf'),
                        '--fourcc', 'DLXF', '-o', str(debug), '--esdb', str(SOURCE / f'pmc/{expected_code.decode()}.yml'),
                        '--generate-relocations'], check=True, stdout=subprocess.DEVNULL)
        module = read_rpm(debug.read_bytes())
        shipped_bytes = (APP / f'src/assets/codeinjection/{name}.dll').read_bytes()
        shipped = read_rpm(shipped_bytes)
        # Names are needed only for locating functions. Execute shipped bytes.
        assert module['code'] == shipped['code'] and module['bss'] == shipped['bss']
        functions = {s['name']: BASE + s['address'] for s in module['symbols']
                     if s['type'] == 3 and not s['attributes'] & 6}
        guards = {n: a for n, a in functions.items() if 'IsLikelyMainRamPointer' in n
                  or 'IsAlignedMainRamPtr' in n or n == '_ZN3w2u12trainer_animL7MainRamEPKv'}
        assert guards, f'{name} has no production pointer guard'
        cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
        cpu.ctl_set_cpu_model(UC_CPU_ARM_946)
        cpu.mem_map(0x02000000, 0x1000000)
        cpu.mem_map(0x04000000, 0x10000)
        cpu.mem_write(BASE, load(shipped))
        cpu.mem_write(mode, native)
        for dsi in (0, 1):
            # Check both cached and cold detection against the real function.
            cpu.mem_write(mode_cache + 28, struct.pack('<I', 0))
            cpu.mem_write(0x04004000, struct.pack('<I', dsi))
            assert call(cpu, mode) == dsi
            assert struct.unpack('<I', cpu.mem_read(mode_cache + 28, 4))[0] == 1
            for n, target in guards.items():
                aligned = 'IsAligned' in n
                for pointer, want in ((0, 0), (0x02000000, 1), (0x023ffffc, 1),
                                      (0x02820000, dsi), (0x02fffffc, dsi),
                                      (0x03000000, 0), (0x02820001, 0 if aligned else dsi)):
                    assert call(cpu, target, pointer) == want, (n, dsi, hex(pointer))
        results.append(dict(artifact=f'{name}.dll', sha256=hashlib.sha256(shipped_bytes).hexdigest(),
                            bytes=len(shipped_bytes), bss=shipped['bss'], guardFunctions=len(guards),
                            rangeChecks=True, coldAndCachedMode=True, registerAndStackPreservation=True))
    return results


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('white2', type=Path)
    parser.add_argument('black2', type=Path)
    args = parser.parse_args()
    result = dict(format=1, scope='Isolated compiled pointer guards; no game or display timing certification.',
                  games={game: check(game, path) for game, path in [('W2', args.white2), ('B2', args.black2)]})
    (HERE / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
    print('Eight shipped PWAN DLLs passed DS/DSi range, alignment, mode-query and register/stack checks.')

"""Execute the linked ARM946 Fly hooks with controlled native spawn calls."""
from pathlib import Path
import struct
import subprocess
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_CPU_ARM_946, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_SP

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parents[2] / 'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'
BASE, LOADER, STOP, WORK, STACK = 0x02300000, 0x022f0000, 0x022f0100, 0x02310000, 0x023f0000


def prepare(version):
    output = HERE / 'build' / f'verify_{version}.elf'
    subprocess.run([str(TOOLS / 'arm-none-eabi-ld'), '-Ttext', hex(BASE), '-Tdata', hex(BASE + 0x10000),
                    '--defsym', f'LoadZoneSpawnInfoCheckRail={LOADER | 1}',
                    str(HERE / 'build' / f'FlyDestinations{version}.elf'), '-o', str(output)], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    with output.open('rb') as f:
        elf = ELFFile(f)
        symbols = {s.name: s['st_value'] for s in elf.get_section_by_name('.symtab').iter_symbols()}
        sections = [(s['sh_addr'], s.data()) for s in elf.iter_sections() if s['sh_flags'] & 2 and s['sh_type'] != 'SHT_NOBITS']
    return symbols, sections


def cpu(prepared):
    symbols, sections = prepared
    u = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    u.ctl_set_cpu_model(UC_CPU_ARM_946)
    u.mem_map(0x02000000, 0x400000)
    for address, data in sections:
        u.mem_write(address, data)
    u.reg_write(UC_ARM_REG_SP, STACK)
    u.reg_write(UC_ARM_REG_LR, STOP | 1)
    return u, symbols


def fly_case(prepared, selected, override, rail=False):
    u, symbols = cpu(prepared)
    config = symbols['FlyDestinationConfig']
    for i, (zone, xyz) in enumerate(override.items()):
        u.mem_write(config + 12 + 16 * i, struct.pack('<HHiii', zone, 1, *xyz))
    u.mem_write(WORK, bytes([0xa5]) * 64)
    spawn = WORK + 12
    u.reg_write(UC_ARM_REG_R0, spawn)
    u.reg_write(UC_ARM_REG_R1, selected)
    calls = []

    def intercept(emu, address, size, data):
        if address == STOP:
            emu.emu_stop()
        elif address == LOADER:
            pointer, zone = emu.reg_read(UC_ARM_REG_R0), emu.reg_read(UC_ARM_REG_R1)
            calls.append(zone)
            original = struct.pack('<IhHhHI', 1, zone, 65535, 2, 0, int(rail))
            position = struct.pack('<HBBhHI', 2, 1, 0, -1, 9, 0) if rail else struct.pack('<iii', 430 << 16, 0, 491 << 16)
            emu.mem_write(pointer, original + position)
            emu.reg_write(UC_ARM_REG_PC, emu.reg_read(UC_ARM_REG_LR))
    u.hook_add(UC_HOOK_CODE, intercept)
    u.emu_start(symbols['Fly_LoadSpawn'] | 1, STOP, count=10000)
    result = bytes(u.mem_read(spawn, 28))
    assert calls == [326 if selected == 490 else selected]
    assert struct.unpack('<I', u.mem_read(WORK + 8, 4))[0] == calls[0]
    assert bytes(u.mem_read(WORK, 8)) == bytes([0xa5]) * 8
    assert bytes(u.mem_read(WORK + 40, 24)) == bytes([0xa5]) * 24
    expected = override.get(selected)
    if rail:
        actual = struct.unpack('<HBBhH', result[16:24])
        assert actual == ((expected[0], 1, 0, expected[2], expected[1]) if expected else (2, 1, 0, -1, 9))
    else:
        assert struct.unpack('<iii', result[16:28]) == tuple(n * 65536 for n in (expected or (430, 0, 491)))


def marker_case(prepared, kind, flyable, parameter, expected):
    u, symbols = cpu(prepared)
    place, table = WORK, WORK + 0x100
    data = bytearray(68)
    struct.pack_into('<II', data, 4, table, 0)
    struct.pack_into('<9i', data, 12, *range(100, 109))
    struct.pack_into('<I', data, 60, flyable)
    u.mem_write(place, bytes(data))
    row = bytearray(54); struct.pack_into('<H', row, 22, kind); struct.pack_into('<H', row, 26, 432)
    u.mem_write(table, bytes(row))
    u.reg_write(UC_ARM_REG_R0, place); u.reg_write(UC_ARM_REG_R1, parameter)
    u.hook_add(UC_HOOK_CODE, lambda emu, address, *_: emu.emu_stop() if address == STOP else None)
    u.emu_start(symbols['Fly_PlaceParameter'] | 1, STOP, count=1000)
    assert u.reg_read(UC_ARM_REG_R0) == expected
    assert bytes(u.mem_read(table, 54)) == bytes(row)


def main():
    count = 0
    for version in ('B2', 'W2'):
        prepared = prepare(version)
        overrides = {326: (432, -1, 490), 490: (430, 0, 491)}
        for zone in (326, 490, 427):
            fly_case(prepared, zone, overrides); count += 1
        fly_case(prepared, 28, {28: (3, 20, -2)}, True); count += 1
        fly_case(prepared, 28, {}, True); count += 1
        for args in [(1, 1, 11, 3), (1, 0, 11, 1), (0, 1, 11, 0), (1, 1, 12, 1), (1, 1, 2, 100), (1, 1, 10, 108), (1, 1, 13, 432)]:
            marker_case(prepared, *args); count += 1
    print(f'{count} ARM946 cases passed: independent Route 4/Join Avenue, unchanged defaults, rail ABI and conditional route markers. Native loader calls are controlled stubs; this is not gameplay testing.')


if __name__ == '__main__':
    main()

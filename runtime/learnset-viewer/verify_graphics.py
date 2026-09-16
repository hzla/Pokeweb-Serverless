"""Regression for the 1.0.1 green background, using retail buffer routines.

Usage: python3 runtime/learnset-viewer/verify_graphics.py [GREEN_SCREEN.dst]
Uses synthetic BG fixtures, optionally captured W2 memory. Runs only the compiled
screen wrapper and retail memory-copy/BG functions. No game boot or frames.
"""
from pathlib import Path
import os
import struct
import subprocess
import sys
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE/'build/python'))
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_CPU_ARM_946, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC
import ndspy.rom
import ndspy.narc
import ndspy.codeCompression
from verify_dst import read_ram

WORKSPACE = HERE.parents[2]
TOOLS = Path(os.environ.get('ARM_TOOLCHAIN_BIN', WORKSPACE/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
REGS = [UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7]
BASE, DATA, RESOURCE, STOP, STACK = 0x02e00000, 0x02e80000, 0x02ea0000, 0x02ee0000, 0x02ef0000

for game, delta, filename in [('W2', 0, 'cleanwhite2.nds'), ('B2', 0x2c, 'cleanblack2.nds')]:
    rom = ndspy.rom.NintendoDSRom.fromFile(Path(os.environ.get(f'LEARNSET_{game}_ROM', WORKSPACE/filename)))
    resource = bytes(ndspy.narc.NARC(rom.getFileByName('a/1/2/5')).files[2])
    assert resource[:4] == b'RCSN' and len(resource) == 2084
    expected = bytearray(resource[36:])
    for y in range(8, 21):
        row = y*64
        expected[row+42:row+46] = expected[row+36:row+40]
        expected[row+36:row+42] = expected[row+34:row+36]*3
    c = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    c.ctl_set_cpu_model(UC_CPU_ARM_946)
    c.mem_map(0x02000000, 0x1000000)
    captured_mode = game == 'W2' and len(sys.argv) > 1
    if captured_mode:
        captured = read_ram(Path(sys.argv[1]))
        c.mem_write(0x02000000, captured)
    else:
        c.mem_write(rom.arm9RamAddress, bytes(ndspy.codeCompression.decompress(rom.arm9)))
    read32 = lambda p: struct.unpack('<I', c.mem_read(p, 4))[0]
    write32 = lambda p, n: c.mem_write(p, struct.pack('<I', n))
    # GetScreenBuffer's PC-relative literal points at the game's BG singleton.
    getter = 0x2045840-delta
    ldr = struct.unpack('<H', c.mem_read(getter, 2))[0]
    assert ldr & 0xff00 == 0x4900
    global_bg = read32(((getter+4)&~3) + (ldr&255)*4)
    if not captured_mode:
        write32(global_bg, 0x2270000)
        write32(0x2270000+7*44+8, 0x2272000)
        write32(0x2270000+7*44+12, 4096)
    bg = read32(global_bg)
    buffer = read32(bg+7*44+8)
    assert read32(bg+7*44+12) == 4096
    assert bytes(c.mem_read(buffer, 4096)) == bytes(4096), 'Expected an empty lower BG buffer'
    source = HERE/f'build/LearnsetViewer{game}.elf'
    linked = HERE/f'build/graphics-{game}.elf'
    subprocess.run([str(TOOLS/'arm-none-eabi-ld'), '-Ttext', hex(BASE), '-Tdata', hex(DATA), '-e', 'LearnsetScreen', str(source), '-o', str(linked)], check=True, capture_output=True)
    with linked.open('rb') as stream:
        elf = ELFFile(stream)
        symbols = {s.name: s['st_value'] for s in elf.get_section_by_name('.symtab').iter_symbols() if s.name and s['st_shndx'] != 'SHN_UNDEF'}
        for section in elf.iter_sections():
            if section['sh_flags'] & 2 and section['sh_type'] != 'SHT_NOBITS':
                c.mem_write(section['sh_addr'], section.data())
    write32(symbols['_ZN12_GLOBAL__N_16activeE'], DATA+0x1000)
    r = lambda n: c.reg_read(REGS[n])
    video = bytearray(4096)
    freed = []
    def ret(value=0):
        c.reg_write(REGS[0], value)
        c.reg_write(UC_ARM_REG_PC, c.reg_read(UC_ARM_REG_LR))
    def intercept(_c, pc, size, user):
        if pc == STOP:
            c.emu_stop()
        elif pc == 0x204b358-delta:  # Only the archive I/O is stubbed.
            assert (r(1), r(2)) == (2, 0)
            c.mem_write(RESOURCE, resource)
            write32(r(3), RESOURCE+24)
            ret(RESOURCE)
        elif pc == 0x203a278-delta:
            assert r(0) == RESOURCE
            freed.append(r(0))
            c.mem_write(RESOURCE, bytes([0xa5])*len(resource))
            ret()
        elif pc == 0x20461c4-delta:  # Final hardware transfer boundary.
            assert r(0) == 7 and r(2) == 0 and r(3) in (2048, 4096)
            video[:r(3)] = c.mem_read(r(1), r(3))
            ret()
    c.hook_add(UC_HOOK_CODE, intercept)
    def call(address, args):
        for i in range(8):
            c.reg_write(REGS[i], args[i] if i < min(4, len(args)) else 0x11110000+i)
        for i, arg in enumerate(args[4:]):
            write32(STACK+i*4, arg)
        c.reg_write(UC_ARM_REG_SP, STACK)
        c.reg_write(UC_ARM_REG_LR, STOP|1)
        c.emu_start(address|1, STOP, count=200000)
        assert c.reg_read(UC_ARM_REG_PC) == STOP and c.reg_read(UC_ARM_REG_SP) == STACK
        assert [r(i) for i in range(4, 8)] == [0x11110000+i for i in range(4, 8)]
    # Reproduce the former mistake: direct VRAM upload initially looks right,
    # but the real retail refresh immediately restores the empty CPU map.
    c.mem_write(RESOURCE, bytes(expected))
    call(0x2044fdd-delta, [7, RESOURCE, 2048, 0])
    assert video[:2048] == expected
    call(0x2044fbd-delta, [7])
    assert video == bytes(4096)
    before = bytes(c.mem_read(0x02000000, 0x400000))
    call(symbols['LearnsetScreen'], [0x2200000, 2, 7, 0, 2048, 0, 79])
    assert bytes(c.mem_read(buffer, 2048)) == expected and video[:2048] == expected
    for _ in range(3):
        call(0x2044fbd-delta, [7])
        assert video[:2048] == expected and video[2048:] == bytes(2048)
    after = bytes(c.mem_read(0x02000000, 0x400000))
    assert before[:buffer-0x02000000] == after[:buffer-0x02000000]
    assert before[buffer-0x02000000+2048:] == after[buffer-0x02000000+2048:]
    assert freed == [RESOURCE]
    print(game, 'old green-screen path reproduced; fixed CPU map and repeated native redraws match retail tiles + 24px divider; other game RAM unchanged')

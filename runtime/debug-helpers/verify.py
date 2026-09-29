"""Run release DLL hooks and native White 2 code in an ARM946 model.

Battle graphics services are instrumented; this is not full-game verification.
Requires ndspy, unicorn. Pass an original US White 2 ROM as the first argument.
"""
from pathlib import Path
import json
import struct
import sys
import ndspy.rom
import ndspy.codeCompression
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import *
from build import HERE, REPO, ROOT, PROFILES, read_rpm
from rpm_read import thumb_bl

ROM = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'cleanwhite2.nds'
rom = ndspy.rom.NintendoDSRom.fromFile(ROM)
assert rom.idCode == b'IRDO' and rom.version == 0
overlays = rom.loadArm9Overlays([36, 167, 169])
BASE, STOP, STACK = 0x02370020, 0x023ff000, 0x023f8000
HID, KEYS, MAIN, SETUP, VIEW, CONFIG = [0x023e0000 + i * 0x1000 for i in range(6)]

def put(uc, address, value): uc.mem_write(address, struct.pack('<I', value))
def get(uc, address): return struct.unpack('<I', uc.mem_read(address, 4))[0]

def machine(key):
    uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB)
    uc.ctl_set_cpu_model(UC_CPU_ARM_946)
    uc.mem_map(0x02000000, 0x400000)
    uc.mem_map(0x06890000, 0x10000)
    uc.mem_write(rom.arm9RamAddress, bytes(ndspy.codeCompression.decompress(rom.arm9)))
    for i in ([36] if key == 'walk-through-walls' else [167, 169] if key == 'instant-victory' else []):
        uc.mem_write(overlays[i].ramAddress, bytes(overlays[i].data))
    rpm = read_rpm((REPO / 'src/assets/codeinjection' / PROFILES[key]['file']).read_bytes())
    uc.mem_write(BASE, rpm['code'] + bytes(rpm['bss']))
    for r in rpm['relocations']:
        s = rpm['symbols'][r['symbol']]
        dest = s['address'] + (0 if s['attributes'] & 4 else BASE)
        site = r['address'] + (BASE if r['module'] == 'base' else 0)
        if r['type'] == 'OFFSET': put(uc, site, dest | (1 if s['type'] == 3 else 0))
        elif r['type'] == 'THUMB_BRANCH_LINK': uc.mem_write(site, thumb_bl(site, dest))
        elif r['type'] == 'THUMB_BRANCH':
            assert site % 4 == 0
            uc.mem_write(site, bytes.fromhex('004b1847') + struct.pack('<I', dest | 1))
        else: raise AssertionError(r)
    put(uc, 0x021418c4, HID)
    put(uc, HID, KEYS)
    uc.mem_write(HID + 0x3d, b'\x3c')
    return uc, rpm

def call(uc, pc, r0=0, stop=STOP, sp=STACK):
    uc.reg_write(UC_ARM_REG_R0, r0)
    uc.reg_write(UC_ARM_REG_SP, sp)
    uc.reg_write(UC_ARM_REG_LR, stop | 1)
    uc.emu_start(pc | 1, stop, count=10000)
    assert uc.reg_read(UC_ARM_REG_PC) == stop, hex(uc.reg_read(UC_ARM_REG_PC))
    return uc.reg_read(UC_ARM_REG_R0)

checks = []
uc, rpm = machine('walk-through-walls')
for rate in (30, 60):
    uc.mem_write(HID + 0x3d, bytes([rate]))
    # A complete chord toggles once; release/repress toggles back. Raw input
    # survives and published Start is consumed, including 30 Hz accumulators.
    for raw, expected in [(0, 0), (0x308, 1), (0x308, 1), (0x308, 1), (0x300, 1), (0x308, 0), (0, 0)]:
        put(uc, KEYS + 12, raw)
        for i in range(6, 15): put(uc, KEYS + 4 * i, raw | 0x10)
        result = call(uc, 0x02181d44, stop=0x02181d48)
        assert result == ((raw | 0x10) & (~8 if raw == 0x308 else 0xffffffff))
        assert get(uc, KEYS + 12) == raw
        for site, local, saved in [(0x0219c966, 24, [3, 4, 5, 6, 7, STOP | 1]), (0x0219cd22, 0, [3, 4, 5, STOP | 1])]:
            for mask in (0, 1, 2, 0x100, 0xffff):
                uc.mem_write(STACK + local, struct.pack('<' + 'I' * len(saved), *saved))
                uc.reg_write(UC_ARM_REG_R4, mask)
                assert call(uc, site) == (0 if expected else mask)
                assert uc.reg_read(UC_ARM_REG_SP) == STACK + local + len(saved) * 4
                assert uc.reg_read(UC_ARM_REG_R4) == 4
checks.append('Field shortcut edge/release, 30/60 Hz Start suppression, raw keys, normal/catwalk return masks and stack restoration')

# Execute the native message getters, including script FAST/SLOW conversion.
uc, rpm = machine('instant-fast-text')
put(uc, 0x0209a378, SETUP)
def config_service(u, address, size, data):
    if address == 0x02008ddc:
        u.reg_write(UC_ARM_REG_R0, CONFIG)
        u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))
uc.hook_add(UC_HOOK_CODE, config_service)
for option, normal, fast, slow in [(0, 3, 1, 6), (1, 1, -2, 3), (2, -128, -128, 1)]:
    uc.mem_write(CONFIG, struct.pack('<H', 0x6f0 | option))
    for pc, expected in [(0x02017bcc, normal), (0x02017bf0, fast), (0x02017c20, slow)]:
        assert call(uc, pc) == expected & 0xffffffff
    assert bytes(uc.mem_read(CONFIG, 2)) == struct.pack('<H', 0x6f0 | option)
    assert call(uc, 0x02017c50, 99) == 6
checks.append('Native normal/FAST/SLOW text getters, all options, invalid-index fallback, unchanged saved options')

for kind, comm, replay, result, error, enabled in [
    (0, 0, 0, 7, 0, True), (1, 0, 0, 7, 0, True),
    (2, 0, 0, 7, 0, False), (3, 1, 0, 7, 0, False), (4, 0, 0, 7, 0, False),
    (0, 1, 0, 7, 0, False), (0, 0, 1, 7, 0, False), (0, 0, 0, 1, 0, False), (0, 0, 0, 7, 1, False),
]:
    uc, rpm = machine('instant-victory')
    put(uc, MAIN, SETUP); put(uc, MAIN + 4, VIEW)
    put(uc, MAIN + 0x464, 0x023fd001)
    put(uc, SETUP, kind); put(uc, MAIN + 0x444, result)
    uc.mem_write(SETUP + 0x20, bytes([comm, 0, 0, replay]))
    uc.mem_write(MAIN + 0x473, bytes([error]))
    calls = []; waits = [0, 0, 1]
    def battle_services(u, address, size, data):
        if address not in (0x021d0a58, 0x021ce908, 0x021d0a68, 0x023fd000): return
        assert u.reg_read(UC_ARM_REG_SP) % 8 == 0
        calls.append(address)
        u.reg_write(UC_ARM_REG_R0, waits.pop(0) if address == 0x021d0a68 else 0)
        u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))
    uc.hook_add(UC_HOOK_CODE, battle_services)
    for held in (0, 1, 3, 0xb, 0xb, 0xb):
        put(uc, KEYS + 0x18, held)
        uc.reg_write(UC_ARM_REG_R5, MAIN)
        value = call(uc, 0x02199c58, stop=0x02199c5c)
    assert get(uc, MAIN + 0x444) == (1 if enabled else result)
    assert calls.count(0x021d0a58) == int(enabled)
    assert calls.count(0x023fd000) == (3 if enabled else 6)
    if enabled:
        assert value == 1 and get(uc, SETUP + 0xa8) == 1
        assert bytes(uc.mem_read(SETUP + 0xac, 1)) == b'\x06'
        # Execute the real native result resolver after the shortcut completes.
        # The escape predicate is zero for our cleared EscapeInfo.
        def no_escape(u, address, size, data):
            if address == 0x021bdad4:
                u.reg_write(UC_ARM_REG_R0, 0)
                u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))
        uc.hook_add(UC_HOOK_CODE, no_escape)
        assert call(uc, 0x0219dec4, MAIN) == 1
checks.append('Battle release-edge handling, deferred UI-close handshake, native victory resolution, excluded battle modes, ABI stack alignment')

report = {'romId': 'IRDO', 'checks': checks, 'fullGameTested': False}
(HERE / 'build').mkdir(exist_ok=True)
(HERE / 'build/verification.json').write_text(json.dumps(report, indent=2) + '\n')
for check in checks: print('PASS:', check)

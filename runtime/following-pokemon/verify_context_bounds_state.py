"""Check a captured coordinate rule against the actual installed ARM module.

Usage: python3 verify_context_bounds_state.py ROM.nds STATE.dst
Reads the snapshot only; does not advance a game frame or launch an emulator.
The corrected NARC and evidence report are diagnostic outputs under build/.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys
import zlib
import ndspy.narc
import ndspy.rom
from inspect_state import desmume_ram, diagnostics
from verify_terrain_state import state_follower
from verify_packaged import *

rom_path, state_path = map(Path, sys.argv[1:3])
source = state_path.read_bytes(); ram = desmume_ram(source)
rom = ndspy.rom.NintendoDSRom(rom_path.read_bytes())
assert rom.idCode == b'IRDO'
debug = diagnostics(ram)['FWDG']['values']; player, field = debug[9], debug[14]
grid = struct.unpack_from('<3h', ram, player - 0x02000000 + 60)
zone = struct.unpack_from('<H', ram, field - 0x02000000 + 0xe0)[0]
sidecar = state_follower(ram)
selected = ram[sidecar - 0x02000000 + 28:sidecar - 0x02000000 + 48]
assert struct.unpack_from('<H', selected)[0] == debug[6]
# Find a validated data member, rather than a matching instruction literal.
members = []; at = ram.find(b'FWCD')
while at >= 0:
    _, abi, count, length, crc = struct.unpack_from('<IHHII', ram, at)
    if abi == 3 and count == 1 and 44 <= length <= 4096 and at + length <= len(ram):
        member = ram[at:at + length]
        if zlib.crc32(member[16:]) & 0xffffffff == crc:
            members.append(member)
    at = ram.find(b'FWCD', at + 4)
assert len(members) == 1
captured = members[0]; original_bounds = struct.unpack_from('<4h', captured, 36)
assert original_bounds == (2, 6, 5, 5) and grid[0] == 35 and grid[2] == 709 and zone == 427
corrected_bounds = (34, 38, 709, 709)
corrected = bytearray(captured); struct.pack_into('<4h', corrected, 36, *corrected_bounds)
struct.pack_into('<I', corrected, 12, zlib.crc32(corrected[16:]) & 0xffffffff)
def archive(member):
    narc = ndspy.narc.NARC(); narc.files = [bytes(member)]; return narc.save()

dll = HERE/'build/base/PokewebFollowingFieldW2Base.dll'
elf = HERE/'build/base/PokewebFollowingFieldW2Base.elf'
assert dll.read_bytes() == rom.getFileByName('patches/PokewebFollowingFieldW2.dll')
_, _, _, _, functions, _ = audit(dll, elf)
cpu = Uc(UC_ARCH_ARM, UC_MODE_THUMB); cpu.ctl_set_cpu_model(UC_CPU_ARM_946)
cpu.mem_map(0x02000000, 0x1000000)
BASE, SCRATCH, STACK, STOP = 0x02c00000, 0x02ef0000, 0x02ef8000, 0x02efff00
cpu.mem_write(BASE, bytes(relocate(dll, BASE, {symbol_hash('FollowingCoreAPI'): STOP, symbol_hash('FollowingEventsAPI'): STOP})))
CTX, SNAP, RNG, DATA = SCRATCH, SCRATCH + 0x100, SCRATCH + 0x200, SCRATCH + 0x1000
snapshot = bytearray(76); snapshot[:20] = selected
struct.pack_into('<H4B', snapshot, 24, zone, 100, 2, 0, 0)
def call(name, args):
    for reg, value in zip((UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3), args):cpu.reg_write(reg, value)
    cpu.reg_write(UC_ARM_REG_SP, STACK); cpu.reg_write(UC_ARM_REG_LR, STOP | 1)
    cpu.emu_start((BASE + functions[name][0]) | 1, STOP, count=100000)
    assert cpu.reg_read(UC_ARM_REG_PC) == STOP and cpu.reg_read(UC_ARM_REG_SP) == STACK
    return cpu.reg_read(UC_ARM_REG_R0)
def choose(data, x, y):
    cpu.mem_write(DATA, bytes(data)); assert call('fwr_context_validate', [CTX, DATA, len(data)]) == 1
    struct.pack_into('<2h', snapshot, 72, x, y); cpu.mem_write(SNAP, bytes(snapshot))
    cpu.mem_write(RNG, struct.pack('<I', 12345))
    result = call('fwr_context_choose', [CTX, SNAP, RNG])
    return -1 if result == 0xffffffff else result
old = archive(captured); new = archive(corrected)
assert choose(old, grid[0], grid[2]) == -1
assert choose(old, 3, 5) == 0
cases = []
for x, y in ((34, 709), (35, 709), (38, 709), (33, 709), (39, 709), (35, 708), (35, 710)):
    result = choose(new, x, y); expected = 0 if 34 <= x <= 38 and y == 709 else -1
    assert result == expected; cases.append({'x': x, 'y': y, 'rule': result})
rom_archive = rom.getFileByName('following/contextual-dialogues.narc')
assert choose(rom_archive, grid[0], grid[2]) == -1
assert source == state_path.read_bytes()
output = HERE/'build/coordinate-corrected-dialogues.narc'; output.write_bytes(new)
report = {'stateSha256': hashlib.sha256(source).hexdigest(), 'zone': zone, 'playerMatrixTile': [grid[0], grid[2]],
          'capturedBounds': original_bounds, 'capturedRuleMatched': False, 'correctedBounds': corrected_bounds,
          'correctedRuleMatched': True, 'edgeAndOutsideCases': cases, 'suppliedRomRuleCount': 0,
          'installedModuleUnchanged': True, 'gameEmulatorRun': False}
(HERE/'build/coordinate-context-evidence.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report, indent=2))

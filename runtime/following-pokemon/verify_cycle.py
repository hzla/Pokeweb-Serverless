"""Exercise L/R follower switching in packaged ARM946 code without a DS game."""
import struct
import verify_conversation_return as r
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_PC, UC_ARM_REG_LR, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2

h = r.h
uc = h.uc
PARTY = h.GAMEDATA + 0x100
MONS = [h.GAMEDATA + 0x300 + i * 0x100 for i in range(3)]
OUT = h.GAMEDATA + 0x900
SLOT = OUT + 32
party_services = {0x0201735c, 0x0201fe24, 0x0201ff34, 0x0201cd24, 0x0201cdd8}
cycle_services = party_services | {0x020493f0}
r.native.difference_update(cycle_services)
h.native_addresses.difference_update(cycle_services)

def party_spy(u, pc, size, user):
    if pc not in cycle_services and pc not in (0x021668c0, h.addr('fws_step_clear') & ~1):
        return
    assert u.reg_read(h.UC_ARM_REG_SP) % 8 == 0
    a, b, c = [u.reg_read(reg) for reg in (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2)]
    result = 0
    if pc == 0x0201735c:
        result = PARTY if a == h.GAMEDATA else 0
    elif pc == 0x0201fe24:
        result = 3 if a == PARTY else 0
    elif pc == 0x0201ff34:
        result = MONS[b] if a == PARTY and b < 3 else 0
    elif pc == 0x0201cd24:
        index = MONS.index(a) if a in MONS else -1
        if index >= 0 and c == 0:
            result = {5: 25 + index, 0x6f: 0, 0x6e: 0, 0x4c: 0,
                      0xa0: 100, 0xa1: 100, 0: 123 + index, 7: 456}.get(b, 0)
    elif pc == 0x0201cdd8:
        result = 0
    elif pc == 0x021668c0:
        uc.mem_write(h.A, bytes(256))
        h.put(h.A, 1)
        h.put(h.A + 136, h.SYS)
        result = h.A
    elif pc == 0x020493f0:
        result = 0  # White silhouette is optional; the private recall animation remains ready.
    else:
        result = 1  # The old follower tile remains a safe spawn position.
    u.reg_write(UC_ARM_REG_R0, result)
    u.reg_write(UC_ARM_REG_PC, u.reg_read(UC_ARM_REG_LR))

uc.hook_add(UC_HOOK_CODE, party_spy)
r.setup()
h.half(h.SYS + 4, 3)  # Player plus two free actor slots.
h.put(h.SYS + 28, h.P - 0x100)  # Keep the third synthetic actor slot clear of ActorSystem.
uc.mem_write(h.P - 0x100, bytes(0x100))
uc.mem_write(h.F + 48, b'\xff')  # Automatic selection until a shoulder is pressed.
index = h.addr('fwfield_index')
for species, row in ((25, 0), (26, 1), (27, 2), (28, 3)):
    h.half(index + species * 2, row)
page = h.addr('fwfield_page')
for row, species in enumerate((25, 26, 27)):
    uc.mem_write(page + row * 24, bytes(24))
    h.half(page + row * 24, species)
    h.half(page + row * 24 + 6, 1008 + row)
h.put(h.addr('fwfield_pageFirst'), 0)
h.put(h.addr('fwfield_pageCount'), 3)
h.put(h.addr('fwfield_stride'), 24)
h.put(h.addr('fwfx') + 40, 1)  # The private effect resources are already loaded.
h.put(h.addr('fwfx') + 44, 0)
for mon in MONS:
    uc.mem_write(mon, bytes(0x100))
party_before = [bytes(uc.mem_read(mon, 0x100)) for mon in MONS]

def frame(pressed=0):
    h.held = 0
    h.pressed = pressed
    r.field_frame()

def selected():
    return struct.unpack('<H', uc.mem_read(h.F + 28, 2))[0]

frame(0x300)
assert selected() == 25 and h.u32(h.F + 24) == h.A, 'L+R together must not cycle'
frame(0x100)
assert selected() == 26 and h.u32(h.F + 24) == 0
assert uc.mem_read(h.F + 48, 1) == b'\1' and h.u32(h.addr('fwfield_cyclePending')) == 1
assert h.u32(h.addr('fwfx') + 44) == 2, 'Recall must precede the new spawn'
frame(0x100)
assert selected() == 26 and h.u32(h.F + 24) == 0, 'Input during recall must not skip another member'
for _ in range(7):
    frame()
assert h.u32(h.F + 24) == h.A and selected() == 26, (hex(h.u32(h.F + 24)), selected(), h.u32(h.addr('fwfx') + 44), h.u32(h.addr('fwfield_cyclePending')), h.u32(h.addr('FollowingDebug') + 20))
assert h.u32(h.addr('fwfx') + 44) == 1, 'The next member must receive a send-out effect'
assert h.u32(h.addr('fwfield_cyclePending')) == 0
for _ in range(10):
    frame()
frame(0x200)
assert selected() == 25 and h.u32(h.addr('fwfx') + 44) == 2, 'L must cycle backward'
assert [bytes(uc.mem_read(mon, 0x100)) for mon in MONS] == party_before, 'Cycling must not edit party data'
for facing in (2, 3):
    r.setup()
    h.half(h.P + 24, facing)
    h.half(h.A + 24, facing)
    h.half(h.SYS + 4, 3)
    h.put(h.SYS + 28, h.P - 0x100)
    uc.mem_write(h.P - 0x100, bytes(0x100))
    uc.mem_write(h.F + 48, b'\xff')
    uc.mem_write(h.F + 50, b'\x06')
    h.put(h.addr('fwfield_cyclePending'), 0)
    h.put(h.addr('fwfx') + 40, 1)
    h.put(h.addr('fwfx') + 44, 0)
    for row in range(3):
        uc.mem_write(page + row * 24 + 15, b'\x06')
    # A wide sprite sits more than one ordinary tile behind a horizontal player.
    old_x = 10 * 65536 + (-1 if facing == 2 else 1) * 22 * 4096
    uc.mem_write(h.A + 68, struct.pack('<iii', old_x, 0, 10 * 65536))
    uc.mem_write(h.A + 60, struct.pack('<hhh', old_x // 65536, 0, 10))
    frame(0x100)
    assert selected() == 26 and h.u32(h.F + 24) == 0
    for step in range(8):
        if facing == 3:
            h.put(h.P + 68, 10 * 65536 + (step + 1) * 4096)
        frame()
    assert h.u32(h.F + 24) == h.A and selected() == 26, (facing, 'missing horizontal replacement',hex(h.u32(h.F+24)),selected(),h.u32(h.addr('fwfield_cyclePending')),h.u32(h.addr('fwfx')+44),h.u32(h.addr('FollowingDebug')+20))
    frame()
    frame()
    assert not h.u32(h.A) & 4 and h.u32(h.F) == 2, (facing, 'horizontal follower remained hidden')
print('Packaged L/R cycling passed: simultaneous-key guard, forward/backward selection, recall before send-out, busy-input guard, both wide horizontal facings including player movement, and unchanged party data. No DS game run.')

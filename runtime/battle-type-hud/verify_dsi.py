"""Compiled ARM checks for DS/DSi pointer bounds and high-RAM HUD objects.

Runs isolated functions with native graphics fixtures; no game boot or frames.
"""
from contextlib import contextmanager
import hashlib, json, struct
import verify
from rpm_read import read_rpm
from unicorn.arm_const import *

HERE = verify.HERE
DELTA = 0x600000

def native_mode(h, mode):
    at = h.profile['functions']['IsDsi']
    cache = h.get(at + 40)
    h.put(cache + 4, mode)
    h.put(cache + 28, 1)

def invoke_pointer_check(h, module, pointer):
    debug = read_rpm((HERE/'build'/f'{module}{h.game}.debug.dll').read_bytes())
    symbol = next(s for s in debug['symbols'] if s['name'] == '_ZN12_GLOBAL__N_13ramEPKv')
    c = h.c
    c.reg_write(UC_ARM_REG_CPSR, 0x1f)
    c.reg_write(UC_ARM_REG_SP, verify.SP)
    c.reg_write(UC_ARM_REG_LR, verify.STOP | 1)
    c.reg_write(UC_ARM_REG_R0, pointer)
    saved = [0x23450000 + i for i in range(8)]
    for reg, value in zip(verify.SAVED, saved): c.reg_write(reg, value)
    c.emu_start((verify.BASE + symbol['address']) | 1, verify.STOP, count=10000)
    assert c.reg_read(UC_ARM_REG_PC) == verify.STOP
    assert c.reg_read(UC_ARM_REG_SP) == verify.SP
    assert [c.reg_read(reg) for reg in verify.SAVED] == saved
    return c.reg_read(UC_ARM_REG_R0)

def high_objects(h):
    source = bytes(h.c.mem_read(0x02270000, 0x10000))
    h.c.mem_write(0x02870000, source)
    pointers = [verify.PFD + 40, verify.PFD + 44]
    for p in range(8):
        pointers += [verify.G+0x40+p*0x84, verify.G+0x44+p*0x84,
                     0x02271000+p*0x100+0xa4, 0x0227c000+p*0x40+4,
                     0x02273000+p*0x300]
    for at in pointers:
        value = h.get(at)
        assert 0x02270000 <= value < 0x02280000
        h.put(at + DELTA, value + DELTA)
    h.c.mem_write(0x02270000, bytes(0x10000))
    h.liveTypes = {mon+DELTA: pair for mon, pair in h.liveTypes.items()}

@contextmanager
def high_globals():
    names = ('G', 'PFD', 'PAL', 'TRANS')
    previous = {name: getattr(verify, name) for name in names}
    for name, value in previous.items(): setattr(verify, name, value + DELTA)
    try: yield
    finally:
        for name, value in previous.items(): setattr(verify, name, value)

def test(game, module):
    assets = 'assets-solid.json' if module == 'TypeIconsSolid' else 'assets-circular.json' if module == 'TypeIconsCircular' else 'assets.json'
    verify.ASSETS = json.loads((HERE/assets).read_text())
    h = verify.Harness(game, module)
    for mode in (0, 1):
        native_mode(h, mode)
        for pointer, expected in ((0, 0), (0x01fffffc, 0), (0x02000000, 1),
                                  (0x023ffffc, 1), (0x02400000, mode),
                                  (0x02850000, mode), (0x02fffffc, mode),
                                  (0x03000000, 0), (0x02850001, 0), (0xffffffff, 0)):
            assert invoke_pointer_check(h, module, pointer) == expected, (game, module, mode, hex(pointer))
    checks = ['actual native mode getter gates aligned 4 MB DS / 16 MB DSi bounds; endpoints and invalid pointers rejected; ABI preserved']
    if module == 'MoveEffectiveness': return checks

    native_mode(h, 1)
    high_objects(h)
    with high_globals():
        for p, layout in ((0,0), (1,0), (2,1), (3,1), (4,2), (5,2), (6,2), (7,2)):
            mon = 0x02873000+p*0x300
            if p & 1:
                data = 0x0287c000+p*0x40
                h.put(data, (3 | (21<<16)) if layout>=2 else (2 | (17<<16)))
                h.c.mem_write(data+8, bytes.fromhex('f040c0c10000f04000c01000f08040802000'))
            pair = (11, 11) if p & 1 else (9, 2)
            h.liveTypes[mon] = pair
            h.invoke('Add', verify.G, 0x0287a000, mon, layout, p)
            h.check(p, pair, layout)
            h.writes.clear()
            h.invoke('Main', verify.G)
            assert not h.writes
            h.liveTypes[mon] = (10, 10)
            h.invoke('Main', verify.G)
            h.check(p, (10,10), layout)
            h.invoke('Status', verify.G, 1, p)
            h.check(p, (10,10), layout, status=True)
            h.invoke('Status', verify.G, 0, p)
            h.check(p, (10,10), layout)
            h.setfade(p if p<2 else p-2, 0x7fff, 8)
            h.liveTypes[mon] = (9,2)
            h.invoke('Main', verify.G)
            h.check(p, (9,2), layout)
            h.setfade(p if p<2 else p-2, 0, 0)
            h.invoke('Del', verify.G, p)
            assert h.image(p,layout) == verify.normalized(h.raw[(2 if layout>=2 else 0,p&1)])
        assert all(h.get(h.state + i*60) == 0 for i in range(6))
        checks.append('gauge, battlers, cells, cell attributes, Pokemon records and fade buffers exclusively in extended RAM; player/enemy single/double/triple pixels, types, status, fade, unchanged-frame suppression and cleanup match')
        native_mode(h, 0)
        h.invoke('Add', verify.G, 0x0287a000, 0x02873000, 0, 0)
        assert h.c.mem_read(h.state+360,1)[0] == 1
        assert all(h.get(h.state + i*60) == 0 for i in range(6))
        checks.append('DS-mode high addresses fail closed before a binding; accepted DSi addresses do not weaken DS validation')
    return checks

def main():
    modules = ('TypeIcons', 'TypeIconsCircular', 'TypeIconsSolid', 'MoveEffectiveness')
    checks = {game: {module: test(game, module) for module in modules} for game in ('B2','W2')}
    report = dict(compiled_arm_checks=checks,
                  release_sha256={game: {module: hashlib.sha256((HERE/'build'/f'{module}{game}.dll').read_bytes()).hexdigest() for module in modules} for game in ('B2','W2')},
                  emulator_frames_executed=False, game_boot_performed=False)
    (HERE/'build/dsi-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__ == '__main__': main()

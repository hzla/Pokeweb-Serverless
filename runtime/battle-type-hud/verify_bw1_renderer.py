"""Run the BW1 candidate DLLs against retail getters and gauge fixtures.

Gauge creation and drawing are instrumented stand-ins. Retail palette
reservation/free, fade lookup, proxy, visible-source, effective-type, Roost
and PK5 getter instructions execute unchanged. Physical palette DMA is
modeled in Unicorn. This does not certify live gameplay.
"""
import json
import hashlib
import os
from pathlib import Path
import struct

from unicorn import Uc, UC_ARCH_ARM, UC_MODE_ARM, UC_HOOK_CODE, UC_HOOK_MEM_WRITE
from unicorn.arm_const import *
from configure_bw1 import HERE, WORKSPACE, load
from panel_expansion import transform
from rpm_read import read_rpm, thumb_bl

BASE, STOP = 0x02380020, 0x02370000
REGS = [UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3]
SAVED = [UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7,
         UC_ARM_REG_R8, UC_ARM_REG_R9, UC_ARM_REG_R10, UC_ARM_REG_R11]
def panel_index(pos): return pos & 1 if pos < 4 else pos - 2

def positions(layout): return (2, 3, 4, 5, 6, 7) if layout >= 2 else (0, 1, 4, 5, 6, 7)
CHANGES = json.loads((HERE / 'panel-expansion-bw1.json').read_text())


class Harness:
    def __init__(self, game, module, extended=False):
        self.game, self.module = game, module
        self.profile = json.loads((HERE / f'profile-TypeIcons-{game}.json').read_text())
        self.addresses = self.profile['functions']
        self.c = Uc(UC_ARCH_ARM, UC_MODE_ARM)
        self.c.ctl_set_cpu_model(UC_CPU_ARM_946)
        for at, length in [(0x02000000, 0x1000000), (0x04000000, 0x10000),
                           (0x05000000, 0x1000), (0x06400000, 0x10000),
                           (0x01ff8000, 0x8000)]:
            self.c.mem_map(at, length)
        default = WORKSPACE / 'cleanblack.nds' if game == 'B' else Path.home() / 'Downloads/cleanroms/cleanwhite.nds'
        _, blobs = load(os.environ.get(f'BTH_{game}_ROM', default), b'IRBO' if game == 'B' else b'IRAO')
        for at, data in blobs.values():
            self.c.mem_write(at, bytes(data))
        for sig in self.profile['signatures']:
            assert bytes(self.c.mem_read(sig['address'], len(bytes.fromhex(sig['bytes'])))).hex() == sig['bytes']
        rpm = read_rpm((HERE / 'build' / f'{module}{game}.dll').read_bytes())
        debug = read_rpm((HERE / 'build' / f'{module}{game}.debug.dll').read_bytes())
        assert rpm['code'] == debug['code'] and rpm['bss'] == debug['bss'] == 796
        self.c.mem_write(BASE, rpm['code'] + bytes(rpm['bss']))
        self.entries = {}
        for rel in rpm['relocations']:
            sym = rpm['symbols'][rel['symbol']]
            dest = sym['address'] + (0 if sym['attributes'] & 4 else BASE)
            if sym['type'] == 3:
                dest |= 1
            if rel['module'] == 'base':
                assert rel['type'] == 'OFFSET'
                self.put(BASE + rel['address'], dest)
            else:
                assert rel['module'] == '94'
                hook = next(h for h in self.profile['hooks'] if h['address'] == rel['address'])
                self.entries.setdefault(hook['name'], []).append((rel['type'], rel['address'], dest))
                if rel['type'] == 'OFFSET':
                    self.put(rel['address'], dest)
                else:
                    self.c.mem_write(rel['address'], thumb_bl(rel['address'], dest))
        self.state = BASE + next(s['address'] for s in debug['symbols'] if s['name'] == 'gBattleTypeHud')
        heap = 0x02800000 if extended else 0x02270000
        self.g, self.pfd = heap, heap + 0x8000
        self.pal, self.trans = heap + 0x9000, heap + 0x9200
        self.ctx, self.registry = heap + 0xa000, heap + 0xb000
        self.sp = heap + 0x30000
        mode = self.addresses['IsDsi']
        state = self.get(mode + 68)
        self.put(state + 28, 1)
        self.put(state + 4, int(extended))
        self.put(0x04000000, 0x00111f18)
        self.c.mem_write(0x04000244, b'\x82')
        self.put(self.profile['spriteContextSlot'], self.ctx)
        self.put(self.ctx + 272, self.registry)
        self.half(self.ctx + 282, 32)
        for i in range(32):
            self.put(self.registry + 24 * i + 12, 0xffffffff)
            self.put(self.registry + 24 * i + 16, 0xffffffff)
            self.put(self.registry + 24 * i + 20, 0x80000000)
        for i in range(10):
            self.put(self.registry + 24 * i + 12, 32 * i)
            self.put(self.registry + 24 * i + 20, 32)
        native = (HERE / 'build' / f'{game}-resource-162.bin').read_bytes()[40:72]
        # Retail leaves unused fade banks uninitialized, rather than zero.
        palette = native * 10 + bytes((i * 37 + 13) & 255 for i in range(192))
        for dest in (self.pal, self.trans, 0x05000200):
            self.c.mem_write(dest, palette)
        self.put(self.pfd + 40, self.pal)
        self.put(self.pfd + 44, self.trans)
        self.put(self.pfd + 48, 512)
        native_pfd = self.addresses['GetPfd'] & ~1
        self.put(self.get(native_pfd + 12), heap + 0x1e000)
        self.put(heap + 0x1e18c, self.pfd)
        self.originalPalette = palette
        self.original, self.cells, self.mons, self.attrs = {}, {}, {}, {}
        self.events, self.writes, self.personalReads = [], [], []
        self.silent = False
        for name in ('Add', 'AddPP', 'Main', 'Del', 'Release', 'Status',
                     'NameDraw', 'SexDraw', 'LevelDraw', 'PersonalParam'):
            at = self.addresses[name] & ~1
            self.c.hook_add(UC_HOOK_CODE, self.stub, name, begin=at, end=at)
        self.c.hook_add(UC_HOOK_MEM_WRITE, self.videoWrite, begin=0x06400000, end=0x0640ffff)
        self.c.hook_add(UC_HOOK_MEM_WRITE, self.paletteWrite, begin=0x05000200, end=0x050003ff)
        # The retail SDK delegates the physical DMA operation to ITCM. Model
        # that hardware transfer; keep its native palette upload caller intact.
        self.c.hook_add(UC_HOOK_CODE, self.dma, begin=0x01ff8020, end=0x01ff8020)

    def put(self, at, value): self.c.mem_write(at, struct.pack('<I', value))
    def half(self, at, value): self.c.mem_write(at, struct.pack('<H', value))
    def get(self, at): return struct.unpack('<I', self.c.mem_read(at, 4))[0]

    def create(self, pos, layout, pair=(9, 10)):
        index = panel_index(pos)
        for prior in tuple(self.original):
            if prior != pos and panel_index(prior) == index:
                for table in (self.original, self.cells, self.mons, self.attrs): table.pop(prior)
        char = (171 if layout >= 2 else 165) if pos & 1 else (174 if layout >= 2 else 168)
        raw = (HERE / 'build' / f'{self.game}-resource-{char}.bin').read_bytes()
        expanded = transform(raw, CHANGES[str(char)])[48:]
        cellraw = (HERE / 'build' / f'{self.game}-resource-{char + 1}.bin').read_bytes()
        cellraw = transform(cellraw, CHANGES[str(char + 1)])
        count, flags = struct.unpack_from('<HH', cellraw, 48)
        panel, cell, mon = self.g + 0x40 + 0x80 * pos, self.g + 0x1000 + index * 0x100, self.g + 0x3000 + index * 0x300
        cellData, attrs = self.g + 0xc000 + index * 0x80, self.g + 0xc008 + index * 0x80
        self.put(panel, cell); self.put(panel + 24, 100 + index); self.put(panel + 112, 8)
        self.put(cell + 0x20, index * 0x1000)
        self.put(cell + 0xa4, cellData)
        self.half(cellData, count); self.half(cellData + 2, flags); self.put(cellData + 4, attrs)
        self.c.mem_write(attrs, cellraw[56:56 + 6 * count])
        self.put(self.g + 0x18 + 4 * index, index)
        self.put(mon, mon + 0x200); self.put(mon + 4, 0)
        self.c.mem_write(mon + 0x19, bytes([index * 6])); self.c.mem_write(mon + 0x1b, b'\0')
        self.c.mem_write(mon + 0xf8, bytes(pair)); self.put(mon + 0x7c, 0)
        self.c.mem_write(0x06400000 + index * 0x1000, expanded)
        self.original[pos] = raw[48:]
        self.cells[pos], self.mons[pos], self.attrs[pos] = cell, mon, attrs

    def stub(self, c, pc, _size, name):
        args = [c.reg_read(reg) for reg in REGS]
        result = 0
        if name in ('Add', 'AddPP'):
            args.append(self.get(c.reg_read(UC_ARM_REG_SP)))
        if name == 'GetPfd': result = self.pfd
        elif name == 'Del': self.put(self.g + 0x40 + 0x80 * args[1] + 112, 0)
        elif name == 'PersonalParam':
            assert args == [479, 1, 6, args[3]] or args == [479, 1, 7, args[3]], args
            self.personalReads.append(tuple(args[:3])); result = 12 if args[2] == 6 else 9
        if name not in ('GetPfd', 'PersonalParam'):
            self.events.append((name, args))
        for reg in REGS + [UC_ARM_REG_R12]: c.reg_write(reg, 0xdeadbeef)
        c.reg_write(UC_ARM_REG_R0, result); c.reg_write(UC_ARM_REG_PC, c.reg_read(UC_ARM_REG_LR))

    def videoWrite(self, _c, _access, address, size, _value, _user):
        assert size in (2, 4) and address % size == 0, 'VRAM byte/unaligned write'
        assert any(0x06400000 + panel_index(p) * 0x1000 + len(raw) <= address and
                   address + size <= 0x06400000 + panel_index(p) * 0x1000 + len(raw) + 256
                   for p, raw in self.original.items()), 'native/foreign graphics write'
        self.writes.append(address)

    def paletteWrite(self, _c, _access, address, size, _value, _user):
        assert size in (2, 4) and address % size == 0 and address >= 0x05000340, 'native palette write'

    def dma(self, c, _pc, _size, _user):
        channel, src, dst, control = [c.reg_read(reg) for reg in REGS]
        n = (control & 0x1fffff) * (4 if control & (1 << 26) else 2)
        assert channel == 3 and 0x05000340 <= dst and dst + n <= 0x05000400 and n == 32
        c.mem_write(dst, bytes(c.mem_read(src, n)))
        c.reg_write(UC_ARM_REG_PC, c.reg_read(UC_ARM_REG_LR))

    def invoke(self, name, *args, index=0):
        kind, site, dest = self.entries[name][index]
        start, stop = (dest, STOP) if kind == 'OFFSET' else (site | 1, site + 4)
        c = self.c; c.reg_write(UC_ARM_REG_CPSR, 0x1f)
        c.reg_write(UC_ARM_REG_SP, self.sp); c.reg_write(UC_ARM_REG_LR, STOP | 1)
        for i, reg in enumerate(REGS): c.reg_write(reg, args[i] if i < len(args) else 0xa000 + i)
        if len(args) > 4: self.put(self.sp, args[4])
        for i, reg in enumerate(SAVED): c.reg_write(reg, 0xba500000 + i)
        c.emu_start(start, stop, count=3000000)
        assert c.reg_read(UC_ARM_REG_PC) == stop, (name, hex(c.reg_read(UC_ARM_REG_PC)))
        assert c.reg_read(UC_ARM_REG_SP) == self.sp
        assert [c.reg_read(r) for r in SAVED] == [0xba500000 + i for i in range(8)], name
        self.unchanged()

    def unchanged(self):
        assert bytes(self.c.mem_read(self.pal, 320)) == self.originalPalette[:320]
        for p, raw in self.original.items():
            index = panel_index(p)
            assert bytes(self.c.mem_read(0x06400000 + index * 0x1000, len(raw))) == raw
            # Native cell attributes remain byte-identical too.
            char = (171 if len(raw) == 2304 else 165) if p & 1 else (174 if self.get(self.g + 0x40 + 0x80 * p + 64) >= 2 else 168)
            original = (HERE / 'build' / f'{self.game}-resource-{char + 1}.bin').read_bytes()
            count = struct.unpack_from('<H', original, 48)[0]
            assert bytes(self.c.mem_read(self.attrs[p] + 12, 6 * count)) == original[56:56 + 6 * count]

    def image(self, pos):
        return bytes(self.c.mem_read(0x06400000 + panel_index(pos) * 0x1000 + len(self.original[pos]), 256))


def checks(game, module, extended):
    h = Harness(game, module, extended)
    for layout in range(4):
        h.original.clear(); h.cells.clear(); h.mons.clear(); h.attrs.clear()
        for pos in positions(layout):
            h.create(pos, layout, (9, 10))
            h.put(h.g + 0x40 + 0x80 * pos + 64, layout)
            h.invoke('Add', h.g, 0x1234, h.mons[pos], layout, pos)
            assert any(h.image(pos)), (game, module, layout, pos)
        assert bytes(h.c.mem_read(h.state + 792, 1)) == b'\0'
        for evy in (0, 3, 8, 16, 0):
            target = 0x7fff if evy == 3 else 0
            h.half(h.pfd + 56, target)
            original = struct.unpack('<160H', h.originalPalette[:320])
            def blend(value):
                return sum((((value >> s) & 31) + (((((target >> s) & 31) - ((value >> s) & 31)) * evy) >> 4)) << s for s in (0, 5, 10))
            h.c.mem_write(h.trans, struct.pack('<160H', *map(blend, original)))
            h.invoke('Main', h.g)
            for index in range(6):
                values = struct.unpack('<16H', h.c.mem_read(h.pal + (10 + index) * 32, 32))
                assert bytes(h.c.mem_read(h.trans + (10 + index) * 32, 32)) == struct.pack('<16H', *map(blend, values))
        for pos in positions(layout):
            for s in (1, 2, 3, 4, 5, 0):
                # Status is stored on the native battler, not at BW2's gauge
                # byte offset. Execute retail CheckSick against those words.
                for sick in range(1, 6):
                    h.put(h.mons[pos] + 0x1c + 4 * sick, int(sick == s))
                h.invoke('Status', h.g, s, pos)
                assert bool(any(h.image(pos))) == (s == 0)
            for name, args in [('NameDraw', (h.g, h.g + 0x40 + 0x80 * pos, 0x7777)),
                               ('SexDraw', (h.g, h.g + 0x40 + 0x80 * pos)),
                               ('LevelDraw', (h.g, h.g + 0x40 + 0x80 * pos))]:
                h.invoke(name, *args)
            # Actual retail Roost type normalization, then live type changes.
            mon = h.mons[pos]; h.c.mem_write(mon + 0xf8, bytes([2, 10])); h.put(mon + 0x7c, 1)
            h.invoke('Main', h.g)
            assert struct.unpack('<H', h.c.mem_read(h.state + panel_index(pos) * 132 + 120, 2))[0] == 0x0a0a
            h.put(mon + 0x7c, 0)
            for pair in ((9, 9), (12, 8), (0, 4), (15, 16), (1, 11), (6, 7), (13, 14)):
                h.c.mem_write(mon + 0xf8, bytes(pair)); h.invoke('Main', h.g)
            h.invoke('Del', h.g, pos)
            assert not any(h.image(pos))
        h.invoke('Release', h.g)
        assert bytes(h.c.mem_read(h.pal + 320, 192)) == h.originalPalette[320:]
        assert bytes(h.c.mem_read(h.state + 792, 1)) == b'\0'
    # Pre-existing native status must work before any Status hook runs.
    # A nonzero byte at the old BW2 offset is deliberately irrelevant.
    for sick in range(1, 6):
        h.create(0, 0)
        h.put(h.mons[0] + 0x1c + 4 * sick, 1)
        h.invoke('Add', h.g, 0, h.mons[0], 0, 0)
        assert not any(h.image(0))
        assert bytes(h.c.mem_read(h.state + 125, 1)) == bytes([sick])
        h.put(h.mons[0] + 0x1c + 4 * sick, 0)
        h.c.mem_write(h.g + 0x40 + 110, b'\x05')
        h.invoke('Main', h.g)
        assert any(h.image(0))
        h.invoke('Release', h.g)
    # Real PK5 view dispatch and type parameter mapping, with native personal
    # archive access stubbed after verifying its species/form/field arguments.
    h.create(0, 0); mon = h.mons[0]; fake = h.g + 0x15000
    h.c.mem_write(fake, bytes(220)); h.half(fake + 4, 3)
    h.half(fake + 8, 479); h.c.mem_write(fake + 8 + 32 + 24, b'\x08')
    h.put(mon + 4, fake); h.c.mem_write(mon + 0x1b, b'\x40')
    h.invoke('Add', h.g, 0, mon, 0, 0)
    assert h.personalReads[-2:] == [(479, 1, 6), (479, 1, 7)]
    assert struct.unpack('<H', h.c.mem_read(h.state + 120, 2))[0] == 0x0c09
    h.invoke('Release', h.g)
    # A later native resource claim takes priority over the private colors.
    h.create(0, 0); h.invoke('Add', h.g, 0, h.mons[0], 0, 0)
    h.put(h.registry + 24 * 20 + 12, 320); h.put(h.registry + 24 * 20 + 20, 32)
    foreign = struct.pack('<16H', *range(0x3210, 0x3220))
    h.c.mem_write(h.pal + 320, foreign); h.c.mem_write(h.trans + 320, foreign)
    h.c.mem_write(0x05000340, foreign)
    h.invoke('Main', h.g)
    assert not any(h.image(0))
    assert bytes(h.c.mem_read(h.pal + 320, 32)) == bytes(h.c.mem_read(0x05000340, 32)) == foreign
    h.put(h.registry + 24 * 20 + 20, 0x80000000)
    for at in (h.pal + 320, h.trans + 320, 0x05000340): h.c.mem_write(at, h.originalPalette[320:352])
    # Missing expansion/allocation results fail before touching any palette.
    h.create(0, 0); h.put(h.g + 0x40, 0); h.invoke('Add', h.g, 0, mon, 0, 0)
    assert not any(h.image(0))
    h.create(0, 0); h.half(h.get(h.cells[0] + 0xa4), 2)
    h.invoke('Add', h.g, 0, mon, 0, 0); assert not any(h.image(0))
    # Free palette banks with no free native resource IDs must also fail
    # without writing graphics, palettes or another owner's descriptor.
    h.create(0, 0)
    for i in range(10, 32):
        h.put(h.registry + 24 * i + 12, 0xffffffff)
        h.put(h.registry + 24 * i + 20, 32)
    registry = bytes(h.c.mem_read(h.registry, 32 * 24))
    before = len(h.writes); h.invoke('Add', h.g, 0, mon, 0, 0)
    assert len(h.writes) == before and bytes(h.c.mem_read(h.registry, 32 * 24)) == registry
    for i in range(10, 32): h.put(h.registry + 24 * i + 20, 0x80000000)
    # All private banks already owned by other native resources.
    h.create(0, 0)
    for i in range(10, 16):
        h.put(h.registry + 24 * i + 12, 32 * i); h.put(h.registry + 24 * i + 20, 32)
    before = len(h.writes); h.invoke('Add', h.g, 0, mon, 0, 0)
    assert len(h.writes) == before
    print(f'{game}/{module}/{"extended DSi fixture" if extended else "DS"}: four layouts, six gauges, retail types/Roost/PK5 dispatch, fades/status/teardown, ABI and failure guards passed; gameplay pending')
    return {'game': game, 'module': module, 'extendedRam': extended,
            'dllSha256': hashlib.sha256((HERE / 'build' / f'{module}{game}.dll').read_bytes()).hexdigest(),
            'compiledPassed': True, 'dsGameplayAccepted': False, 'dsiGameplayAccepted': False}


if __name__ == '__main__':
    reports = []
    for game in ('B', 'W'):
        for module in ('TypeIcons', 'TypeIconsCircular', 'TypeIconsSolid'):
            for extended in (False, True):
                reports.append(checks(game, module, extended))
    (HERE / 'build/verification-bw1-candidates.json').write_text(json.dumps({'checks': reports}, indent=2) + '\n')

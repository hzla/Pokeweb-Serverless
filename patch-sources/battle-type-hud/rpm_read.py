"""Read the RPM revision 13 fields needed for this patch's verification."""
import struct

TYPES = ['OFFSET', 'THUMB_BRANCH_LINK', 'ARM_BRANCH_LINK', 'THUMB_BRANCH',
         'ARM_BRANCH', 'FULL_COPY', 'THUMB_BRANCH_SAFESTACK', 'OFFSET_REL31']

def read_rpm(b):
    u16 = lambda p: struct.unpack_from('<H', b, p)[0]
    u32 = lambda p: struct.unpack_from('<I', b, p)[0]
    assert b[:4] == b'DLXF'
    h = u32(8)
    assert b[h:h+4] == b'DLXH' and u32(h+4) == 13
    relative = lambda p: -1 if u32(p) == 0xffffffff else h + u32(p)
    info = relative(h+8)
    assert b[info:info+4] == b'INFO'
    sy, rel, st = [relative(info+i) for i in (4, 8, 12)]
    def string(p):
        ref = u16(p)
        if not ref: return None
        start = st+4+ref
        return b[start:b.index(0, start)].decode()
    symbols = []
    if sy >= 0:
        assert b[sy:sy+4] == b'SYM0'
        for i in range(u32(sy+20)):
            p = sy+24+i*12
            symbols.append(dict(name=string(p), size=u16(p+2), address=u32(p+4),
                                type=b[p+8], attributes=b[p+9]))
    relocations = []
    if rel >= 0:
        assert b[rel:rel+4] == b'REL0'
        ml = relative(rel+20)
        modules = [string(ml+2+i*2) for i in range(u16(ml))]
        for off in (8, 12, 16):
            table = relative(rel+off)
            if table < 0: continue
            for i in range(u32(table)):
                p = table+4+i*8
                # Format: target address, module index, type, source symbol index.
                module = b[p+4]
                relocations.append(dict(address=u32(p), symbol=u16(p+6),
                                        module='base' if module == 255 else modules[module],
                                        type=TYPES[b[p+5]]))
    co, size = u32(info+16), u32(info+20)
    fixed = relative(rel+8) + u32(h+12) if rel >= 0 and relative(rel+8) >= 0 else u32(4)
    return dict(code=b[co:co+size], bss=u32(h+12), symbols=symbols,
                relocations=relocations, expanded_size=u32(4), internal_fixed_size=fixed)

def thumb_bl(site, destination):
    delta = (destination & ~1) - (site+4)
    assert delta % 2 == 0 and -(1 << 22) <= delta < (1 << 22)
    return struct.pack('<HH', 0xf000 | ((delta >> 12) & 0x7ff),
                       0xf800 | ((delta >> 1) & 0x7ff))

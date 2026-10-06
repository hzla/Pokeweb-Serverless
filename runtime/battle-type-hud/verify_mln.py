"""Replay Type Icons against a supplied melonDS v14 DSi battle capture.

Usage: python verify_mln.py CAPTURE.mln OLD.dll [NEW.dll]
Runs compiled wrappers and native readers, with gauge Add/Main/Release as
no-ops. Never boots a game, advances frames, or distributes captured data.
"""
from pathlib import Path
import hashlib, json, struct, sys
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_ARM, UC_HOOK_CODE, UC_HOOK_MEM_WRITE
from unicorn.arm_const import *
import verify
from rpm_read import read_rpm
from verify_dst import relocated

RAM = 0x02000000
BASE = 0x02e00020
HERE = Path(__file__).resolve().parent

def u32(data, at=0): return struct.unpack_from('<I', data, at)[0]

def read_state(path):
    raw = path.read_bytes()
    assert raw[:4] == b'MELN' and struct.unpack_from('<HH',raw,4) == (14,0)
    assert u32(raw,8) == len(raw)
    sections = {}; at = 16
    while at < len(raw):
        tag = raw[at:at+4].decode('ascii'); size = u32(raw,at+4)
        assert size >= 16 and at+size <= len(raw)
        assert tag not in sections
        sections[tag] = raw[at+16:at+size]; at += size
    assert u32(sections['NDSG']) & 1, 'Expected DSi-mode capture'
    ram = sections['NDSG'][4:4+0x1000000]
    assert len(ram) == 0x1000000
    # GPU v14: native palette starts after 572 bytes of scalar/FIFO state,
    # then 2 KiB palette, 2 KiB OAM, and physical banks A through I.
    gpu = sections['GPUG']; vram_at = 572+4096
    return dict(ram=ram, palette=gpu[572:572+2048],
                obj=gpu[vram_at+0x80000:vram_at+0x90000],
                vram_e=gpu[vram_at+0xa4000+4], disp=sections['GP2A'][:4])

def loaded_module(mem, profile, rpm):
    site = next(h['address'] for h in profile['hooks'] if h['name']=='Main')
    a,b = struct.unpack_from('<HH',mem['ram'],site-RAM)
    assert a&0xf800 == 0xf000 and b&0xf800 == 0xf800
    delta = ((a&2047)<<12)|((b&2047)<<1)
    if delta&0x400000: delta -= 0x800000
    rel = next(r for r in rpm['relocations'] if r['module']=='168' and r['address']==site)
    base = site+4+delta-rpm['symbols'][rel['symbol']]['address']
    assert mem['ram'][base-RAM:base-RAM+len(rpm['code'])] == relocated(rpm,base)
    state = base+len(rpm['code'])
    assert mem['ram'][state-RAM+360] == 1, 'Capture does not show the pointer failure'
    assert all(u32(mem['ram'],state-RAM+i*60) == 0 for i in range(6))
    return dict(loaded_old_code_matches=True, old_pointer_failure=1, old_active_bindings=0)

def replay(mem, profile, rpm, expect_draw):
    c = Uc(UC_ARCH_ARM,UC_MODE_ARM); c.ctl_set_cpu_model(UC_CPU_ARM_946)
    for at,size in ((RAM,0x1000000),(0x04000000,0x10000),
                    (0x05000000,0x1000),(0x06400000,0x10000)): c.mem_map(at,size)
    c.mem_write(RAM,mem['ram']); c.mem_write(0x05000000,mem['palette'])
    c.mem_write(0x06400000,mem['obj']); c.mem_write(0x04000000,mem['disp'])
    c.mem_write(0x04000244,bytes([mem['vram_e']]))
    c.mem_write(BASE,relocated(rpm,BASE)+bytes(rpm['bss']))
    state = BASE+len(rpm['code'])
    entries = {}
    for r in rpm['relocations']:
        if r['module'] != '168': continue
        name = next(h['name'] for h in profile['hooks'] if h['address']==r['address'])
        entries[name] = BASE+rpm['symbols'][r['symbol']]['address']
    def get(at): return u32(c.mem_read(at,4))
    def call(address, args=()):
        c.reg_write(UC_ARM_REG_CPSR,0x1f); c.reg_write(UC_ARM_REG_SP,verify.SP)
        c.reg_write(UC_ARM_REG_LR,verify.STOP|1)
        for reg,arg in zip(verify.REGS,args): c.reg_write(reg,arg)
        for i,arg in enumerate(args[4:]): c.mem_write(verify.SP+i*4,struct.pack('<I',arg))
        saved = [0x12340000+i for i in range(8)]
        for reg,arg in zip(verify.SAVED,saved): c.reg_write(reg,arg)
        c.emu_start(address|1,verify.STOP,count=2000000)
        assert c.reg_read(UC_ARM_REG_PC)==verify.STOP and c.reg_read(UC_ARM_REG_SP)==verify.SP
        assert [c.reg_read(reg) for reg in verify.SAVED]==saved
        return c.reg_read(UC_ARM_REG_R0)
    p = profile['functions']
    assert call(p['IsDsi']) == 1
    main = call(p['GetMainModule']); con = get(get(main+4)+8)
    battle = get(get(p['GetPfd']+12)); gauge = get(battle+0x1a4)
    assert 0x02400000 <= gauge < 0x03000000
    mons = [call(p['FrontBattler'],(con,call(p['ViewToBattle'],(main,pos)))) for pos in (0,1)]
    assert all(0x02400000 <= mon < 0x03000000 for mon in mons)
    pairs = [call(p['EffectiveTypes'],(mon,)) for mon in mons]
    calls = []; writes = []
    def native(c,pc,size,name):
        calls.append(name)
        for reg in verify.REGS+[UC_ARM_REG_R12]: c.reg_write(reg,0xdeadbeef)
        c.reg_write(UC_ARM_REG_R0,0); c.reg_write(UC_ARM_REG_PC,c.reg_read(UC_ARM_REG_LR))
    for name in ('Add','Main','Release'):
        c.hook_add(UC_HOOK_CODE,native,name,begin=p[name],end=p[name])
    def video(c,access,address,size,value,user):
        assert size in (2,4) and address%size == 0
        writes.append((address,size))
    c.hook_add(UC_HOOK_MEM_WRITE,video,begin=0x06400000,end=0x0640ffff)
    for pos,mon in enumerate(mons): call(entries['Add'],(gauge,main,mon,0,pos))
    failure = c.mem_read(state+360,1)[0]
    assert failure == (0 if expect_draw else 1)
    if expect_draw:
        for pos,pair in enumerate(pairs):
            record = state+pos*60
            assert get(record)==gauge and get(record+4)==mons[pos]
            graphics = get(record+12); length = 2048 if pos else 2304
            before = mem['obj'][graphics-0x06400000:graphics-0x06400000+length]
            expected = bytearray(verify.normalized(before))
            if pos: verify.enemy_header(expected,pos)
            else: verify.player_header(expected)
            verify.paint_expected(expected,(pair>>8,pair&255),pos,0)
            assert bytes(c.mem_read(graphics,length)) == expected, 'Captured native HUD pixels differ'
        assert writes
        writes.clear(); call(entries['Main'],(gauge,)); assert not writes
        call(entries['Release'],(gauge,))
        assert all(get(state+i*60)==0 for i in range(6))
    else:
        assert not writes and bytes(c.mem_read(0x06400000,0x10000)) == mem['obj']
        assert all(get(state+i*60)==0 for i in range(6))
    return dict(failure=failure, panels_drawn=2 if expect_draw else 0,
                gauge=hex(gauge), battlers=[hex(mon) for mon in mons],
                captured_types=[(pair>>8,pair&255) for pair in pairs],
                native_readers_executed=True, abi_preserved=True,
                unchanged_update_no_video_writes=True, cleanup_verified=expect_draw)

def main():
    capture,old_path = map(Path,sys.argv[1:3])
    new_path = Path(sys.argv[3]) if len(sys.argv)>3 else HERE/'build/TypeIconsSolidW2.dll'
    mem = read_state(capture)
    profile = json.loads((HERE/'profile-W2.json').read_text())
    old = read_rpm(old_path.read_bytes()); new = read_rpm(new_path.read_bytes())
    verify.ASSETS = json.loads((HERE/'assets-solid.json').read_text())
    report = dict(diagnosis=loaded_module(mem,profile,old),
                  old=replay(mem,profile,old,False), fixed=replay(mem,profile,new,True),
                  release_sha256=hashlib.sha256(new_path.read_bytes()).hexdigest(),
                  limitations=['Supplied captured memory and isolated compiled function calls; no game boot or frames.',
                               'Native gauge creation/update/release are no-ops; native object, image, palette, type and mode readers execute.'])
    (HERE/'build/dsi-captured-state-verification.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))

if __name__ == '__main__': main()

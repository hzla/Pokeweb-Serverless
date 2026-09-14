"""Private melonDS test session. Reset boot on first invocation; no user saves changed.

Usage: live.py W2 '[[0,600],[1,1],[0,300]]'
       live.py W2 '[["touch",218,167,4],[0,180]]'
"""
from pathlib import Path
import hashlib, json, shutil, struct, sys, os
import ndspy.rom
from analyze import HERE,ROOT
sys.path.insert(0,str(ROOT/'work/scan-button/emulator-ref/python'))
from melonds import MelonDS
from rpm_read import read_rpm
def report(emu,game,rom_path=None,module="TypeIcons"):
    p=json.loads((HERE/f'profile-{game}.json').read_text())
    rom_path=rom_path or HERE/'build'/f'live-{game}{os.environ.get("BTH_LIVE_SUFFIX","")}'/'typehud.nds'
    dll=ndspy.rom.NintendoDSRom.fromFile(rom_path).getFileByName(f'patches/{module}{game}.dll')
    rpm=read_rpm(dll)
    h=next(h for h in p['hooks'] if h['name']==('Main' if module=='TypeIcons' else 'MoveKey'))
    a=emu.memory.read_short(h['address']);b=emu.memory.read_short(h['address']+2);value=a|(b<<16)
    d=((a&2047)<<12)|((b&2047)<<1)
    if d&0x400000:d-=0x800000
    dest=h['address']+4+d
    rel=next(r for r in rpm['relocations'] if r['module']=='168' and r['address']==h['address'])
    hookSymbol=rpm['symbols'][rel['symbol']]
    base=dest-hookSymbol['address']
    out=dict(frame=emu.frame_count,pc=hex(emu.memory.register_arm9.pc),update_hook=hex(value),dll_sha256=hashlib.sha256(dll).hexdigest())
    if 0x02200000<=base<0x02400000:
        state=base+len(rpm['code']) # each standalone module has exactly one BSS object
        if module=='MoveEffectiveness':
            out.update(module_code_base=hex(base),state_address=hex(state),failure=emu.memory.read_byte(state+19),input=hex(emu.memory.read_long(state)))
            return out
        out.update(module_code_base=hex(base),state_address=hex(state),failure=emu.memory.read_byte(state+360),
                   redraws=emu.memory.read_short(state+362),bindings=emu.memory.read_byte(state+361))
        out['records']=[]
        for i in range(6):
            r=state+i*60
            out['records'].append(dict(gauge=hex(emu.memory.read_long(r)),battler=hex(emu.memory.read_long(r+4)),
                graphics=hex(emu.memory.read_long(r+12)),types=hex(emu.memory.read_short(r+46)),
                pos=emu.memory.read_byte(r+50),status=emu.memory.read_byte(r+51),painted=emu.memory.read_byte(r+52),bank=emu.memory.read_byte(r+53)))
    return out
def main():
    game=sys.argv[1];actions=json.loads(sys.argv[2]);folder=HERE/'build'/f'live-{game}{os.environ.get("BTH_LIVE_SUFFIX","")}'
    rom=folder/'typehud.nds';save=rom.with_suffix('.sav')
    source=Path('/Users/andylee/Downloads')/('Cascade White Marlon Build - 20.sav' if game=='W2' else 'black2.sav')
    if not save.exists():shutil.copyfile(source,save)
    emu=MelonDS(ROOT/'work/scan-button/emulator-build/src/headless/libmelonds_headless.dylib')
    emu.open(rom);state=folder/'session.mln'
    if state.exists():emu.savestate.load_file(state)
    for action in actions:
        if action[0]=='touch':
            _,x,y,n=action;emu.input.touch_set_pos(x,y);emu.run_frames(n);emu.input.touch_release()
        else:
            keys,n=action;emu.input.keypad_update(keys);emu.run_frames(n)
    emu.savestate.save_file(state);emu.screenshot().save(folder/'screen.png')
    r=report(emu,game);(folder/'session.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2))
    emu.destroy()
if __name__=='__main__':main()

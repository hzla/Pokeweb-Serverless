"""Cold-boot copied battle fixtures and verify the native border palette owner."""
from pathlib import Path
import argparse,hashlib,json,shutil,struct,sys,tempfile
import ndspy.rom
from rpm_read import read_rpm
HERE=Path(__file__).resolve().parent

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('fixtures',type=Path);p.add_argument('--library',required=True);p.add_argument('--bindings',required=True);p.add_argument('--out',type=Path,required=True)
    args=p.parse_args();args.out.mkdir();sys.path.insert(0,args.bindings)
    from melonds import MelonDS
    profile=json.loads((HERE/'profile-TypeIcons-W2.json').read_text());manifest=json.loads((HERE.parents[1]/'src/assets/codeinjection/typeIconBorderManifest.json').read_text())
    rows=[]
    for style,module in [('letters','TypeIconsBorderReduxW2'),('circular','TypeIconsBorderCircularReduxW2')]:
        source=args.fixtures/(style+'.nds');rom=ndspy.rom.NintendoDSRom.fromFile(source);dll=bytes(rom.getFileByName('patches/TypeIconsW2.dll'));rpm=read_rpm(dll)
        debug=read_rpm((HERE/'build/icon-borders'/(module+'.debug.dll')).read_bytes())
        at=manifest['games']['W2']['variants'][style+'-redux']['build']['borderColorOffset'];normalized=bytearray(rpm['code']);normalized[at:at+4]=debug['code'][at:at+4]
        assert normalized==debug['code']
        main=next(h for h in profile['hooks'] if h['name']=='Main');rel=next(r for r in rpm['relocations'] if r['module']=='168' and r['address']==main['address'])
        with tempfile.TemporaryDirectory(prefix='icon-border-emulator-') as folder:
            target=Path(folder)/'test.nds';shutil.copyfile(source,target);shutil.copyfile(source.with_suffix('.sav'),target.with_suffix('.sav'))
            emu=MelonDS(args.library)
            try:
                emu.open(target);emu.run_frames(580)
                a=emu.memory.read_short(main['address']);b=emu.memory.read_short(main['address']+2)
                assert a&0xf800==0xf000 and b&0xf800==0xf800
                delta=((a&2047)<<12)|((b&2047)<<1)
                if delta&0x400000:delta-=0x800000
                base=main['address']+4+delta-rpm['symbols'][rel['symbol']]['address']
                assert 0x02000000<base<0x02400000
                state=base+next(s['address'] for s in debug['symbols'] if s['name']=='gBattleTypeHud')
                borderSymbol=next(s for s in debug['symbols'] if s['name']=='_ZN12_GLOBAL__N_112borderStatesE');border=base+borderSymbol['address'];stride=borderSymbol['size']//6
                failure=emu.memory.read_byte(state+360);assert failure==0,('native runtime failure',failure)
                assert emu.memory.read_byte(state+361)==2
                ctx=emu.memory.read_long(0x214197c);records=emu.memory.read_long(ctx+272);shown=[]
                for index in (0,1):
                    record=state+60*index;flags=emu.memory.read_byte(record+56);assert flags&128
                    saved=border+stride*index;bank=emu.memory.read_byte(saved+96);ident=emu.memory.read_byte(saved+97);assert emu.memory.read_byte(saved+99)==1
                    assert 10<=bank<16
                    row=records+24*ident
                    assert emu.memory.read_long(row+12)==bank*32 and emu.memory.read_long(row+20)==32
                    assert emu.memory.read_short(0x5000200+bank*32+2)==0x6b5a
                    native=emu.memory.read_byte(record+57);assert emu.memory.read_short(0x5000200+native*32+4)==0x842
                    shown.append(dict(position=flags&7,status=(flags>>3)&7,painted=bool(flags&64),borderPaletteBank=bank,nativePaletteBank=native))
                emu.run_frames(30);assert emu.memory.read_byte(state+360)==0
                emu.screenshot().save(args.out/(style+'.png'))
                rows.append(dict(style=style,dllSha256=hashlib.sha256(dll).hexdigest(),frame=610,passed=True,nativeReservationVerified=True,nativeOutlineUnchanged=True,borderColor='#d6d6d6',records=shown))
                print(style,'native palette reservation and separate light-gray borders passed',flush=True)
            finally:emu.destroy()
    (args.out/'report.json').write_text(json.dumps(dict(game='W2',profile='redux',scope='Singles cold boot using copied trainer battle and bundled save.',passed=True,checks=rows),indent=2)+'\n')
if __name__=='__main__':main()

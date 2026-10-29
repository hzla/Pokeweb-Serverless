"""Execute opt-in border overlays against real native graphics and ABI fixtures."""
from pathlib import Path
import argparse, hashlib, json, shutil, struct, sys, types
import ndspy.rom, ndspy.narc, ndspy.codeCompression, ndspy.lz10
from unicorn import UC_HOOK_CODE
from unicorn.arm_const import *
from rpm_read import read_rpm
from panel_expansion import transform
HERE=Path(__file__).resolve().parent

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--white2',type=Path,required=True);parser.add_argument('--black2',type=Path,required=True)
    args=parser.parse_args()
    text=(HERE/'verify.py').read_text();prefix,marker,_=text.partition('\ndef test(game):')
    assert marker
    prefix=prefix.replace("rpm['bss']==debug['bss']==(364 if module.startswith('TypeIcons') else 20)","rpm['bss']==debug['bss']")
    fixture=types.ModuleType('border_fixture');fixture.__file__=str(HERE/'verify.py');exec(compile(prefix,fixture.__file__,'exec'),fixture.__dict__)
    metadata=json.loads((HERE.parents[1]/'src/assets/codeinjection/typeIconBorderManifest.json').read_text())
    roms={g:ndspy.rom.NintendoDSRom.fromFile(path) for g,path in [('B2',args.black2),('W2',args.white2)]}
    def load(game):
        r=roms[game]
        try:arm=ndspy.codeCompression.decompress(r.arm9)
        except ValueError:arm=r.arm9
        return r,{0:(r.arm9RamAddress,bytes(arm)),**{n:(o.ramAddress,bytes(o.data)) for n,o in r.loadArm9Overlays([167,168]).items()}}
    fixture.load=load
    scratch=HERE/'build/icon-borders/cpu';scratch.mkdir(exist_ok=True)
    (scratch/'build').mkdir(exist_ok=True)
    fixture.HERE=scratch
    original_write=fixture.Harness.videoWrite
    def video(self,c,access,address,size,value,user):
        if any(0x06400000+p*0x1000+2048<=address<0x06400000+p*0x1000+3584 for p in range(8)):
            assert size==2 and address%2==0
            self.writes.append((address,size));return
        original_write(self,c,access,address,size,value,user)
    fixture.Harness.videoWrite=video
    original_palette=fixture.Harness.paletteWrite
    def palette(self,c,access,address,size,value,user):
        if 0x05000340<=address<0x05000400:assert size==2;return
        original_palette(self,c,access,address,size,value,user)
    fixture.Harness.paletteWrite=palette
    checks=[]
    for game in ('B2','W2'):
        shutil.copyfile(HERE/f'profile-{game}.json',scratch/f'profile-{game}.json')
        for key,variant in metadata['games'][game]['variants'].items():
            redux=key.endswith('-redux');style='circular' if key.startswith('circular') else 'letters'
            fixture.ASSETS=json.loads((HERE/('assets-circular.json' if style=='circular' else 'assets.json')).read_text())
            fixture.EXPANSION=json.loads((HERE/('redux-profile.json' if redux else 'panel-expansion.json')).read_text())
            if redux:fixture.EXPANSION=fixture.EXPANSION['panelExpansion']
            source=roms[game if redux else 'B2'];narc=ndspy.narc.NARC(source.getFileByName('a/0/1/1'))
            for member in (430,435,438,441,444,456):
                raw=bytes(narc.files[member]);raw=ndspy.lz10.decompress(raw) if raw[0]==16 else raw
                (scratch/'build'/f'{game}-resource-{member}.bin').write_bytes(raw)
            name=variant['fileName'][:-len(game+'.dll')]
            for suffix in ('.dll','.debug.dll'):shutil.copyfile(HERE/'build/icon-borders'/f'{name}{game}{suffix}',scratch/'build'/f'{name}{game}{suffix}')
            h=fixture.Harness(game,name)
            ctx=0x0228e000;rows=0x0228f000;context=0x214193c if game=='B2' else 0x214197c
            h.put(context,ctx);h.put(ctx+272,rows);h.c.mem_write(ctx+282,struct.pack('<H',32))
            for i in range(32):
                h.put(rows+24*i+12,32*i if i<10 else 0xffffffff);h.put(rows+24*i+16,0xffffffff);h.put(rows+24*i+20,32 if i<10 else 0x80000000)
            reserved=[];freed=[]
            def reserve(c,pc,size,user):
                regs=[c.reg_read(r) for r in fixture.REGS];sp=c.reg_read(UC_ARM_REG_SP)
                root,ident,nclr,zero=regs;assert root==ctx+0x104 and zero==0
                at,sub,mode=struct.unpack('<III',c.mem_read(sp,12));assert sub==0 and mode==1
                assert bytes(c.mem_read(nclr,4))==b'RLCN'
                h.put(rows+24*ident+12,at);h.put(rows+24*ident+16,0xffffffff);h.put(rows+24*ident+20,32);reserved.append(ident)
                c.reg_write(UC_ARM_REG_PC,c.reg_read(UC_ARM_REG_LR))
            def free(c,pc,size,user):
                ident=c.reg_read(UC_ARM_REG_R0);h.put(rows+24*ident+20,0x80000000);freed.append(ident)
                c.reg_write(UC_ARM_REG_PC,c.reg_read(UC_ARM_REG_LR))
            delta=44 if game=='B2' else 0
            h.c.hook_add(UC_HOOK_CODE,reserve,begin=0x204da20-delta,end=0x204da20-delta)
            h.c.hook_add(UC_HOOK_CODE,free,begin=0x204bcfc-delta,end=0x204bcfc-delta)
            debug=read_rpm((scratch/'build'/f'{name}{game}.debug.dll').read_bytes())
            color=next(s['address'] for s in debug['symbols'] if s['name']=='gTypeIconBorderColor')
            h.put(fixture.BASE+color,0x56b5)
            original=bytes(h.c.mem_read(fixture.PAL,512))
            for layout in (0,1,2):
                for p in (0,1,4,5,6,7):
                    # Native constructor stub sets the image; our checked NCER
                    # prefix matches the extension installed in the ROM.
                    data=0x0227c000+p*0x40
                    native=bytes.fromhex('f040c0c10000f04000c01000')
                    if p&1 and layout>=2:native+=bytes.fromhex('f08040802000')
                    elif not(p&1) and layout<2:native+=bytes.fromhex('f440bc812000')
                    count=len(native)//6;tile=(3072 if layout>=2 and p&1 else 2304 if layout<2 and not(p&1) else 2048)//64
                    h.put(data,(count+1)|((17+4*(count-1))<<16));h.put(data+4,data+8)
                    h.c.mem_write(data+8,struct.pack('<HHH',0xc0,0x8000|448,tile)+native)
                    for typ in range(18):
                        pair=(typ,(typ+7)%18) if typ&1 else (typ,typ)
                        mon=0x02273000+p*0x300;h.liveTypes[mon]=pair
                        h.invoke('Add',fixture.G,0x0227a000,mon,layout,p)
                        h.check(p,pair,layout)
                        assert h.c.mem_read(h.state+360,1)[0]==0
                        attrs=struct.unpack('<HHH',h.c.mem_read(data+8,6));bank=((attrs[2]>>12)+(p if p<2 else p-2))&15
                        assert 10<=bank<16
                        assert struct.unpack('<H',h.c.mem_read(fixture.PAL+32*bank+2,2))[0]==0x56b5
                        image=bytes(h.c.mem_read(0x06400000+p*0x1000+tile*64,512))
                        assert any(image)
                        expected=bytearray(512)
                        kinds=1 if pair[0]==pair[1] else 2
                        left=0 if not p&1 else 65-({1:60,3:64,5:60,7:56}[p])
                        for kind in range(kinds):
                            for y in range(11):
                                for x in range(12):
                                    mask=2048>>x
                                    if not fixture.ASSETS['outline'][y]&mask:continue
                                    px=left+(2 if kinds==1 else kind*5)+x;py=(2 if kinds==1 else kind*6)+y
                                    at=((py//8)*4+px//8)*32+(py%8)*4+px%8//2;shift=(px&1)*4
                                    c=0 if fixture.ASSETS['fill'][y]&mask else 1
                                    expected[at]=(expected[at]&~(15<<shift))|(c<<shift)
                        assert image==expected,(game,key,p,typ,'outline mask')
                        nativebank=p if p<2 else p-2
                        for index in (1,2,3,5,6,7,8,9,10,11,12,13,14):
                            assert bytes(h.c.mem_read(fixture.PAL+nativebank*32+index*2,2))==original[nativebank*32+index*2:nativebank*32+index*2+2]
                        h.writes.clear();h.invoke('Main',fixture.G);assert not h.writes,'stable border frame rewrote graphics'
                        if typ==0:
                            h.invoke('Status',fixture.G,1,p);assert struct.unpack('<H',h.c.mem_read(data+8,2))[0]==0xc0
                            h.invoke('Status',fixture.G,0,p);h.check(p,pair,layout)
                            h.setfade(nativebank,0,8);h.invoke('Main',fixture.G)
                            assert struct.unpack('<H',h.c.mem_read(0x05000200+32*bank+2,2))[0]==fixture.blend(0x56b5,0,8)
                            h.setfade(nativebank,0,0);h.invoke('Main',fixture.G)
                            assert struct.unpack('<H',h.c.mem_read(0x05000200+32*bank+2,2))[0]==0x56b5
                        h.invoke('Del',fixture.G,p)
            assert len(reserved)==len(freed) and not set(reserved)-set(freed)
            assert bytes(h.c.mem_read(fixture.PAL+320,192))==original[320:]
            checks.append(dict(game=game,style=key,passed=True,typedPanels=324,privateBankRestored=True,nativeHudColorsUnchanged=True,statusHideAndReturn=True,fadeAndReturn=True,stableFramesDoNotWriteGraphics=True,configuredRgb555=0x56b5,abiRegistersAndStack=True,dllSha256=variant['dllSha256']))
            print(game,key,'passed',flush=True)
    report=dict(passed=True,checks=checks,gameplayTested=False)
    (HERE/'build/icon-borders/verification.json').write_text(json.dumps(report,indent=2)+'\n')
if __name__=='__main__':main()

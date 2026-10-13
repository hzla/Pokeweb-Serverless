"""Execute the information-page companion and its allocation failure paths."""
import json,struct,subprocess,sys
from build import HERE,BUILD,TOOLS
sys.path.insert(0,str(HERE.parents[1]/'runtime/learnset-viewer/build/python'))
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_ARM,UC_MODE_THUMB,UC_HOOK_CODE
from unicorn.arm_const import *
import ndspy.narc

REGS=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3,UC_ARM_REG_R4,UC_ARM_REG_R5,
      UC_ARM_REG_R6,UC_ARM_REG_R7,UC_ARM_REG_R8,UC_ARM_REG_R9,UC_ARM_REG_R10,UC_ARM_REG_R11]
STOP=0x02008000;STACK=0x023f0000;CONFIG=0x02200000;WORK=0x02201000;ACTOR=0x02210000;PROXY=0x02230000

def verify(game):
    ad=44 if game=='B2' else 0;od=64 if ad else 0
    u=Uc(UC_ARCH_ARM,UC_MODE_THUMB);u.ctl_set_cpu_model(UC_CPU_ARM_946)
    u.mem_map(0x02000000,0x400000);u.mem_map(0x04000000,0x10000)
    src=BUILD/f'SummaryTypeIcons{game}.elf';linked=src.with_suffix('.linked.elf')
    subprocess.run([str(TOOLS/'arm-none-eabi-ld'),'-Ttext','0x02300000','-Tdata','0x02320000','-e','IconBanks',src,'-o',linked],check=True,capture_output=True)
    symbols={}
    with linked.open('rb') as f:
        elf=ELFFile(f)
        for s in elf.iter_sections():
            if s['sh_flags']&2 and s['sh_type']!='SHT_NOBITS':u.mem_write(s['sh_addr'],s.data())
        for s in elf.get_section_by_name('.symtab').iter_symbols():
            if s.name and s['st_shndx']!='SHN_UNDEF':symbols[s.name]=s['st_value']
    def read(p,n):return bytes(u.mem_read(p,n))
    def val(p):return struct.unpack('<I',read(p,4))[0]
    def args(n):return [u.reg_read(r) for r in REGS[:min(n,4)]]+[val(u.reg_read(UC_ARM_REG_SP)+4*i) for i in range(max(n-4,0))]
    def ret(v=0):u.reg_write(UC_ARM_REG_R0,v);u.reg_write(UC_ARM_REG_PC,u.reg_read(UC_ARM_REG_LR))
    log=[];uploads=[];tile_uploads=[];failure='';next_char=100;next_actor=0
    live_chars=set();live_actors=set();live_unit=False;live_palette=False;live_cells=False
    palette_data=json.loads((HERE/'assets/palettes.json').read_text())['types']
    narc=ndspy.narc.NARC((HERE.parents[1]/'src/assets/codeinjection/summaryTypeIcons.narc').read_bytes())
    def banks():
        c=list(struct.unpack('<12I',read(args(1)[0],48)));assert c[5]==64
        assert c[:5]+c[6:]==[1,0,4,0,2,256,0,8,32,0x200010,16];ret()
    def open_file():assert read(args(2)[1],31).startswith(b'rom:/summary-type-icons/ui.narc');ret(int(failure!='missing'))
    def palette():
        nonlocal live_palette
        assert args(7)==[0x02240000,0,0,512,0,0,23]
        if failure=='palette':ret(0xffffffff)
        else:live_palette=True;ret(19)
    def cells():
        nonlocal live_cells
        assert args(4)==[0x02240000,1,2,23]
        if failure=='cells':ret(0xffffffff)
        else:live_cells=True;ret(20)
    def unit():
        nonlocal live_unit
        assert args(3)==[2,0,23]
        if failure=='unit':ret(0)
        else:live_unit=True;ret(0x02250000)
    def char():
        nonlocal next_char
        assert args(5)==[0x02240000,3,0,0,23]
        if failure==f'char{next_char-100}':ret(0xffffffff);return
        live_chars.add(next_char);ret(next_char);next_char+=1
    def actor():
        nonlocal next_actor
        a=args(7);assert a[:4]==[0x02250000,100+next_actor,19,20] and a[5:]==[0,23]
        assert read(a[4],8)==struct.pack('<HHHBB',96+next_actor*34,16,0,10,1)
        if failure==f'actor{next_actor}':ret(0);return
        p=ACTOR+0x1000+next_actor*256;live_actors.add(p);ret(p);next_actor+=1
    def release_unit():
        nonlocal live_unit
        assert live_unit;live_unit=False;ret()
    def release_palette():
        nonlocal live_palette
        assert live_palette;live_palette=False;ret()
    def release_cells():
        nonlocal live_cells
        assert live_cells;live_cells=False;ret()
    def get_proxy():a=args(2);u.mem_write(a[1],struct.pack('<9I',a[0],*([0]*8)));ret()
    def upload():
        a=args(4);fmt,ext,size,p=struct.unpack('<4I',read(a[0],16))
        assert (fmt,ext,size,a[2])==(4,1,32,1) and a[1] in (0,512)
        uploads.append((a[1]//512,list(struct.unpack('<16H',read(p,size)))));ret()
    def tiles():a=args(5);assert a[0] in live_chars and a[2:]==[512,0,0];tile_uploads.append(read(a[1],512));ret()
    stubs={0x2046c6c:banks,0x204b6d4:lambda:ret(),0x203a228:lambda:ret(0x02240000),
           0x203a278:lambda:ret(),0x2070ca8:lambda:ret(),0x2070ecc:open_file,
           0x204aac8:lambda:ret(),0x204ab38:lambda:ret(),0x204bbe4:palette,0x204be0c:cells,
           0x204bf48:unit,0x204b848:char,0x204c06c:actor,
           0x204c134:lambda:(live_actors.remove(args(1)[0]),ret()),0x204bfc4:release_unit,
           0x204b9b8:lambda:(live_chars.remove(args(1)[0]),ret()),0x204bcfc:release_palette,0x204be90:release_cells,
           0x204bb84:get_proxy,0x204c3a4:lambda:(log.append(('offset',args(3))),ret()),
           0x204c150:lambda:(log.append(('visible',args(2))),ret()),
           0x204c16c:lambda:(log.append(('position',struct.unpack('<hh',read(args(2)[1],4)),args(1)[0])),ret()),
           0x2060f50:upload,0x204bae4:tiles,0x204b7f4:lambda:(log.append('vblank'),ret()),
           0x2076820:lambda:(log.append(('ext-end',args(1)[0])),ret())}
    native={a-ad:f for a,f in stubs.items()}
    native[0x21b36e4-od]=lambda:(log.append('native-resources'),ret())
    native[0x21b3664-od]=lambda:(log.append('native-end'),ret())
    def intercept(_u,a,_s,_):
        if a==STOP:u.emu_stop();return
        if a in native:assert u.reg_read(UC_ARM_REG_SP)%8==0,hex(a);native[a]();return
        assert 0x02300000<=a<0x02330000,hex(a)
    u.hook_add(UC_HOOK_CODE,intercept)
    def call(name,*a):
        for i,r in enumerate(REGS):u.reg_write(r,a[i] if i<min(len(a),4) else 0x11110000+i)
        for i,v in enumerate(a[4:]):u.mem_write(STACK+i*4,struct.pack('<I',v))
        u.reg_write(UC_ARM_REG_SP,STACK);u.reg_write(UC_ARM_REG_LR,STOP|1)
        u.emu_start(symbols[name]|1,STOP,count=50000)
        assert u.reg_read(UC_ARM_REG_PC)==STOP,name;assert u.reg_read(UC_ARM_REG_SP)==STACK
        assert [u.reg_read(r) for r in REGS[4:]]==list(range(0x11110004,0x1111000c)),name
    u.mem_write(CONFIG,struct.pack('<12I',1,0,4,0,2,0,256,0,8,32,0x200010,16))
    u.mem_write(WORK,struct.pack('<H',23));u.mem_write(WORK+0x130,struct.pack('<17I',*range(200,217)))
    u.mem_write(WORK+0x198,struct.pack('<II',ACTOR,ACTOR+256))
    for failure in ['', 'missing','palette','cells','unit','char0','char1','actor0','actor1']:
        next_char=100;next_actor=0;uploads.clear();tile_uploads.clear();log.clear()
        call('IconBanks',CONFIG);call('IconSystem',CONFIG,CONFIG,23);call('IconResources',WORK)
        assert log[0]=='native-resources'
        assert read(WORK+0x130,68)==struct.pack('<17I',*range(200,217)),'Native type characters changed'
        if not failure:
            for type_id in range(17):
                i=type_id%2;native_actor=ACTOR+i*256;custom=ACTOR+0x1000+i*256
                call('IconGetProxy',200+type_id,PROXY);call('IconPalette',native_actor,2,1)
                assert log[-2:]==[('offset',[native_actor,2,1]),('offset',[custom,i,1])]
                call('IconVisible',native_actor,1);assert log[-2:]==[('visible',[native_actor,0]),('visible',[custom,1])]
                call('IconVblank',12,34);assert uploads[-1]==(i,palette_data[type_id]['palette555'])
                assert tile_uploads[-1]==narc.files[3+type_id][48:]
            n=len(uploads);call('IconVblank',12,34);assert len(uploads)==n
            for i in range(2):
                call('IconVisible',ACTOR+i*256,0)
                assert log[-2:]==[('visible',[ACTOR+i*256,0]),('visible',[ACTOR+0x1000+i*256,0])]
        else:
            assert not live_chars and not live_actors and not live_unit and not live_palette and not live_cells
            call('IconGetProxy',200,PROXY);call('IconPalette',ACTOR,2,1);assert log[-1]==('offset',[ACTOR,2,1])
            call('IconVisible',ACTOR,1);assert log[-1]==('visible',[ACTOR,1]);call('IconVblank',12,34);assert not uploads
        u.mem_write(PROXY,struct.pack('<hh',130,48));call('IconInfoPosition',ACTOR+256,PROXY,0)
        assert log[-1][1]==(130,16)
        call('IconEnd',WORK);assert log[-2:]==['native-end',('ext-end',0)]
        assert not live_chars and not live_actors and not live_unit and not live_palette and not live_cells
    assert len(narc.files)==20 and struct.unpack_from('<II',narc.files[0],24)==(4,1)
    assert struct.unpack_from('<I',narc.files[0],32)[0]==2*512
    for f in narc.files[3:]:assert len(f)==560 and max(f[48:])<=15 and 0 in f[48:]
    print(game,'17 palettes/tiles, two information-only actors, native actor preservation, visibility, VBlank, ABI, all allocation failures and cleanup passed')

if __name__=='__main__':
    for game in ['W2','B2']:verify(game)

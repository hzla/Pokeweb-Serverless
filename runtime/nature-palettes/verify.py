"""Execute compiled decoder, hooks and scene adapters on ARM9 CPU fixtures.

File IO and native resource/identity services are explicit stub boundaries.
This does not establish DS rendering or gameplay acceptance.
"""
from pathlib import Path
import argparse, json, struct, math, os
import ndspy.rom, ndspy.codeCompression
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_R6, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC
from elftools.elf.elffile import ELFFile
HERE=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out',type=Path,required=True)
args=parser.parse_args()
STOP,STACK=0x023f0000,0x023e0000
SYS,PP,MAW,TASK,WORK,NCLR,SOURCE,BASE,BEW,SCU,MAIN,CON,MON,DISGUISE,TARGET=0x02200000,0x02201000,0x02202000,0x02204000,0x02205000,0x02206000,0x02206100,0x02206200,0x02207000,0x02208000,0x02209000,0x0220a000,0x0220b000,0x0220c000,0x0220d000
REGS=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3]
def key(sprite=607,source=0,nature=15,shiny=0):return ((sprite*3+source)*25+nature)*2+shiny
def table(records):
    records=sorted(records)
    at=16+8*len(records);directory=bytearray();payload=bytearray()
    for k,mask,colors in records:
        directory+=struct.pack('<II',k,at)
        block=struct.pack('<H'+'H'*len(colors),mask,*colors);payload+=block;at+=len(block)
    return struct.pack('<IHHII',0x504e5750,1,16,len(records),at)+directory+payload
NATIVE={}
def native(game):
    if game not in NATIVE:
        path=Path(os.environ.get('NATURE_PALETTE_'+game+'_ROM',HERE.parents[2]/('cleanwhite2.nds' if game=='W2' else 'cleanblack2.nds')))
        rom=ndspy.rom.NintendoDSRom.fromFile(path);o=rom.loadArm9Overlays([167])[167]
        NATIVE[game]=(rom.arm9RamAddress,bytes(ndspy.codeCompression.decompress(rom.arm9)),o.ramAddress,bytes(o.data))
    return NATIVE[game]
class Machine:
    def __init__(self,game,scene,data):
        self.game=game;self.scene=scene;self.data=data;self.cursor=0;self.reads=0;self.closed=0;self.old=0;self.nature_reads=0;self.stack_min=STACK
        self.uc=Uc(UC_ARCH_ARM,UC_MODE_THUMB);self.uc.mem_map(0x02000000,0x400000)
        arm,armbytes,overlay,ovbytes=native(game);self.uc.mem_write(arm,armbytes);self.uc.mem_write(overlay,ovbytes)
        with (HERE/'build'/game/(scene+'-native')/'cpu.elf').open('rb') as f:
            elf=ELFFile(f);self.symbols={s.name:s['st_value'] for s in elf.get_section_by_name('.symtab').iter_symbols()}
            for s in elf.iter_segments():
                if s['p_type']=='PT_LOAD':self.uc.mem_write(s['p_vaddr'],s.data())
        self.uc.hook_add(UC_HOOK_CODE,self.callback)
        self.write(PP,12345);self.uc.mem_write(PP+0x41,bytes([15]));self.write(MON,PP);self.write(TARGET,PP+0x100);self.uc.mem_write(PP+0x141,bytes([7]));self.uc.mem_write(MON+0x19,bytes([5]));self.uc.mem_write(TARGET+0x19,bytes([6]))
        self.write(TASK+4,NCLR);self.write(TASK+0x24,WORK);self.write(NCLR+8,32);self.write(NCLR+12,SOURCE);self.write(WORK+0xd4,BASE);self.write(WORK+0xdc,32)
        self.uc.mem_write(SOURCE,struct.pack('<16H',*range(16)));self.uc.mem_write(BASE,struct.pack('<16H',*range(16)))
        self.write(MAW,4);self.write(MAW+8,607*20+18)
        self.write(self.A(0x021f4280),BEW);self.write(BEW+0x1e0,SCU);self.write(BEW+0x1e4,MAIN);self.write(SCU+0x138,CON)
    def A(self,a):
        if self.game=='B2':
            if 0x020191d8<=a<0x02100000:return a-44
            if 0x02199900<=a<0x02200000:return a-64
        return a
    def write(self,a,v):self.uc.mem_write(a,struct.pack('<I',v))
    def ret(self,v=0):self.uc.reg_write(UC_ARM_REG_R0,v);self.uc.reg_write(UC_ARM_REG_PC,self.uc.reg_read(UC_ARM_REG_LR))
    def callback(self,uc,at,size,_):
        self.stack_min=min(self.stack_min,uc.reg_read(UC_ARM_REG_SP))
        if at==STOP:uc.emu_stop();return
        a=[uc.reg_read(r) for r in REGS]
        if at==self.A(0x02070ca8):self.ret()
        elif at==self.A(0x02070ecc):self.cursor=0;self.ret(self.data is not None)
        elif at==self.A(0x02070dec):self.ret(len(self.data))
        elif at==self.A(0x02070e54):self.cursor=a[1];self.ret(self.cursor<=len(self.data))
        elif at==self.A(0x02070e6c):
            b=self.data[self.cursor:self.cursor+a[2]]
            if b:uc.mem_write(a[1],b)
            self.cursor+=len(b);self.reads+=1;self.ret(len(b))
        elif at==self.A(0x02070de0):self.closed+=1;self.ret(1)
        elif at==self.A(0x0201cd24):
            assert a[1] in [0,0x70],a
            if a[1]==0x70:self.nature_reads+=1;self.ret(uc.mem_read(a[0]+0x41,1)[0])
            else:self.ret(struct.unpack('<I',uc.mem_read(a[0],4))[0])
        elif at==self.A(0x0201ef48):
            assert a[1]==0 and a[2] in (0x1f,0x20)
            self.ret(4 if a[2]==0x20 else 12)
        elif at==self.A(0x0201c1b4):self.write(a[0]+0x38,self.A(0x0201c1c4)|1);self.write(a[0]+0x3c,a[1]);self.ret()
        elif at==self.A(0x0201c1c4):self.old+=1;self.ret(1)
        elif at==self.A(0x0201c008):
            uc.mem_write(a[1],bytes(36));self.write(a[1],4);self.write(a[1]+8,607*20+18+(uc.mem_read(a[0]+0x42,1)[0]&1));self.ret()
        elif at==self.A(0x0201a8d4):uc.reg_write(UC_ARM_REG_PC,self.symbols['NatureTestAdd'])
        elif at==self.A(0x02019c04):uc.reg_write(UC_ARM_REG_PC,self.symbols['NatureTestReload'])
        elif at==self.A(0x0219c784):assert a[1]<8;self.ret(0)
        elif at==self.A(0x0219d1c8):self.ret(MON)
        elif at==self.A(0x0219c688):self.ret(0) # battle ID -> client party index
        elif at==self.A(0x0219d414):self.ret(0x02211000) # party boundary
        elif at==self.A(0x0219d4c8):self.ret(2)
        elif at==self.A(0x0219d534):self.ret(MON if a[1]==0 else DISGUISE)
        elif at==self.A(0x021baa1c):self.ret() # move PP initialization is outside appearance state
        elif at==self.A(0x0203a278):self.ret()
    def call(self,name,*args,stack=(),r6=0):
        self.uc.reg_write(UC_ARM_REG_SP,STACK);self.uc.reg_write(UC_ARM_REG_LR,STOP|1);self.uc.reg_write(UC_ARM_REG_R6,r6)
        for r,v in zip(REGS,args):self.uc.reg_write(r,v)
        for i,v in enumerate(stack):self.write(STACK+i*4,v)
        self.uc.emu_start(self.symbols[name]|1,STOP,count=200000)
        assert self.uc.reg_read(UC_ARM_REG_PC)==STOP,('did not return',name,hex(self.uc.reg_read(UC_ARM_REG_PC)))
        return self.uc.reg_read(UC_ARM_REG_R0)
    def palette(self,a=SOURCE):return struct.unpack('<16H',self.uc.mem_read(a,32))
checks=[]
for game in ['W2','B2']:
 for scene in ['battle','summary']:
    records=[(key(source=s,nature=n,shiny=h),1<<5,[100+s*100+n*2+h]) for s in range(3) for n in range(25) for h in [0,1]]
    data=table(records)
    m=Machine(game,scene,data);apply=next(n for n in m.symbols if n.startswith('_ZN15nature_palettes5apply'))
    for k,mask,colors in records:
        m.uc.mem_write(SOURCE,struct.pack('<16H',*range(16)));before=m.reads
        assert m.call(apply,SOURCE,k)==1
        assert m.palette()==tuple(colors[0] if i==5 else i for i in range(16))
        assert m.reads-before<=math.ceil(math.log2(len(records)))+6
    overlapping=bytearray(table([(key(),32,[1]),(key()+1,32,[2])]))
    struct.pack_into('<I',overlapping,28,33)
    malformed=[None,data[:-1],b'wrong',table([(key(),1,[1])]),table([(key(),32,[0x8000])]),
        table([(key(),96,[1,0x8000])]),table([(key(),32,[1]),(key(),32,[2])]),bytes(overlapping)]
    for b in malformed:
        m=Machine(game,scene,b);before=m.palette();assert m.call(apply,SOURCE,key())==0;assert m.palette()==before
    m=Machine(game,scene,table([(key(),32,[992])]))
    sprite=next(n for n in m.symbols if n.startswith('_ZN15nature_palettes6sprite'))
    assert m.call(sprite,607,0)==607 and m.call(sprite,386,2)==698
    assert m.call(sprite,386,4)==386 and m.call(sprite,650,0)==65535
    if scene=='summary':
        hook=f'THUMB_BRANCH_LINK_207_0x{m.A(0x021b6728):08x}'
        assert m.call(hook,SYS,PP,0,123,stack=[456,789])==WORK
        assert m.palette()[5]==992 and m.palette(BASE)[5]==992 and m.old==1
        assert struct.unpack('<I',m.uc.mem_read(SYS+0x38,4))[0]==0
    else:
        assert m.call('PWNP_BattleNature',0)==15
        assert m.call('PWNP_Transform',MON,TARGET)==1
        assert m.call('PWNP_BattleNature',0)==7
        m.uc.mem_write(MON+0x1b,b'\0')
        assert m.call('PWNP_BattleNature',0)==15
        selfpp=PP+0x200;m.write(DISGUISE,selfpp);m.write(MON+4,selfpp);m.uc.mem_write(selfpp+0x41,bytes([3]));m.uc.mem_write(MON+0x1b,b'\x40')
        assert m.call('PWNP_BattleNature',0)==3
        m.uc.mem_write(MON+0x1b,b'\0')
        hook=f'THUMB_BRANCH_LINK_168_0x{m.A(0x021e6cea):08x}'
        assert m.call(hook,SYS,123,456,789,stack=[MAW,0,0],r6=0x02210000)==WORK
        assert m.palette()[5]==992 and m.palette(BASE)[5]==992
        m.write(BEW+0x190,0x02210000);m.write(0x02210008,WORK);m.write(0x02210050,0)
        for address in (0x021e7e04,0x021e7e8c,0x021e7fb6,0x021e7ff2):
            m.uc.mem_write(SOURCE,struct.pack('<16H',*range(16)))
            m.call(f'THUMB_BRANCH_LINK_168_0x{m.A(address):08x}',SYS,WORK,MAW)
            assert m.palette()[5]==992 and m.palette(BASE)[5]==992
        m.call('PWNP_BattleTerm')
    checks.append({'game':game,'scene':scene,'paletteCases':len(records),'malformedCases':len(malformed),'hooksAndStoredNature':True,'forms':True,'retailIllusionAndTransform':scene=='battle','compiledFixtureStackBytes':STACK-m.stack_min})
args.out.parent.mkdir(parents=True,exist_ok=True)
args.out.write_text(json.dumps({'checks':checks,'passed':True,'boundaries':'Native filesystem, resource allocation, Pokemon getters and party/position lookup are stubbed. Retail GetIllusionDisguise and TransformSet execute with compiled adapters; move PP initialization is a stub.'},indent=2)+'\n')
print('Compiled ARM checks passed:',sum(c['paletteCases'] for c in checks),'palettes, both scene adapters and both games')

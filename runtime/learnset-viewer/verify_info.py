"""Compiled W2/B2 info-panel tests and previews with the ROM's actual font/icons.

Runs Thumb code in isolation. Filesystem, allocator, and presentation boundaries
are instrumented; this is NOT a full game/emulator acceptance test.
"""
import json, struct, subprocess, sys, zlib
from pathlib import Path
import ndspy.rom, ndspy.narc, ndspy.codeCompression
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'build/python'))
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_CPU_ARM_946, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC
TOOLS=HERE.parents[2]/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'
REGS=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3,UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7]
WORK, REQUEST, BITMAP, PIXELS, MAP, BUFFER, STOP, STACK=0x02300000,0x02301000,0x02302000,0x02310000,0x02318000,0x02319000,0x02ef0000,0x02ff0000
MESSAGES=json.loads((HERE/'info_messages.json').read_text())

def decode_bank(data):
    count=struct.unpack_from('<H',data,2)[0];block=struct.unpack_from('<I',data,12)[0];out=[]
    for i in range(count):
        at,n=struct.unpack_from('<IH',data,block+4+i*8)
        enc=list(struct.unpack_from('<'+'H'*n,data,block+at));key=enc[-1]^65535;dec=[]
        for value in reversed(enc):dec.append(value^key);key=((key>>3)|(key<<13))&65535
        dec.reverse()
        if dec[0]==0xf100:
            values=[];bits=0;acc=0
            for value in dec[1:]:
                acc|=value<<bits;bits+=16
                while bits>=9:
                    v=acc&511;values.append(65535 if v==511 else v);acc>>=9;bits-=9
            dec=values
        out.append(''.join(chr(c) for c in dec[:dec.index(65535)]))
    return out

class Font:
    def __init__(self,rom):
        # The US tutor initializes font archive 23, member 0 (large).
        self.raw=ndspy.narc.NARC(rom.getFileByName('a/0/2/3')).files[0]
        self.glyph,_,self.mapping=struct.unpack_from('<III',self.raw,32)
        self.w,self.h,self.size=struct.unpack_from('<BBH',self.raw,self.glyph)
        self.cache={}
    def char(self,ch):
        if ch in self.cache:return self.cache[ch]
        code=ord(ch);at=self.mapping;data=self.raw
        while True:
            first,last,method,_,nxt=struct.unpack_from('<HHHHI',data,at)
            if first<=code<=last:
                if method==0:index=code-first+struct.unpack_from('<H',data,at+12)[0]
                elif method==1:index=struct.unpack_from('<H',data,at+12+2*(code-first))[0]
                else:index=dict(struct.iter_unpack('<HH',data[at+14:at+14+4*struct.unpack_from('<H',data,at+12)[0]]))[code]
                break
            assert nxt,(ch,code)
            at=nxt
        at=self.glyph+8+index*self.size;left,width,advance=data[at:at+3]
        raw=data[at+3:at+self.size]
        pixels={(x+left,y):((raw[(y*self.w+x)//4]>>(6-2*((y*self.w+x)%4)))&3) for y in range(self.h) for x in range(self.w)}
        self.cache[ch]=(advance,{p:c for p,c in pixels.items() if c in (1,2)})
        return self.cache[ch]
    def text(self,text):
        cursor=0;out={}
        for ch in text:
            advance,glyph=self.char(ch);out.update({(x+cursor,y):c for (x,y),c in glyph.items()});cursor+=advance
        return cursor,out

def png(path,width,height,pixels):
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
    scan=b''.join(b'\0'+bytes(pixels[y*width*3:(y+1)*width*3]) for y in range(height))
    path.write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(scan))+chunk(b'IEND',b''))

class Harness:
    def __init__(self,game):
        self.game=game;self.delta=0 if game=='W2' else 0x2c
        self.rom=ndspy.rom.NintendoDSRom.fromFile(HERE.parents[2]/('cleanwhite2.nds' if game=='W2' else 'cleanblack2.nds'))
        self.font=Font(self.rom)
        self.c=Uc(UC_ARCH_ARM,UC_MODE_THUMB);self.c.ctl_set_cpu_model(UC_CPU_ARM_946)
        self.c.mem_map(0x02000000,0x1000000);self.c.mem_map(0x05000000,0x1000)
        self.c.mem_write(self.rom.arm9RamAddress,bytes(ndspy.codeCompression.decompress(self.rom.arm9)))
        linked=HERE/f'build/info-{game}.elf'
        subprocess.run([str(TOOLS/'arm-none-eabi-ld'),'-Ttext','0x02e00000','-Tdata','0x02e80000','-e','LearnsetWindow',str(HERE/f'build/LearnsetViewer{game}.elf'),'-o',str(linked)],check=True,capture_output=True)
        with linked.open('rb') as stream:
            elf=ELFFile(stream);self.symbols={s.name:s['st_value'] for s in elf.get_section_by_name('.symtab').iter_symbols() if s.name and s['st_shndx']!='SHN_UNDEF'}
            for section in elf.iter_sections():
                if section['sh_flags']&2 and section['sh_type']!='SHT_NOBITS':self.c.mem_write(section['sh_addr'],section.data())
        self.stubs={};self.c.hook_add(UC_HOOK_CODE,self.intercept)
        self.reset()
        self.stub(0x2039dc8,lambda:self.ret(self.alloc(self.r(1))))
        self.stub(0x203a278,lambda:(self.free(self.r(0)),self.ret()))
        self.stub(0x2048788,lambda:self.ret(self.open_message(self.r(2))))
        self.stub(0x2048800,lambda:(self.free(self.r(0)),self.ret()))
        self.stub(0x20489b8,lambda:self.ret(self.message(self.r(0),self.r(1))))
        self.stub(0x2048590,lambda:(self.free(self.r(0)),self.ret()))
        self.stub(0x204871c,lambda:self.ret(self.r(0)))
        self.stub(0x2048640,lambda:(self.strings.__setitem__(self.r(0),self.text(self.r(1))),self.ret()))
        self.stub(0x20228b4,lambda:self.ret(self.font.text(self.strings[self.r(0)])[0]))
        self.stub(0x2021d54,self.draw)
        self.stub(0x2048520,lambda:self.ret(BITMAP))
        self.stub(0x2047168,lambda:(self.c.mem_write(PIXELS,bytes([self.r(1)*17])*24576),self.ret()))
        # Pixel data accessor executes the actual retail routine.
        self.w32(BITMAP,PIXELS)
        self.stub(0x201cd24,lambda:self.ret({5:self.species,0x6f:self.form,0x6e:0}.get(self.r(1),0)))
        self.stub(0x20204ac,lambda:self.ret(self.personal_id(self.r(0),self.r(1))))
        self.stub(0x201ef48,self.personal_param)
        # Icon routines execute real US code, including form & palette tables.
        self.stub(0x204aa30,lambda:self.ret(1))
        self.stub(0x2070ca8,lambda:self.ret())
        self.stub(0x2070ecc,self.open_file)
        self.stub(0x2070dec,lambda:self.ret(len(self.files[self.opened[self.r(0)][0]])))
        self.stub(0x2070e54,lambda:(self.opened[self.r(0)].__setitem__(1,self.r(1)),self.ret(1)))
        self.stub(0x2070e6c,self.read_file)
        self.stub(0x2070de0,lambda:(self.opened.pop(self.r(0)),self.ret(1)))
        self.stub(0x204c150,lambda:(self.hidden.append((self.r(0),self.r(1))),self.ret()))
        self.stub(0x2044cc4,lambda:(self.bg.append((self.r(0),self.r(1))),self.ret()))
        self.stub(0x2048270,lambda:self.ret())
        self.stub(0x2048298,lambda:(self.c.mem_write(MAP,struct.pack('<1024H',*[14<<12|i for i in range(1024)])),self.ret()))
        self.stub(0x2045840,lambda:self.ret(MAP))
        self.stub(0x2045ba8,lambda:self.ret())
        self.stub(0x203df28,lambda:self.ret(self.keys))
        self.stub(0x20480ec,self.create_window)
    def reset(self):
        self.files={p:bytes(self.rom.getFileByName(p)) for p in ['a/0/1/6','a/0/1/9','a/0/0/2','a/0/0/7']}
        archive=ndspy.narc.NARC(self.files['a/0/0/2'])
        self.messages={i:decode_bank(archive.files[i]) for i in [90,64,403,401,487,374]}
        start=len(self.messages[401]);self.messages[401]+=[t for _,t in MESSAGES]
        file=bytearray(archive.files[401]);struct.pack_into('<H',file,2,len(self.messages[401]));archive.files[401]=file
        self.files['a/0/0/2']=bytes(archive.save())
        config=self.symbols['learnsetInfoConfig']
        for i in range(len(MESSAGES)):self.c.mem_write(config+12+4*i,struct.pack('<HH',start+i,(start+i)^65535))
        self.arena=0x02400000;self.allocations={};self.peak=0;self.strings={};self.handles={};self.opened={};self.draws=[];self.colors=[];self.hidden=[];self.bg=[];self.windows=[];self.keys=0;self.species=151;self.form=0;self.fail_alloc=False;self.iconlookups=[]
        self.reads={};self.read_bytes=0;self.message_opens=0
        self.fail_alloc_sizes=set()
        self.c.mem_write(WORK,bytes(0x300));self.w32(WORK+0x38,0x2300300);self.w32(WORK+0x4c,BUFFER)
        for i in range(5):self.w32(WORK+0x124+4*i,0x2300400+4*i)
        self.w32(REQUEST,0x2300500)
        self.c.mem_write(0x2300500,bytes([0xa5])*220)
    def r(self,n):return self.c.reg_read(REGS[n])
    def w32(self,p,n):self.c.mem_write(p,struct.pack('<I',n))
    def u16(self,p):return struct.unpack('<H',self.c.mem_read(p,2))[0]
    def text(self,p):
        out=[]
        while self.u16(p)!=65535:
            out.append(chr(self.u16(p)));p+=2;assert len(out)<1024
        return ''.join(out)
    def cstring(self,p):
        out=bytearray()
        while self.c.mem_read(p,1)!=b'\0':out+=self.c.mem_read(p,1);p+=1
        return out.decode()
    def stub(self,address,function):self.stubs[address-self.delta]=function
    def intercept(self,c,pc,size,_):
        if pc==0x2020fc0-self.delta:self.iconlookups.append((self.r(0),self.r(1)))
        if pc==STOP:c.emu_stop()
        elif pc in self.stubs:
            assert c.reg_read(UC_ARM_REG_SP)%8==0,hex(pc)
            self.stubs[pc]()
    def ret(self,value=0):self.c.reg_write(REGS[0],value);self.c.reg_write(UC_ARM_REG_PC,self.c.reg_read(UC_ARM_REG_LR))
    def call(self,name,*args):
        address=self.symbols.get(name,name)
        for i in range(4):self.c.reg_write(REGS[i],args[i] if i<len(args) else 0)
        for i in range(4,8):self.c.reg_write(REGS[i],0x11110000+i)
        for i,n in enumerate(args[4:]):self.w32(STACK+4*i,n)
        self.c.reg_write(UC_ARM_REG_SP,STACK);self.c.reg_write(UC_ARM_REG_LR,STOP|1)
        self.c.emu_start(address|1,STOP,count=12000000)
        assert self.c.reg_read(UC_ARM_REG_PC)==STOP,(name,hex(self.c.reg_read(UC_ARM_REG_PC)))
        assert self.c.reg_read(UC_ARM_REG_SP)==STACK
        assert [self.r(i) for i in range(4,8)]==[0x11110000+i for i in range(4,8)]
        return self.r(0)
    def alloc(self,size):
        if self.fail_alloc or size in self.fail_alloc_sizes:return 0
        p=self.arena;self.arena=(p+size+7)&~7;assert self.arena<0x02d00000
        self.allocations[p]=size;self.peak=max(self.peak,sum(self.allocations.values()));return p
    def free(self,p):
        assert p in self.allocations,('invalid/double free',hex(p))
        del self.allocations[p]
    def open_message(self,bank):
        self.message_opens+=1
        p=self.alloc(16);self.handles[p]=bank;return p
    def message(self,handle,id):
        text=self.messages[self.handles[handle]][id];data=text.encode('utf-16le')+b'\xff\xff'
        p=self.alloc(len(data));self.c.mem_write(p,data);return p
    def open_file(self):
        path=self.cstring(self.r(1))
        if path not in self.files:self.ret(0);return
        self.opened[self.r(0)]=[path,0];self.ret(1)
    def read_file(self):
        path,offset=self.opened[self.r(0)];data=self.files[path][offset:offset+self.r(2)]
        self.reads[path]=self.reads.get(path,0)+1;self.read_bytes+=len(data)
        if data:self.c.mem_write(self.r(1),data)
        self.opened[self.r(0)][1]+=len(data);self.ret(len(data))
    def personal_id(self,species,form):
        records=ndspy.narc.NARC(self.files['a/0/1/6']).files
        record=records[species];base=struct.unpack_from('<H',record,28)[0]
        return base+form-1 if base and 0<form<record[32] else species
    def personal_param(self):
        records=ndspy.narc.NARC(self.files['a/0/1/6']).files
        d=records[self.personal_id(self.r(0),self.r(1))]
        self.ret({31:struct.unpack_from('<H',d,30)[0],32:d[32],35:0}.get(self.r(2),0))
    def draw(self):
        text=self.strings[self.r(3)];x=self.r(1);y=self.r(2)
        width,glyph=self.font.text(text)
        assert x<256 and x+width<=256 and y+15<=192,(x,y,text,width)
        self.draws.append((x,y,text))
        color=struct.unpack('<I',self.c.mem_read(self.c.reg_read(UC_ARM_REG_SP)+4,4))[0]
        self.colors.append((x,y,text,color))
        data=bytearray(self.c.mem_read(PIXELS,24576))
        for (gx,gy),v in glyph.items():
            px=x+gx;py=y+gy
            if px>=256 or py>=192:continue
            at=((py//8)*32+px//8)*32+(py%8)*4+(px%8)//2;shift=(px&1)*4
            value=((color>>10)&31) if v==1 else ((color>>5)&31)
            data[at]=(data[at]&~(15<<shift))|((value&15)<<shift)
        self.c.mem_write(PIXELS,bytes(data));self.ret()
    def create_window(self):
        args=[self.r(i) for i in range(4)]+list(struct.unpack('<3I',self.c.mem_read(self.c.reg_read(UC_ARM_REG_SP),12)))
        self.windows.append(args);self.ret(0x2300300)
    def preview(self,name):
        data=bytes(self.c.mem_read(PIXELS,24576));screen=struct.unpack('<1024H',self.c.mem_read(MAP,2048));palette=struct.unpack('<256H',self.c.mem_read(0x5000000,512));out=[]
        for y in range(192):
            for x in range(256):
                at=((y//8)*32+x//8)*32+(y%8)*4+(x%8)//2;v=(data[at]>>((x&1)*4))&15
                color=palette[((screen[(y//8)*32+x//8]>>12)*16+v) if v else 0]
                out.extend([((color>>shift)&31)*255//31 for shift in (0,5,10)])
        png(HERE/f'build/info-{self.game}-{name}.png',256,192,out)
    def start(self):
        self.call('_Z8infoInitPvP7Request',WORK,REQUEST)
        assert not self.opened and len(self.hidden)==5 and all(flag==0 for _,flag in self.hidden)
        assert bytes(self.c.mem_read(0x2300500,220))==bytes([0xa5])*220
    def pixel(self,x,y):
        at=((y//8)*32+x//8)*32+(y%8)*4+(x%8)//2
        return (self.c.mem_read(PIXELS+at,1)[0]>>((x&1)*4))&15
    def check_abilities(self):
        record=ndspy.narc.NARC(self.files['a/0/1/6']).files[self.personal_id(self.species,self.form)]
        ids=list(dict.fromkeys(i for i in record[24:27] if i))
        draws=[(x,y,t,c) for x,y,t,c in self.colors if x>108 and y in [76,92,108]]
        assert len(draws)==max(1,len(ids)),draws
        for i,id in enumerate(ids):
            name=next((self.messages[b][id] for b in [487,374] if id<len(self.messages[b]) and self.messages[b][id]),'#'+str(id))
            x,y,text,color=draws[i]
            assert text==name.title() and x==120 and x+self.font.text(text)[0]<=252,(draws,ids)
            assert color==(0x3040 if id==record[26] else 0x3c40)
    def check_chain(self,identities):
        assert 0<len(identities)<=3 and len(set(identities))==len(identities)
        assert (self.species,self.form) in identities
        archive=ndspy.narc.NARC(self.files['a/0/0/7']);lookups=len(self.iconlookups)
        x0={1:168,2:144,3:120}[len(identities)]
        for i,(species,form) in enumerate(identities):
            member=self.call(0x2020fc1-self.delta,species,form,0,0)
            x=x0+i*48
            actual=b''.join(bytes(self.c.mem_read(PIXELS+((4+t//4)*32+x//8+t%4)*32,32)) for t in range(16))
            assert actual==archive.files[member][48:560],('wrong displayed icon',species,form)
            assert self.pixel(x-2,30)==(7 if (species,form)==(self.species,self.form) else 4)
        del self.iconlookups[lookups:]
    def end(self):
        self.call('_Z7infoEndv');self.call('_Z7infoEndv');assert not self.allocations

reports={}
for game in ['W2','B2']:
    h=Harness(game)
    if '--io-only' in sys.argv:
        reports[game]={}
        for species in [151,133]:
            h.reset();h.species=species;h.start()
            reports[game][species]={'reads':h.reads.copy(),'readBytes':h.read_bytes,'messageOpens':h.message_opens,'peakInfoBytes':h.peak,'retainedInfoBytes':sum(h.allocations.values())}
            h.end()
        print(game,reports[game],flush=True)
        continue
    # The seven-argument veneer must retain stack arguments; ordinary tutors
    # retain all original dimensions, palette and allocation direction.
    h.call('LearnsetWindow',2,1,0,20,3,15,1);assert h.windows[-1]==[2,1,0,20,3,15,1]
    h.w32(h.symbols['_ZN12_GLOBAL__N_16activeE'],REQUEST)
    h.call('LearnsetWindow',2,1,0,20,3,15,1);assert h.windows[-1]==[2,0,0,32,24,14,1]
    h.call('LearnsetWindow',2,7,5,11,16,15,1);assert h.windows[-1]==[2,0,24,1,1,15,1]
    h.call('LearnsetWindow',6,8,9,21,11,15,1);assert h.windows[-1]==[6,8,9,21,11,15,1]
    h.w32(h.symbols['_ZN12_GLOBAL__N_16activeE'],0)
    peaks=[];opening_io={}
    for species,name in [(151,'mew'),(30,'nidorina'),(133,'eevee'),(149,'dragonite'),(479,'rotom')]:
        h.reset();h.species=species;h.form=1 if species==479 else 0;h.start();h.preview(name)
        h.check_abilities()
        opening_io[species]={'reads':h.reads.copy(),'messageOpens':h.message_opens,'readBytes':h.read_bytes}
        assert sum(h.reads.values())<100,h.reads
        for x,y,t in h.draws:
            if x<56 and y in [32,48,64,80,96,112] and t.isdigit():assert x+h.font.text(t)[0]==52
        assert h.pixel(57,36)==11 and h.pixel(57,38)==10
        if species==30:
            assert h.pixel(164,47)==8 and h.pixel(161,44)==8
            assert h.pixel(158,44)==1 and h.pixel(164,44)==1
            assert h.u16(MAP+(4*32+15)*2)>>12==10
        palette=struct.unpack('<16H',h.c.mem_read(0x5000000+14*32,32))
        r,g,b=[(palette[10]>>s)&31 for s in [0,5,10]];assert r>g>b
        r,g,b=[(palette[12]>>s)&31 for s in [0,5,10]];assert b>r>g
        assert any(y==4 and "'S INFO" in t for x,y,t in h.draws)
        assert not any(t in ['LEARNED MOVES','PP'] for x,y,t in h.draws)
        if species==151:assert any(t=='Does not evolve.' for x,y,t in h.draws)
        if species==149:assert any(t=='Does not evolve further.' for x,y,t in h.draws)
        if species==133:
            evo=ndspy.narc.NARC(h.files['a/0/1/9']).files[133]
            targets=[target for method,_,target in struct.iter_unpack('<HHH',evo) if method]
            # These retail requirements are all one page. Both directions,
            # including wrap, change the actual rendered tile data, not just text.
            base_reads={p:n for p,n in h.reads.items() if p!='a/0/0/7'}
            selected=h.draws[0];index=0
            for keys in [0x100]*len(targets)+[0x200]*len(targets):
                h.check_chain([(133,0),(targets[index],0)])
                h.draws=[];h.keys=keys;h.call('_Z9infoInputPv',WORK)
                index=(index+(1 if keys==0x100 else -1))%len(targets)
                assert {p:n for p,n in h.reads.items() if p!='a/0/0/7'}==base_reads
                assert h.draws[0]==selected
                if index==1:h.preview('eevee-branch-2')
            h.check_chain([(133,0),(targets[index],0)])
        peaks.append(h.peak);h.end()
    # Alternate-form slots, not the base species' slots; repeated ability IDs
    # collapse while retaining the hidden slot's purple designation.
    h.reset();h.species=479;h.form=1
    personal=ndspy.narc.NARC(h.files['a/0/1/6']);idx=h.personal_id(479,1)
    record=bytearray(personal.files[idx]);record[24:27]=bytes([1,2,1]);personal.files[idx]=record
    h.files['a/0/1/6']=bytes(personal.save());h.start();h.check_abilities();h.end()
    # Extended ability names can reside only in bank 374. Unnamed entries get
    # a numeric fallback, and long labels stay inside the ability column.
    h.reset();personal=ndspy.narc.NARC(h.files['a/0/1/6']);record=bytearray(personal.files[151])
    record[24:27]=bytes([1,229,250]);personal.files[151]=record;h.files['a/0/1/6']=bytes(personal.save())
    texts=ndspy.narc.NARC(h.files['a/0/0/2']);header=bytearray(texts.files[374]);struct.pack_into('<H',header,2,230);texts.files[374]=header
    h.files['a/0/0/2']=bytes(texts.save());h.messages[374]+=['']*(230-len(h.messages[374]));h.messages[374][229]='Grassy Surge'
    h.start();h.check_abilities();h.end()
    h.reset();h.messages[487][28]='An Extremely Long Custom Ability Name That Needs Truncation';h.start()
    assert any(y==76 and t.endswith('...') for x,y,t in h.draws);h.preview('long-ability');h.end()
    h.reset();personal=ndspy.narc.NARC(h.files['a/0/1/6']);record=bytearray(personal.files[151]);record[24:27]=bytes(3);personal.files[151]=record;h.files['a/0/1/6']=bytes(personal.save())
    h.start();assert any(t=='No abilities.' for x,y,t in h.draws);h.end()
    h.reset()
    evolutions=ndspy.narc.NARC(h.files['a/0/1/9'])
    # A four-node fixture containing exactly the specified cycle, without
    # retail Pansage/Panpour predecessor edges affecting first-source ordering.
    for source in [511,515]:evolutions.files[source]=bytes(48)
    for source,target in [(513,514),(514,512),(512,516),(516,514)]:
        evolutions.files[source]=struct.pack('<3H',4,30,target)+bytes(42)
    h.files['a/0/1/9']=bytes(evolutions.save())
    for species,expected in [(513,[513,514,512]),(514,[513,514,512]),(512,[514,512,516]),(516,[512,516,514])]:
        h.species=species;h.hidden=[];h.iconlookups=[];h.start()
        assert [s for s,f in h.iconlookups]==expected,(species,h.iconlookups)
        h.preview('cycle-'+str(species));h.end()
    h.reset();h.files['a/0/1/9']=b'truncated';h.start()
    assert any('Evolution info unavailable.'==t for x,y,t in h.draws);h.end()
    h.reset()
    personal=ndspy.narc.NARC(h.files['a/0/1/6']);personal.files[151]=bytes([1,255,100,100,255,1])+personal.files[151][6:];h.files['a/0/1/6']=bytes(personal.save())
    h.messages[90][151]='A Very Long Custom Pokemon Species Name That Must Not Overrun The Title'
    evolutions=ndspy.narc.NARC(h.files['a/0/1/9'])
    evolutions.files[151]=b''.join(struct.pack('<3H',method,param,6) for method,param in [(1,0),(2,0),(8,80),(21,240),(22,133),(29,10),(31,20),(999,123)])
    h.files['a/0/1/9']=bytes(evolutions.save());h.start();h.preview('long-name-8-options')
    assert any(y==4 and '...' in t and t.endswith("'S INFO") for x,y,t in h.draws)
    assert [t for x,y,t in h.draws if x<72 and y in [32,48,64,80,96,112] and t.isdigit()]==['1','255','100','255','1','100']
    seen=set()
    previous_reads=h.reads.copy()
    for i in range(50):
        seen.update(t for x,y,t in h.draws if y in [152,168]);h.keys=0x100;h.call('_Z9infoInputPv',WORK)
        assert h.reads==previous_reads # Same target/continuation pages reuse icons.
    assert any('Method 999' in t for t in seen) and any('KO count' in t for t in seen)
    h.keys=0x200;h.call('_Z9infoInputPv',WORK);h.end()
    h.reset();icons=ndspy.narc.NARC(h.files['a/0/0/7']);icons.files[8+151*2]=b'bad';h.files['a/0/0/7']=bytes(icons.save());h.start()
    assert any(t=='?' for x,y,t in h.draws);h.end()
    h.reset();h.fail_alloc=True;h.start();h.end()
    h.reset();h.fail_alloc_sizes={5136};h.start()
    assert h.reads['a/0/1/6']>2000 and any(t=='Does not evolve.' for x,y,t in h.draws)
    h.end() # Cache allocation failure safely falls back to uncached reads.
    reports[game]={'peakInstrumentedInfoHeapBytes':max(peaks),'openingIO':opening_io,'menuLifetimeUnchanged':True,'compiledInfoTests':'passed','liveGameTest':False}
    print(game,'compiled info: ROM data, fonts/icons, compact gold stats, right arrows, left-aligned Title Case abilities/hidden colors, branching/paging, cycles, failure and cleanup passed',flush=True)
report='info-io.json' if '--io-only' in sys.argv else 'info-verification.json'
(HERE/'build'/report).write_text(json.dumps(reports,indent=2)+'\n')

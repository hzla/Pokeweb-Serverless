"""Compiled W2/B2 info-panel tests and previews with the ROM's actual font/icons.

Runs Thumb code in isolation. Filesystem, allocator, and presentation boundaries
are instrumented; this is NOT a full game/emulator acceptance test.
"""
import json, struct, subprocess, sys, zlib
from pathlib import Path
import ndspy.rom, ndspy.narc, ndspy.codeCompression
from background import profile, palette_index
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'build/python'))
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_HOOK_CODE
from unicorn.arm_const import UC_CPU_ARM_946, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3, UC_ARM_REG_R4, UC_ARM_REG_R5, UC_ARM_REG_R6, UC_ARM_REG_R7, UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC
TOOLS=HERE.parents[2]/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'
REGS=[UC_ARM_REG_R0,UC_ARM_REG_R1,UC_ARM_REG_R2,UC_ARM_REG_R3,UC_ARM_REG_R4,UC_ARM_REG_R5,UC_ARM_REG_R6,UC_ARM_REG_R7]
WORK, REQUEST, BITMAP, PIXELS, MAP, BUFFER, STOP, STACK=0x02300000,0x02301000,0x02302000,0x02310000,0x02318000,0x02319000,0x02ef0000,0x02ff0000
MESSAGES=json.loads((HERE/'info_messages.json').read_text())
INFO_BYTES=10380

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
        self.font_palette=bytes(ndspy.narc.NARC(self.rom.getFileByName('a/0/2/3')).files[5][40:72])
        self.tutor_files=ndspy.narc.NARC(self.rom.getFileByName('a/1/2/5')).files
        self.type_files=ndspy.narc.NARC(self.rom.getFileByName('a/0/8/2')).files
        self.background_rows=profile(self.tutor_files)
        self.c=Uc(UC_ARCH_ARM,UC_MODE_THUMB);self.c.ctl_set_cpu_model(UC_CPU_ARM_946)
        self.c.mem_map(0x02000000,0x1000000);self.c.mem_map(0x05000000,0x1000)
        self.c.mem_write(self.rom.arm9RamAddress,bytes(ndspy.codeCompression.decompress(self.rom.arm9)))
        overlay=self.rom.loadArm9Overlays([258])[258]
        self.c.mem_write(overlay.ramAddress,bytes(overlay.data))
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
        self.stub(0x201fe24,lambda:self.ret(self.party_count))
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
        # Execute actual native actor position/palette/visibility routines.
        # Only the final graphics-transfer boundary is instrumented.
        self.stubs[0x219b0b8-(0 if game=='W2' else 0x40)]=lambda:(self.type_uploads.append((self.r(0),self.r(1),self.r(2))),self.ret())
        self.stub(0x2044cc4,lambda:(self.bg.append((self.r(0),self.r(1))),self.ret()))
        self.stub(0x2048270,lambda:(self.uploads.append(self.r(0)),self.ret()))
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
        self.uploads=[]
        self.type_uploads=[]
        self.fail_alloc_sizes=set()
        self.party_count=6
        self.c.mem_write(WORK,bytes(0x300));self.w32(WORK+0x38,0x2300300);self.w32(WORK+0x4c,BUFFER)
        for i in range(5):
            actor=0x2300a00+i*0x100
            self.w32(WORK+0x124+4*i,actor);self.c.mem_write(actor,bytes(0x100))
        for i in range(8):self.w32(WORK+0x80+4*i,0x2302000+i*0x100)
        self.w32(WORK+0x13c,0x2302900)
        self.c.mem_write(REQUEST,bytes(260));self.w32(REQUEST,0x2300500)
        self.w32(REQUEST+236,0x2300900)
        self.c.mem_write(0x2300500,bytes([0xa5])*220)
        palette_size=struct.unpack_from('<I',self.tutor_files[0],32)[0]
        assert 36<=palette_size<=512
        assert {palette_index(self.tutor_files,2,x,y) for x in (8,16,64,200) for y in (8,20,36)}=={17}
        for base in (0x5000000,0x5000400):
            self.c.mem_write(base,bytes(self.tutor_files[0][40:40+palette_size]))
        # Keep both OBJ banks deliberately different from BG. The previous
        # harness repeated the runtime's +0x200/+0x400 address mixup.
        for base in (0x5000200,0x5000600):
            self.c.mem_write(base,struct.pack('<256H',*[0x51df if i%2 else 0x7ab3 for i in range(256)]))
        # Retail WO_BgGraphicSet loads font member 5 into main/sub bank 15.
        for base in (0x5000000,0x5000400):self.c.mem_write(base+15*32,self.font_palette)
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
        if pc==0x204c150-self.delta:self.hidden.append((self.r(0),self.r(1)))
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
        if y>=136:assert y in (140,156,172),('evolution text baseline',x,y,text)
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
        # Composite the two reused main-OBJ actors from the loaded ROM's
        # type NCGR/NCLR. This preview is reconstructed, not a game capture.
        for i in range(2):
            actor=0x2300a00+i*0x100
            flags=struct.unpack('<I',self.c.mem_read(actor+0x60,4))[0]
            if not flags&(1<<26):continue
            x0,y0=struct.unpack('<hh',self.c.mem_read(actor+12,4));x0-=16;y0-=8
            type_id=struct.unpack('<I',self.c.mem_read(WORK+0x140+8*i,4))[0]
            raw=self.type_files[34+type_id][48:]
            pal=struct.unpack_from('<16H',self.type_files[33],40+32*((flags>>12)&15))
            for y in range(16):
                for x in range(32):
                    index=(raw[((y//8)*4+x//8)*32+(y%8)*4+(x%8)//2]>>((x&1)*4))&15
                    if index:
                        color=pal[index];at=((y0+y)*256+x0+x)*3
                        out[at:at+3]=[((color>>shift)&31)*255//31 for shift in (0,5,10)]
        png(HERE/f'build/info-{self.game}-{name}.png',256,192,out)
    def start(self):
        self.draws=[];self.colors=[]
        before=bytes(self.c.mem_read(REQUEST,260))
        untouched_palettes=bytes(self.c.mem_read(0x5000200,1536))
        self.call('_Z8infoInitPvP7Request',WORK,REQUEST)
        assert not self.opened and self.hidden[:5]==[(0x2300a00+i*0x100,0) for i in range(5)]
        assert bytes(self.c.mem_read(0x2300500,220))==bytes([0xa5])*220
        assert bytes(self.c.mem_read(REQUEST,260))==before
        assert bytes(self.c.mem_read(0x5000200,1536))==untouched_palettes, 'Sub BG and both OBJ palettes must remain untouched'
        self.check_background()
        if not self.fail_alloc:self.check_header()
    def pixel(self,x,y):
        at=((y//8)*32+x//8)*32+(y%8)*4+(x%8)//2
        return (self.c.mem_read(PIXELS+at,1)[0]>>((x&1)*4))&15
    def check_background(self):
        palette=struct.unpack('<16H',self.c.mem_read(0x5000000+14*32,32))
        content=struct.unpack('<16H',self.c.mem_read(0x5000000+9*32,32))
        footer=struct.unpack('<16H',self.c.mem_read(0x5000000+13*32,32))
        ability=struct.unpack('<16H',self.c.mem_read(0x5000000+8*32,32))
        font=struct.unpack('<16H',self.c.mem_read(0x5000000+15*32,32))
        assert bytes(self.c.mem_read(0x5000400+15*32,32))==struct.pack('<16H',*font), 'Native main/sub font palettes remain untouched'
        assert content[9]==footer[9]==content[13]==footer[13]==self.u16(0x5000400+17*2), 'Both upper light panels match the lower description background'
        assert content[12]==footer[12]==(15|(9<<5)|(20<<10)), 'Darker purple for hidden abilities on pale gray'
        assert content[7]==(4|(15<<5)|(15<<10)), 'Selected sprite frame uses dark teal #207878'
        assert palette[7]==footer[7]==(17|(29<<5)|(27<<10)), 'Title cue and fin retain their brighter teal'
        assert content[6]==footer[6]==font[1], 'Upper dark text matches the loaded lower-screen foreground'
        assert content[14]==footer[14]==font[2], 'Upper glyph shadows match the loaded lower-screen shadows'
        assert content[14]!=content[13], 'The pale panel must not hide the glyph shadows'
        assert all(content[i]==palette[i] for i in range(16) if i not in (2,5,6,7,9,12,13,14)), 'Keep all other bars, borders and title unchanged'
        assert footer[1]==(6|(10<<5)|(10<<10)), 'Slate-teal gutter color'
        assert footer[5]==(7|(7<<5)|(8<<10)), 'Lighter charcoal description body'
        assert all(footer[i]==palette[i] for i in range(16) if i not in (1,5,6,9,12,13,14))
        assert all((footer[5]>>shift&31)>(footer[3]>>shift&31) for shift in (0,5,10)), 'Cap must be darker than body'
        assert content[3]==palette[3] and content[4]==palette[4], 'Dark ability text/arrows retain native ink colors'
        assert ability[2]==self.u16(0x5000400+19*2), 'Ability rules match native lower description rules'
        assert ability[5]==self.u16(0x5000400+21*2), 'Ability left shade matches native lower description shade'
        assert content[2]==ability[2] and content[5]==ability[5], 'Left shade and edge continue through the icon area'
        assert ability[7]==content[7], 'Bottom of selected frame remains dark teal'
        assert all(ability[i]==footer[i] for i in range(16) if i not in (2,5,7)), 'Ability palette preserves glyphs, backgrounds and gutter'
        for y in range(24):
            # x=0 is outside all native icon rectangles. Text/bitmap tile IDs
            # must remain intact while the final eight rows change palette.
            assert self.u16(MAP+y*32*2)>>12==(13 if y>=16 else 9 if y>=5 else 14)
        for y in range(10,17):
            for x in range(14,32):assert self.u16(MAP+(y*32+x)*2)>>12==8, 'Private ability palette scope'
        for y,expected in enumerate(self.background_rows[:40]):
            for x in (0,254):
                assert palette[self.pixel(x,y)]==expected,('retail background mismatch',x,y)
        def panel(x,y):
            value=9 if y<=131 and x<(100+y-40 if y<52 else 112) else 1
            if y<=131:
                cut=44-y if y<44 else y-127 if y>127 else 0
                left,right=112+cut,255-cut
                if left<=x<=right:value=4 if y in (40,131) or x in (left,right) else 13
                if 41<=y<131:
                    if left<x<left+4:value=5
                    if x==left+4 or (y in (100,116) and left+4<=x<right):value=2
            if y>=136:
                if y>=140:value=5
                elif x==0 or y==139:value=3
            return value
        for y in range(40,192):
            for x in (0,253):assert self.pixel(x,y)==panel(x,y),('panel outline/fill',x,y)
        for y in range(40,132):
            edge=100+y-40 if y<52 else 112
            assert self.pixel(edge-1,y)==9 and self.pixel(edge,y)==panel(edge,y),('clipped edge',y)
        assert self.u16(0x5000000)==content[13], 'Transparent icons must match inset fill'
        if any(y==41 and t=='HP' for x,y,t in self.draws):
            assert all(self.pixel(56,y)==9 for y in range(40,132)), 'No stat grid/borders'
        assert all(self.pixel(x,y)==1 for y in range(132,136) for x in range(256)), 'Four clear gutter rows'
        assert all(self.pixel(x,136)==3 for x in range(25)), 'Dark raised fin'
        assert all(self.pixel(x,139)==3 for x in range(27,256)), 'Matching dark top strip'
        assert all(self.pixel(2,y)==5 for y in range(140,191)), 'Lighter body extends behind all text rows'
        assert all(self.pixel(x,y)==5 for x in (0,255) for y in range(140,192)), 'No footer side outlines'
        assert all(self.pixel(x,191)==5 for x in range(256)), 'No footer bottom outline'
        for d in range(1,4):
            assert self.pixel(24+d,136+d)==3, 'Dark diagonal fin edge'
            assert self.pixel(16+d,136+d)==self.pixel(20+d,136+d)==7, 'Teal fin accents'
        assert self.bg[-1]==(3,0), 'Old upper move bars/name plate must stay hidden'
        for y in range(41,131):
            left=112+(44-y if y<44 else y-127 if y>127 else 0)
            # A chain-continuation marker may draw over the strip at Y=63.
            assert all(self.pixel(x,y) in ((4,5) if y==63 and x in (113,115) else (5,)) for x in range(left+1,left+4)), 'Full-height three-pixel shaded left edge'
            assert self.pixel(left+4,y)==2, 'One-pixel edge rule'
        assert all(self.pixel(117,y) in ((4,13) if y==63 else (13,)) for y in range(44,84)), 'No new horizontal rules above the abilities'
        for y in (100,116):
            assert all(self.pixel(x,y)==2 for x in range(117,120)), 'Sixteen-pixel ability row rules'
        if not self.fail_alloc:self.check_text_shadows()
    def check_text_shadows(self):
        count=0
        for x,y,text,color in self.colors:
            if not 40<=y<132 or not text:continue
            assert color in (0x19c0,0x31c0), ('upper text uses native shadow',text,hex(color))
            _,glyph=self.font.text(text)
            for (gx,gy),ink in glyph.items():
                if ink!=2:continue
                assert y+gy<=131, ('glyph shadow overlaps gutter',text,y+gy)
                assert self.pixel(x+gx,y+gy)==14, ('native glyph shadow missing',text,x+gx,y+gy)
                count+=1
        assert count>0, 'Expected visible native font shadows in upper text'
    def check_header(self):
        slot=self.c.mem_read(REQUEST+240,1)[0]
        valid=0<self.party_count<=6 and slot<self.party_count and any(self.c.mem_read(REQUEST+236,4))
        header=[(x,t) for x,y,t in self.draws if y==4]
        if valid:
            cue=f'< {slot+1}/{self.party_count} >' if self.party_count>1 else '1/1'
            assert len(header)==2 and header[1][1]==cue,header
            assert header[1][0]+self.font.text(cue)[0]==248
            assert header[0][0]+self.font.text(header[0][1])[0]+8<=header[1][0]
        else:assert len(header)==1,header
        assert "'S INFO" not in header[0][1]
        right=header[1][0]-8 if valid else 248
        expected=[]
        if any(y==41 and t=='HP' for x,y,t in self.draws):
            record=ndspy.narc.NARC(self.files['a/0/1/6']).files[self.personal_id(*self.identity())]
            if all(t<18 for t in record[6:8]):expected=list(dict.fromkeys(record[6:8]))
        left=header[0][0]+self.font.text(header[0][1])[0]+4
        for i in range(5):
            actor=0x2300a00+i*0x100
            flags=struct.unpack('<I',self.c.mem_read(actor+0x60,4))[0]
            assert bool(flags&(1<<26))==(i<len(expected)), ('wrong native actor visibility',i,expected)
            if i>=len(expected):continue
            assert struct.unpack('<hh',self.c.mem_read(actor+12,4))==(left+16+i*34,12)
            assert left+i*34+32<=right, ('badge overlaps party cue',header,expected)
            assert struct.unpack('<I',self.c.mem_read(WORK+0x140+i*8,4))[0]==expected[i]
            palette=self.call(0x202d815-self.delta,expected[i])
            assert (flags>>12)&15==palette and flags>>31==1
        assert bytes(self.c.mem_read(WORK+0x160,32))==bytes(32), 'Header does not queue lower type actors'
    def check_type_uploads(self):
        expected=[]
        for i in range(2):
            kind,pending=struct.unpack('<II',self.c.mem_read(WORK+0x140+i*8,8))
            if pending:expected.append((0x2302900,0x2302000+i*0x100,34+kind))
        self.type_uploads=[]
        self.call(0x219b121-(0 if self.game=='W2' else 0x40),WORK)
        assert self.type_uploads==expected, 'Actual native VBlank dispatch must choose each type resource'
        assert all(struct.unpack('<I',self.c.mem_read(WORK+0x144+i*8,4))[0]==0 for i in range(8))
    def check_abilities(self):
        record=ndspy.narc.NARC(self.files['a/0/1/6']).files[self.personal_id(*self.identity())]
        ids=list(dict.fromkeys(i for i in record[24:27] if i))
        draws=[(x,y,t,c) for x,y,t,c in self.colors if x>108 and y in [84,100,116]]
        assert len(draws)==max(1,len(ids)),draws
        for i,id in enumerate(ids):
            name=next((self.messages[b][id] for b in [487,374] if id<len(self.messages[b]) and self.messages[b][id]),'#'+str(id))
            x,y,text,color=draws[i]
            assert text==name.title() and x==120 and x+self.font.text(text)[0]<=252,(draws,ids)
            assert color==(0x31c0 if id==record[26] else 0x19c0), 'Dark/purple glyphs with visible native shadows'
    def check_chain(self,identities,frame=0):
        assert 0<len(identities)<=3 and len(set(identities))==len(identities)
        assert self.identity() in identities
        archive=ndspy.narc.NARC(self.files['a/0/0/7']);lookups=len(self.iconlookups)
        x0={1:168,2:144,3:120}[len(identities)]
        for i,(species,form) in enumerate(identities):
            member=self.call(0x2020fc1-self.delta,species,form,0,0)
            x=x0+i*48
            actual=b''.join(bytes(self.c.mem_read(PIXELS+((6+t//4)*32+x//8+t%4)*32,32)) for t in range(16))
            pose=frame if (species,form)==self.identity() else 0
            assert actual==archive.files[member][48+pose*512:560+pose*512],('wrong displayed icon',species,form,pose)
            border=7 if (species,form)==self.identity() else 13
            for y in (46,81):
                for px in range(x-2,x+34):
                    assert self.pixel(px,y)==border,('only selected icon should be framed',px,y)
            if (species,form)==self.identity():
                assert all(self.pixel(px,47)==13 for px in range(x-1,x+33)), 'Selected card interior matches inset'
            if i+1<len(identities):
                assert self.pixel(x+44,63)==4 and self.pixel(x+41,60)==4, 'Dark right-pointing arrow'
                assert self.pixel(x+38,60)==13 and self.pixel(x+44,60)==13, 'Arrow does not point left'
            for row in range(6,10):
                for col in range(x//8,x//8+4):
                    assert self.u16(MAP+(row*32+col)*2)>>12==10+i, 'Preserve native icon palette'
        del self.iconlookups[lookups:]
    def check_animation(self,identities,name):
        before=bytes(self.c.mem_read(PIXELS,24576))
        mapping=bytes(self.c.mem_read(MAP,2048));palettes=bytes(self.c.mem_read(0x5000000,2048))
        allocations=dict(self.allocations);reads=dict(self.reads);read_bytes=self.read_bytes
        draws=len(self.draws);uploads=len(self.uploads)
        x0={1:168,2:144,3:120}[len(identities)]
        selected=identities.index(self.identity())
        icon_bytes={((6+ty)*32+x0//8+selected*6+tx)*32+b for ty in range(4) for tx in range(4) for b in range(32)}
        self.call('_Z9infoInputPv',WORK+4)
        assert len(self.uploads)==uploads, 'Wrong viewer context does not animate'
        for tick in range(1,25):
            self.call('_Z9infoInputPv',WORK)
            assert len(self.uploads)==uploads+tick//8, 'One upload per eight idle ticks'
            assert bytes(self.c.mem_read(MAP,2048))==mapping, 'Animation must not rebuild the icon palette map'
            assert bytes(self.c.mem_read(0x5000000,2048))==palettes, 'Animation leaves every palette intact'
            assert self.allocations==allocations and self.reads==reads and self.read_bytes==read_bytes and not self.opened, 'No animation allocation or ROM reads'
            assert len(self.draws)==draws, 'No text or stats redraw during animation'
            actual=bytes(self.c.mem_read(PIXELS,24576))
            assert all(a==b for i,(a,b) in enumerate(zip(before,actual)) if i not in icon_bytes), 'Only the highlighted native 32x32 icon may animate'
            if tick<8 or 16<=tick<24:assert actual==before, 'Frame zero is restored exactly'
            if tick in (8,16,24):self.check_chain(identities,(tick//8)&1)
            if tick==8:self.preview(name+'-pose-1')
        self.check_background()
    def identity(self):
        identity=struct.unpack('<2H',self.c.mem_read(REQUEST+244,4))
        return identity if identity[0] else (self.species,self.form)
    def navigate(self,right,expected):
        party=bytes(self.c.mem_read(0x2300500,220));prefix=bytes(self.c.mem_read(REQUEST,28))
        result=self.call('_Z12infoNavigatePvP7Requestb',WORK,REQUEST,int(right))
        assert bool(result)==bool(expected)
        if not expected:return
        assert self.c.mem_read(REQUEST+241,1)==b'\xfe'
        view=bytes(self.c.mem_read(REQUEST+252,8))
        assert struct.unpack('<2H',view[:4])==expected
        retained=sum(self.allocations.values())
        self.c.mem_write(REQUEST+244,view);self.c.mem_write(REQUEST+252,bytes(8));self.c.mem_write(REQUEST+241,b'\xff')
        self.keys=0;self.draws=[];self.colors=[]
        self.call('_Z10infoReloadPvP7Request',WORK,REQUEST)
        assert sum(self.allocations.values())==retained, 'Reuse the info allocation and existing sprite/window resources'
        self.check_background();self.check_abilities();self.check_header();self.check_type_uploads()
        assert bytes(self.c.mem_read(0x2300500,220))==party and bytes(self.c.mem_read(REQUEST,28))==prefix
        name=self.messages[90][expected[0]].upper()
        assert any(y==4 and text==name for x,y,text in self.draws)
    def end(self):
        self.call('_Z7infoEndv');self.call('_Z7infoEndv');assert not self.allocations

reports={}
for game in ['W2','B2']:
    h=Harness(game)
    if '--header-only' in sys.argv:
        for species,form,name in [(151,0,'header-mew'),(6,0,'header-charizard'),
                                  (530,0,'header-excadrill'),(479,1,'header-rotom-heat'),
                                  (479,2,'header-rotom-wash')]:
            h.reset();h.species=species;h.form=form;h.start();h.check_type_uploads();h.preview(name)
            assert sum(h.allocations.values())==INFO_BYTES
            h.end()
        # Long ROM names retain all badges and the party cue. Type data may
        # be edited independently of the base species, including Fairy (17).
        h.reset();h.species=479;h.form=1;h.messages[90][479]='Extraordinarily Long Pokemon Species'
        personal=ndspy.narc.NARC(h.files['a/0/1/6']);idx=h.personal_id(479,1)
        record=bytearray(personal.files[idx]);record[6:8]=bytes([11,8]);personal.files[idx]=record
        h.files['a/0/1/6']=bytes(personal.save());h.start();h.check_type_uploads();h.preview('header-long-edited-form')
        assert any(y==4 and t.endswith('...') for x,y,t in h.draws);h.end()
        # Boundary IDs through the complete load/VBlank path. Duplicate types
        # use one badge; invalid IDs use none. Check every native mapping too.
        for kind in range(18):
            assert h.call(0x202d815-h.delta,kind)<3
            assert h.call(0x202d821-h.delta,kind)==34+kind
        for kind in [0,17,18,255]:
            h.reset();personal=ndspy.narc.NARC(h.files['a/0/1/6'])
            record=bytearray(personal.files[151]);record[6:8]=bytes([kind,kind]);personal.files[151]=record
            h.files['a/0/1/6']=bytes(personal.save());h.start();h.check_type_uploads();h.end()
        # Repeated in-place mono/dual swaps leave no stale second badge,
        # and requirement paging/idle ticks do not queue graphics again.
        h.reset();h.species=95;h.start();h.navigate(True,(208,0));h.navigate(False,(95,0));h.end()
        h.reset();h.species=133;h.start()
        targets=[target for method,_,target in struct.iter_unpack('<HHH',ndspy.narc.NARC(h.files['a/0/1/9']).files[133]) if method]
        h.navigate(True,(targets[0],0));h.navigate(True,(targets[1],0));h.navigate(False,(targets[0],0));h.navigate(False,(133,0))
        h.check_type_uploads();reads=dict(h.reads);h.keys=1
        for _ in range(8):h.call('_Z9infoInputPv',WORK)
        h.check_type_uploads();assert not h.type_uploads and h.reads==reads;h.end()
        h.reset();h.files['a/0/1/6']=b'bad';h.start();h.check_type_uploads();assert not h.type_uploads;h.end()
        h.reset();h.fail_alloc=True;h.start();h.check_type_uploads();assert not h.type_uploads;h.end()
        reports[game]={'header':'passed','retainedInfoBytes':INFO_BYTES,'liveGameTest':False}
        print(game,'species-only header, native centered mono/dual type badges, edited/form/Fairy types, long names, native actor setters/VBlank dispatch, navigation, failure and cleanup passed',flush=True)
        continue
    if '--terminal-only' in sys.argv:
        def footer():return [t for x,y,t in h.draws if y in (156,172) and t]
        def terminal(source,detail):
            assert any(y==140 and t=='Does not evolve further.' for x,y,t in h.draws),h.draws
            assert ' '.join(footer())==f'From {source}: {detail}',footer()
        for species,source,detail,name in [(136,'Eevee','Use Fire Stone.','flareon-incoming'),
                                           (149,'Dragonair','Level up to Lv. 55.','dragonite-incoming')]:
            h.reset();h.species=species;h.start();terminal(source,detail);h.preview(name)
            assert sum(h.reads.values())<100,h.reads
            assert sum(h.allocations.values())==INFO_BYTES
            h.end()
        print(game,'retail terminal-stage text, previews and unchanged retained memory passed',flush=True)
        # Not a fabricated historical record: use edited ROM requirements and
        # retain only the last matching slot, never a later sibling's method.
        h.reset();h.species=136;evo=ndspy.narc.NARC(h.files['a/0/1/9'])
        entries=[(8,84,134),(29,12,136),(30,7,134),(31,5,136),(999,123,136),(8,80,135)]
        evo.files[133]=b''.join(struct.pack('<3H',*e) for e in entries)+bytes(48-6*len(entries))
        h.files['a/0/1/9']=bytes(evo.save());h.start()
        terminal('Eevee','Method 999, parameter 123.')
        assert not any(y==140 and t.startswith('A ') for x,y,t in h.draws)
        h.preview('incoming-custom-methods')
        reads=h.reads.copy();retained=dict(h.allocations)
        for _ in range(6):
            h.draws=[];h.keys=1;h.call('_Z9infoInputPv',WORK)
            assert not h.draws,h.draws
            assert h.reads==reads and h.allocations==retained
        h.end()
        # Keep the status heading and wrap both available body lines. A shows
        # continuation pages without changing the chain, selection, or ROM I/O.
        h.reset();h.species=136
        index=next(i for i,(key,_) in enumerate(MESSAGES) if key=='Method8')
        detail='Use the named item while this Pokemon is in your party and follow the special evolution requirements described by the current ROM. Read the rest on continuation pages.'
        assert len(detail)<192 and len('From Eevee: '+detail)<256 # Existing bounded template/text capacities.
        h.messages[401][len(h.messages[401])-len(MESSAGES)+index]=detail
        h.start();reads=h.reads.copy();parts=[];initial=footer()
        for page in range(16):
            if page and footer()==initial:break
            assert any(y==140 and t=='Does not evolve further.' for x,y,t in h.draws)
            assert any(y==140 and t.startswith('A ') for x,y,t in h.draws)
            parts.extend(footer());h.check_chain([(133,0),(136,0)])
            if page==0:h.preview('incoming-long-requirement')
            h.draws=[];h.keys=1;h.call('_Z9infoInputPv',WORK);assert h.reads==reads
        else:raise AssertionError('Incoming continuation pages failed to wrap')
        assert ' '.join(parts)=='From Eevee: '+detail,parts
        h.end()
        print(game,'last matching incoming method and lossless continuation paging passed',flush=True)
        # Deterministic direct-opening parent, overridden only by a verified
        # actual navigation edge when hacked species have multiple parents.
        for hint,source,detail in [(0,'Ditto','Level up to Lv. 44.'),(133,'Eevee','Use Fire Stone.')]:
            h.reset();h.species=136;evo=ndspy.narc.NARC(h.files['a/0/1/9'])
            evo.files[132]=struct.pack('<3H',4,44,136)+bytes(36)
            h.files['a/0/1/9']=bytes(evo.save());h.c.mem_write(REQUEST+248,struct.pack('<HH',hint,0))
            h.start();terminal(source,detail);h.end()
        # Base and alternate-form targets must not be conflated. Ignore a
        # parent hint that does not actually evolve into the selected form.
        h.reset();h.species=479;h.form=1;evo=ndspy.narc.NARC(h.files['a/0/1/9'])
        evo.files[151]=struct.pack('<6H',4,9,479,29,8,h.personal_id(479,1))+bytes(36)
        h.files['a/0/1/9']=bytes(evo.save());h.c.mem_write(REQUEST+248,struct.pack('<HH',1,0))
        h.start();terminal('Mew','Defeat at least 8 Pokemon (KO count).');h.end()
        for species in (151,30):
            h.reset();h.species=species;h.start();assert not any(t.startswith('From ') for t in footer())
            if species==151:assert any(t=='Does not evolve.' for x,y,t in h.draws)
            else:assert any(y==140 and '\u2192' in t for x,y,t in h.draws)
            h.end()
        h.reset();h.species=136;evo=ndspy.narc.NARC(h.files['a/0/1/9']);evo.files[136]=bytes(43)
        h.files['a/0/1/9']=bytes(evo.save());h.start()
        assert any(t=='Evolution info unavailable.' for x,y,t in h.draws) and not footer();h.end()
        # In-place family refresh must swap/clear incoming text with the focus.
        h.reset();h.species=30;h.start();h.navigate(True,(31,0))
        terminal('Nidorina','Use Moon Stone.');h.navigate(False,(30,0))
        assert not any(t.startswith('From ') for t in footer());h.end()
        h.reset();h.fail_alloc=True;h.start();h.end()
        reports[game]={'terminalRequirements':'passed','retainedInfoBytes':INFO_BYTES,'liveGameTest':False}
        print(game,'terminal predecessor requirements: correct retail/edited/form edge, seven/eight-slot records, last matching method only, wrapping/A continuations, parent hints, no added retained memory, no paging I/O, read-only refresh and cleanup passed',flush=True)
        continue
    if '--navigation-only' in sys.argv:
        h.reset();h.species=30;h.start()
        h.check_chain([(29,0),(30,0),(31,0)])
        for right,target in [(False,29),(True,30),(True,31),(False,30)]:
            h.navigate(right,(target,0));h.check_chain([(29,0),(30,0),(31,0)])
            h.check_animation([(29,0),(30,0),(31,0)],'focus-'+str(target))
        h.end()
        h.reset();h.species=133;h.start()
        targets=list(dict.fromkeys(target for method,_,target in struct.iter_unpack('<HHH',ndspy.narc.NARC(h.files['a/0/1/9']).files[133]) if method))
        for target in targets:
            h.navigate(True,(target,0));h.check_chain([(133,0),(target,0)])
        h.navigate(True,None)
        for target in reversed(targets[:-1]):
            h.navigate(False,(target,0));h.check_chain([(133,0),(target,0)])
        h.navigate(False,(133,0));h.check_chain([(133,0),(targets[0],0)]);h.navigate(False,None);h.end()
        # Branches with descendants: follow Silcoon -> Beautifly before
        # advancing to Cascoon, whose L target is the previous sibling Silcoon.
        h.reset();h.species=265;h.start()
        for right,target in [(True,266),(True,267),(True,268),(False,266)]:h.navigate(right,(target,0))
        h.end()
        h.reset();h.species=151;h.start();h.navigate(True,None);h.navigate(False,None);h.end()
        print(game,'family navigation: virtual species/stats/abilities, selected-only animation, Nidoran family, Eevee sibling cursor behavior, descendant-first branches, endpoints, read-only party and cleanup passed',flush=True)
        reports[game]={'familyNavigation':'passed','requestBytes':260,'liveGameTest':False}
        continue
    if '--layout-only' in sys.argv:
        # Focused visual regression for small positioning changes; the full
        # data/branch/failure suite remains the default invocation.
        for species,name in [(151,'mew'),(30,'nidorina'),(133,'eevee'),(479,'rotom')]:
            h.reset();h.species=species;h.form=1 if species==479 else 0;h.start();h.preview(name);h.check_abilities()
            chains={151:[(151,0)],30:[(29,0),(30,0),(31,0)],479:[(479,1)]}
            if species==133:
                targets=[target for method,_,target in struct.iter_unpack('<HHH',ndspy.narc.NARC(h.files['a/0/1/9']).files[133]) if method]
                chains[133]=[(133,0),(targets[0],0)]
            if species in chains:h.check_animation(chains[species],name)
            bottom=[(x,y,t) for x,y,t in h.draws if y>=136]
            assert bottom and any(y==140 for x,y,t in bottom)
            if species==133:
                assert any(y==140 and t.startswith('A ') for x,y,t in bottom)
                h.draws=[];h.keys=1;h.call('_Z9infoInputPv',WORK);h.check_background()
                h.check_chain([(133,0),(targets[0],0)],1)
                h.keys=0
                for _ in range(7):h.call('_Z9infoInputPv',WORK)
                h.check_chain([(133,0),(targets[0],0)],0)
            h.end()
        h.reset();h.species=133
        private_start=len(h.messages[401])-len(MESSAGES)
        for i,(key,_) in enumerate(MESSAGES):
            if key.startswith('Method'):
                h.messages[401][private_start+i]='A lengthy evolution requirement with enough words to fill both lines and continue on another page without clipping the bottom edge of the screen.'
        h.start();h.preview('long-requirement')
        assert {y for x,y,t in h.draws if y>=136 and t}=={140,156,172}
        h.draws=[];h.keys=1;h.call('_Z9infoInputPv',WORK)
        assert any(y==140 and t.startswith('A 2/') for x,y,t in h.draws)
        h.check_background();h.end()
        h.reset();h.fail_alloc=True;h.start();h.end()
        h.reset();personal=ndspy.narc.NARC(h.files['a/0/1/6']);record=bytearray(personal.files[151])
        record[:6]=bytes([255]*6);record[24:27]=bytes([1,2,3]);personal.files[151]=record
        h.files['a/0/1/6']=bytes(personal.save());h.start();h.check_abilities();h.preview('max-stats');h.end()
        # Read the ROM-loaded palette, rather than baking retail colors into the DLL.
        h.reset()
        for base in (0x5000000,0x5000400):
            h.c.mem_write(base+15*32+2,struct.pack('<HH',0x2529,0x5294))
        h.c.mem_write(0x5000400+17*2,struct.pack('<H',0x739c))
        h.start();h.check_abilities();h.end()
        # Sprite palette changes cannot recolor either upper panel.
        h.reset();h.start();initial=bytes(h.c.mem_read(0x5000000,512))
        h.c.mem_write(0x5000200,struct.pack('<256H',*range(256)))
        h.draws=[];h.call('_Z10infoReloadPvP7Request',WORK,REQUEST)
        h.check_background()
        assert bytes(h.c.mem_read(0x5000000,512))==initial
        h.end()
        # An unreadable/tampered icon stays a static placeholder, never a
        # partially initialized second frame or a pointless bitmap upload.
        h.reset();h.files['a/0/0/7']=b'bad icon archive';h.start()
        initial=bytes(h.c.mem_read(PIXELS,24576));uploads=len(h.uploads)
        for _ in range(24):h.call('_Z9infoInputPv',WORK)
        assert bytes(h.c.mem_read(PIXELS,24576))==initial and len(h.uploads)==uploads
        h.end();h.call('_Z9infoInputPv',WORK);assert not h.allocations
        reports[game]={'compiledLayoutTests':'passed','evolutionTextY':[140,156,172],'gutterRows':[132,133,134,135],'liveGameTest':False}
        print(game,'compiled layout: native ROM foreground/shadows/light fill, ruled abilities with left shading, custom palettes, purple hidden abilities, unchanged frame/title/footer/geometry, wrapping, allocation failure and cleanup passed',flush=True)
        continue
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
    # Same field-owned request layout as party navigation. Position updates,
    # lone party members and invalid contexts must not collide with the title.
    for count,slot in [(6,1),(6,5),(1,0),(0,0),(7,0),(6,6)]:
        h.reset();h.party_count=count;h.c.mem_write(REQUEST+240,bytes([slot]))
        h.start();h.end()
    for species,name in [(151,'mew'),(30,'nidorina'),(133,'eevee'),(149,'dragonite'),(479,'rotom')]:
        h.reset();h.species=species;h.form=1 if species==479 else 0;h.start();h.preview(name)
        h.check_abilities()
        chains={151:[(151,0)],30:[(29,0),(30,0),(31,0)],
                149:[(147,0),(148,0),(149,0)],479:[(479,1)]}
        if species==133:
            evo=ndspy.narc.NARC(h.files['a/0/1/9']).files[133]
            first=next(target for method,_,target in struct.iter_unpack('<HHH',evo) if method)
            chains[133]=[(133,0),(first,0)]
        h.check_chain(chains[species])
        opening_io[species]={'reads':h.reads.copy(),'messageOpens':h.message_opens,'readBytes':h.read_bytes}
        assert sum(h.reads.values())<100,h.reads
        for x,y,t in h.draws:
            if x<56 and y in [41,56,71,86,101,116] and t.isdigit():assert x+h.font.text(t)[0]==52
        assert h.pixel(57,46)==11 and h.pixel(57,48)==10
        if species==30:
            assert h.pixel(164,63)==4 and h.pixel(161,60)==4
            assert h.pixel(158,60)==13 and h.pixel(164,60)==13
            assert h.u16(MAP+(6*32+15)*2)>>12==10
        palette=struct.unpack('<16H',h.c.mem_read(0x5000000+14*32,32))
        r,g,b=[(palette[10]>>s)&31 for s in [0,5,10]];assert r>g>b
        r,g,b=[(palette[12]>>s)&31 for s in [0,5,10]];assert b>r>g
        assert any(y==4 and t==h.messages[90][species].upper() for x,y,t in h.draws)
        assert not any(t in ['LEARNED MOVES','PP'] for x,y,t in h.draws)
        if species==151:assert any(t=='Does not evolve.' for x,y,t in h.draws)
        if species==149:assert any(t=='Does not evolve further.' for x,y,t in h.draws)
        if species==133:
            evo=ndspy.narc.NARC(h.files['a/0/1/9']).files[133]
            targets=[target for method,_,target in struct.iter_unpack('<HHH',evo) if method]
            # A cycles requirements without changing the focused species,
            # first outgoing icon or cached family navigation.
            base_reads={p:n for p,n in h.reads.items() if p!='a/0/0/7'}
            selected=h.draws[0];index=0
            for tick,keys in enumerate([1]*len(targets)*2):
                h.check_chain([(133,0),(targets[0],0)],(tick//8)&1)
                h.draws=[];h.keys=keys;h.call('_Z9infoInputPv',WORK)
                h.check_background()
                index=(index+1)%len(targets)
                assert {p:n for p,n in h.reads.items() if p!='a/0/0/7'}==base_reads
                assert h.draws[0]==selected
                if index==1:h.preview('eevee-branch-2')
            h.check_chain([(133,0),(targets[0],0)],((2*len(targets))//8)&1)
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
    assert any(y==84 and t.endswith('...') for x,y,t in h.draws);h.preview('long-ability');h.end()
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
    assert any(y==4 and t.endswith('...') for x,y,t in h.draws)
    assert [t for x,y,t in h.draws if x<72 and y in [41,56,71,86,101,116] and t.isdigit()]==['1','255','100','255','1','100']
    seen=set()
    previous_reads=h.reads.copy()
    for i in range(50):
        seen.update(t for x,y,t in h.draws if y in [156,172]);h.keys=1;h.call('_Z9infoInputPv',WORK)
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
    print(game,'compiled info: matching pale stats/inset, dark ability text and purple hidden abilities, selected-only frame/unclipped icons, party cue, charcoal footer/teal fin, ROM data, branching/paging, cycles, failure and cleanup passed',flush=True)
report='info-header-verification.json' if '--header-only' in sys.argv else 'info-terminal-verification.json' if '--terminal-only' in sys.argv else 'info-navigation-verification.json' if '--navigation-only' in sys.argv else 'info-io.json' if '--io-only' in sys.argv else 'info-layout-verification.json' if '--layout-only' in sys.argv else 'info-verification.json'
(HERE/'build'/report).write_text(json.dumps(reports,indent=2)+'\n')

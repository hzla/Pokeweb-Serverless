"""Compile native small-font labels and the ten native C-Gear button patterns."""
import struct
from pathlib import Path
import ndspy.narc
from PIL import Image,ImageDraw,ImageFilter
LABELS=['REPEL','PC','BIKE','MAP']
PURPLE=(192,104,240)
OUTLINES=[(24,216,120),(248,120,0),(216,48,248),PURPLE]
def nitro(magic,block,payload):
    return struct.pack('<4sHHIHH',magic,0xfeff,0x100,24+len(payload),16,1)+struct.pack('<4sI',block,8+len(payload))+payload

def glyph(b,character):
    code=ord(character);bank=struct.unpack_from('<I',b,32)[0];mapping=struct.unpack_from('<I',b,40)[0];cell=None
    while mapping:
        first,last,method=struct.unpack_from('<HHH',b,mapping)
        if first<=code<=last:
            if method==0:cell=struct.unpack_from('<H',b,mapping+12)[0]+code-first
            elif method==1:cell=struct.unpack_from('<H',b,mapping+12+2*(code-first))[0]
            elif method==2:
                count=struct.unpack_from('<H',b,mapping+12)[0]
                for i in range(count):
                    c,index=struct.unpack_from('<HH',b,mapping+14+i*4)
                    if c==code:cell=index;break
            break
        mapping=struct.unpack_from('<I',b,mapping+8)[0]
    assert cell is not None and cell!=65535
    w,h,size=struct.unpack_from('<BBH',b,bank);start=bank+8+size*cell;left,_,advance=b[start:start+3]
    mask=Image.new('L',(w+left,h))
    for y in range(h):
        for x in range(w):
            pos=y*w+x;v=b[start+3+pos//4]>>(6-(pos%4)*2)&3
            if v==1:mask.putpixel((x+left,y),255)
    return mask,advance

def caption(font,label):
    parts=[glyph(font,c) for c in label];out=Image.new('L',(sum(a for _,a in parts)+2,12));x=1
    for im,advance in parts:out.paste(im,(x,0));x+=advance
    text=out.crop(out.getbbox())
    # C-Gear's bitmap captions have five foreground rows. Keep the native
    # small-font widths/spacing, but fit those same five rows without blur.
    return text.resize((text.width,5),Image.Resampling.NEAREST)

def tiled(im):
    out=bytearray()
    for ty in range(4):
        for tx in range(4):
            for y in range(8):
                for x in range(0,8,2):out.append(im.getpixel((tx*8+x,ty*8+y))|(im.getpixel((tx*8+x+1,ty*8+y))<<4))
    return bytes(out)
def untile(b):
    im=Image.new('P',(32,32))
    for ty in range(4):
        for tx in range(4):
            for y in range(8):
                for x in range(8):im.putpixel((tx*8+x,ty*8+y),(b[(ty*4+tx)*32+y*4+x//2]>>(4*(x%2)))&15)
    return im

def create(output,preview,rom):
    native=ndspy.narc.NARC(rom.getFileByName('a/2/8/7'))
    font=ndspy.narc.NARC(rom.getFileByName('a/0/2/3')).files[1]
    # Reserve 7 for black foreground and 8 for each requested text outline.
    # Native pattern pixels use only indices 0,9,13. Ring colours 1..3 follow
    # the native selected theme at runtime. All labels use the ROM's glyphs.
    palette=list(struct.unpack_from('<16H',native.files[14],40+2*32))
    palette[7]=0
    palettes=[]
    for colour in OUTLINES:
        p=palette.copy();p[8]=(colour[0]//8)|((colour[1]//8)<<5)|((colour[2]//8)<<10)
        p[14]=(colour[0]//24)|((colour[1]//24)<<5)|((colour[2]//24)<<10);palettes.append(p)
    colours=[v for p in palettes for v in p]
    rgb=[((v&31)*8,((v>>5)&31)*8,((v>>10)&31)*8) for v in palettes[0]]
    nclr=nitro(b'RLCN',b'TTLP',struct.pack('<IIII',3,0,128,16)+struct.pack('<64H',*colours))
    cells=b''.join(struct.pack('<HHIhhhh',1,0x0808,i*8,15,15,-16,-16) for i in range(4))
    oam=b''.join(struct.pack('<HHH',240,0x8000|496,i<<12)+bytes(2) for i in range(4))
    ncer=nitro(b'RECN',b'KBEC',struct.pack('<HHIIIII',4,1,24,0,0,0,0)+cells+oam)
    seq=b''.join(struct.pack('<HHIII',1,0,0x10000,1,i*8) for i in range(4))
    frames=b''.join(struct.pack('<IHH',i*4,1,0) for i in range(4));contents=b''.join(struct.pack('<HH',i,0) for i in range(4))
    nanr=nitro(b'RNAN',b'KNBA',struct.pack('<HHIIIII',4,4,24,88,120,0,0)+seq+frames+contents)
    patterns=[]
    for sex in range(2):
        for design in range(5):
            # Cell 1's 32x32 body starts at tile 4, after its separate IR label.
            p=native.files[19+sex*5+design][48+4*32:48+20*32];assert len(p)==512
            assert set(untile(p).getdata())<={0,9,13};patterns.append(p)
    fingerprint=0x811c9dc5
    for v in b''.join(patterns):fingerprint=((fingerprint^v)*0x1000193)&0xffffffff
    header=struct.pack('<IHHII',0x41475143,4,40,1,0x41475142)+bytes([1,2,3,9]*4)+struct.pack('<IHH',fingerprint,1517,0)
    banks=[];sheet=Image.new('RGBA',(128,128))
    for i,label in enumerate(LABELS):
        rgb=[((v&31)*8,((v>>5)&31)*8,((v>>10)&31)*8) for v in palettes[i]]
        text=caption(font,label);assert text.width+4<=32 and text.height==5
        bank=bytearray()
        for pose in range(4):
            im=Image.new('P',(32,32));im.putpalette(sum((list(v) for v in rgb),[])+[0]*720);im.info['transparency']=0
            d=ImageDraw.Draw(im);d.ellipse((0,0,30,30),fill=9,outline=3,width=1)
            d.ellipse((1,1,29,29),outline=3 if pose==3 else 1 if pose==1 else 2,width=2)
            if pose==1:d.ellipse((4,4,26,26),outline=2)
            mask=Image.new('L',(32,32));mask.paste(text,((31-text.width)//2,(31-text.height)//2+(1 if pose==2 else 0)))
            outline=mask.filter(ImageFilter.MaxFilter(3));outer=mask.filter(ImageFilter.MaxFilter(5))
            im.paste(7,(0,0),outer);im.paste(14 if pose==3 else 8,(0,0),outline);im.paste(7,(0,0),mask)
            bank.extend(tiled(im))
            shown=im.copy();pattern=untile(patterns[0])
            for y in range(32):
                for x in range(32):
                    if shown.getpixel((x,y))==9 and pattern.getpixel((x,y))==13:shown.putpixel((x,y),13)
            sheet.alpha_composite(shown.convert('RGBA'),(i*32,pose*32))
        banks.append(bytes(bank))
    arc=ndspy.narc.NARC();arc.files=[header,nclr,ncer,nanr,*banks,b''.join(patterns)]
    Path(output).write_bytes(arc.save())
    layout=Image.new('RGB',(256,192),(16,16,16));d=ImageDraw.Draw(layout)
    for r in (32,48,68,90,112):d.ellipse((128-r,98-r,128+r,98+r),outline=(0,64,80),width=2)
    for i,(x,y) in enumerate([(60,116),(196,116),(88,152),(172,152)]):
        tile=sheet.crop((i*32,0,i*32+32,32));layout.paste(tile,(x-16,y-16),tile)
    layout.save(Path(output).with_name('cgearQuickActionsPreview.png'))
    sheet.resize((512,512),Image.Resampling.NEAREST).save(preview)
    designs=Image.new('RGBA',(5*32,2*32))
    for sex in range(2):
        for design in range(5):
            im=untile(patterns[sex*5+design]);im.putpalette(sum((list(v) for v in rgb),[])+[0]*720);im.info['transparency']=0
            designs.alpha_composite(im.convert('RGBA'),(design*32,sex*32))
    designs.resize((640,256),Image.Resampling.NEAREST).save(Path(preview).with_name('patterns.png'))

"""Deterministic conversion of the supplied badge artwork to DS resources."""
from collections import Counter
import colorsys
import hashlib
import json
from pathlib import Path
import struct
import numpy as np
from PIL import Image
import ndspy.narc

HERE = Path(__file__).resolve().parent
NAMES = ['NORMAL','FIGHT','FLYING','POISON','GROUND','ROCK','BUG','GHOST','STEEL',
         'FIRE','WATER','GRASS','ELECTR','PSYCHC','ICE','DRAGON','DARK']
ANCHORS = ['ADA594','A5523A','9CADF7','B55AA5','D6B55A','BDA55A','ADBD21','6363B5',
           'ADADC5','F75231','3A9CFF','7BCE52','FFC531','FF73A5','5ACEE6','7B63E6','735A4A']

def pack555(rgb):
    r,g,b = (int(round(float(v)*31/255)) for v in rgb)
    return r | (g<<5) | (b<<10)

def expand555(n):
    return tuple(round(((n>>s)&31)*255/31) for s in (0,5,10))

def nitro(stamp, block, payload):
    return struct.pack('<4sHHIHH4sI',stamp.encode(),0xfeff,0x100,24+len(payload),16,1,
                       block.encode(),8+len(payload))+payload

def recover():
    # The 1080x237 attachment is a filtered enlargement of a 236x52 grid.
    # Sample pixel interiors to avoid mixing adjacent pixels at filtered edges.
    a=np.asarray(Image.open(HERE/'assets/source.png').convert('RGBA'))
    small=np.zeros((52,236,4),dtype=np.uint8)
    for y in range(52):
        for x in range(236):
            xx=(x+.5)*a.shape[1]/236; yy=(y+.5)*a.shape[0]/52
            crop=a[max(0,int(yy)-1):min(a.shape[0],int(yy)+2),
                   max(0,int(xx)-1):min(a.shape[1],int(xx)+2)]
            small[y,x]=np.median(crop.reshape(-1,4),axis=0)
    small[:,:,3]=np.where(small[:,:,3]>=128,255,0)
    return small

def recolor(a, target):
    rgb=a[:,:,:3].copy(); opaque=a[:,:,3]!=0
    # Cluster the filtered source first. Its principal non-white fill anchors
    # the relative HSV transformation, including every colored particle.
    q=Image.fromarray(rgb).quantize(colors=15,method=Image.Quantize.MEDIANCUT,
                                   dither=Image.Dither.NONE).convert('RGB')
    q=np.asarray(q).copy()
    counts=Counter(tuple(c) for c in q[opaque & (np.indices(opaque.shape)[0]>=4)])
    choices=[(n,c) for c,n in counts.items() if max(c)-min(c)>.23*max(c) and min(c)<225]
    if not choices: choices=[(n,c) for c,n in counts.items() if 145<max(c)<240]
    anchor=max(choices)[1]
    h0,s0,v0=colorsys.rgb_to_hsv(*(n/255 for n in anchor))
    ht,st,vt=colorsys.rgb_to_hsv(*(n/255 for n in target))
    transformed=np.zeros_like(rgb)
    for y,x in zip(*np.where(opaque)):
        c=q[y,x]; h,s,v=colorsys.rgb_to_hsv(*(int(n)/255 for n in c))
        if min(c)>225: out=(255,255,255)
        elif s<.20 and max(c)<155: out=(82,82,82)
        else:
            # A common hue rotation and relative S/V ratios retain highlight,
            # particle and recessed-detail differences around the native fill.
            hh=(h+ht-h0)%1
            ss=max(0,min(1,st+(s-s0)))
            vv=max(0,min(1,vt+(v-v0)))
            out=tuple(round(n*255) for n in colorsys.hsv_to_rgb(hh,ss,vv))
        transformed[y,x]=expand555(pack555(out))
    # Reserve the exact native fill, neutral white and DS letter shadow.
    fixed=[tuple(target),(255,255,255),(82,82,82)]
    remaining=[tuple(c) for c in transformed[opaque] if tuple(c) not in fixed]
    if remaining:
        strip=Image.fromarray(np.array(remaining,dtype=np.uint8).reshape(1,-1,3))
        reduced=strip.quantize(colors=12,method=Image.Quantize.MEDIANCUT,
                              dither=Image.Dither.NONE).convert('RGB')
        fixed+=list(dict.fromkeys(expand555(pack555(c)) for c in np.asarray(reduced).reshape(-1,3)))
    palette=[(0,0,0),*list(dict.fromkeys(fixed))][:16]
    palette += [(0,0,0)]*(16-len(palette))
    p=np.array(palette[1:],dtype=np.int32)
    d=np.sum((transformed.astype(np.int32)[:,:,None,:]-p)**2,axis=3)
    index=(np.argmin(d,axis=2)+1).astype(np.uint8)
    index[~opaque]=0
    assert set(map(int,np.unique(index)))<=set(range(16))
    preview=np.array(palette,dtype=np.uint8)[index]
    preview=np.dstack([preview,a[:,:,3]])
    # 8bpp OBJ transport lets extended palettes coexist with native 4bpp OBJ.
    # Only indices 0..15 are used, so the artwork still has 15 visible colors.
    tiles=b''.join(index[ty*8:ty*8+8,tx*8:tx*8+8].tobytes() for ty in range(2) for tx in range(4))
    colors=struct.pack('<16H',*(pack555(c) for c in palette))
    return tiles,colors,Image.fromarray(preview),anchor

def build_assets():
    grid=recover(); chars=[]; colors=[]; previews=[]; records=[]
    for i,name in enumerate(NAMES):
        x,y=i%7*34,i//7*18
        a=grid[y:y+16,x:x+32]
        target=tuple(bytes.fromhex(ANCHORS[i]))
        tiles,palette,preview,anchor=recolor(a,target)
        payload=struct.pack('<HHIIIII',0xffff,0xffff,4,0x10,0,len(tiles),24)+tiles
        chars.append(nitro('RGCN','RAHC',payload));colors.append(palette);previews.append(preview)
        records.append({'type':name,'body':'#'+ANCHORS[i],'sourceAnchor':list(map(int,anchor)),
                        'visibleColors':len({v for v in preview.get_flattened_data() if v[3]}),
                        'palette555':list(struct.unpack('<16H',palette))})
    # Two extended slots belong only to the information page's new actors.
    pal=struct.pack('<IIII',4,1,2*512,16)+bytes(2*512)
    cells=bytearray(48);struct.pack_into('<HHII',cells,0,1,0,24,2)
    struct.pack_into('<HHI',cells,24,1,5,0)
    struct.pack_into('<3H',cells,32,0x60f8,0x81f0,0)
    # Cell records are 8 bytes and the OAM block starts immediately after them.
    cells=cells[:38]
    anim=bytearray(52);struct.pack_into('<HHIII',anim,0,1,1,24,40,48)
    struct.pack_into('<HHIII',anim,24,1,0,0x10000,2,0)
    struct.pack_into('<IHH',anim,40,0,4,0);struct.pack_into('<H',anim,48,0)
    narc=ndspy.narc.NARC();narc.files=[nitro('RLCN','TTLP',pal),
        nitro('RECN','KBEC',cells),nitro('RNAN','KNBA',anim),*chars]
    raw=bytes(narc.save())
    # Use the editor's minimal nameless FNT form, so export/reimport preserves
    # the archive hash as well as the resource members.
    fnt=16+struct.unpack_from('<I',raw,20)[0]
    old_size=struct.unpack_from('<I',raw,fnt+4)[0]
    archive=bytearray(raw[:fnt]+struct.pack('<4sIIHH',b'BTNF',16,4,0,1)+raw[fnt+old_size:])
    struct.pack_into('<I',archive,8,len(archive));archive=bytes(archive)
    out=HERE.parents[1]/'src/assets/codeinjection'
    (out/'summaryTypeIcons.narc').write_bytes(archive)
    sheet=Image.new('RGBA',(236,52))
    for i,p in enumerate(previews):sheet.paste(p,(i%7*34,i//7*18))
    sheet.resize((1416,312),Image.Resampling.NEAREST).save(out/'summary-type-icons-preview.png')
    (HERE/'assets/palettes.json').write_text(json.dumps({'types':records},indent=2)+'\n')
    header='#pragma once\nalignas(4) static const u16 iconColors[17][16]={\n'
    header+='\n'.join('{'+','.join(map(str,struct.unpack('<16H',p)))+'},' for p in colors)+'\n};\n'
    header+='alignas(4) static const u8 iconTiles[17][256]={\n'
    header+='\n'.join('{'+','.join(str(a|(b<<4)) for a,b in zip(c[48::2],c[49::2]))+'},' for c in chars)+'\n};\n'
    (HERE/'build/colors.generated.h').write_text(header)
    return archive,records

if __name__=='__main__':
    (HERE/'build').mkdir(exist_ok=True)
    data,records=build_assets()
    print('17 types; 32x16; <=15 visible colors; archive SHA256',hashlib.sha256(data).hexdigest())

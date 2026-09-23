"""Extract only the native White 2 art used by the save menu."""
import hashlib
import struct
from pathlib import Path

import ndspy.narc
import ndspy.rom
import ndspy.lz10
from PIL import Image

HERE=Path(__file__).resolve().parent
TARGET=HERE.parents[2].parent/'White2Upgrade-Following-0.7.16-alpha.nds'
PIN='6aab8eeff93ff966fce3c2a44162bfa10052511f3b7f69e000815852af05d1c9'

def rgb555(pal,index):
    return struct.unpack_from('<H',pal,40+index*2)[0] | 0x8000

def map_pixel(chars,screen,x,y):
    entry=struct.unpack_from('<H',screen,36+2*((y//8)*32+x//8))[0]
    tile=entry&1023
    tx=7-x%8 if entry&1024 else x%8
    ty=7-y%8 if entry&2048 else y%8
    depth=struct.unpack_from('<I',chars,28)[0]
    at=48+tile*(64 if depth==4 else 32)+ty*(8 if depth==4 else 4)+(tx if depth==4 else tx//2)
    if at>=len(chars):return 0
    return chars[at] if depth==4 else (chars[at]>>(4*(tx%2)))&15

def emit(name,values,ctype,per=16):
    return f'constexpr {ctype} {name}[{len(values)}]={{\n'+''.join('    '+','.join(str(v) for v in values[i:i+per])+',\n' for i in range(0,len(values),per))+'};\n'

def pack_map(values):
    packed=bytearray()
    i=0
    while i<len(values):
        run=1
        while run<128 and i+run<len(values) and values[i+run]==values[i]:run+=1
        if run>=3:
            packed.extend((0x80|(run-1),values[i]))
            i+=run
            continue
        start=i
        while i<len(values) and i-start<128:
            run=1
            while run<128 and i+run<len(values) and values[i+run]==values[i]:run+=1
            if run>=3:break
            i+=1
        packed.append(i-start-1)
        packed.extend(values[start:i])
    restored=bytearray()
    i=0
    while i<len(packed):
        token=packed[i];i+=1
        count=(token&127)+1
        if token&128:
            restored.extend([packed[i]]*count);i+=1
        else:
            restored.extend(packed[i:i+count]);i+=count
    assert restored==bytes(values)
    return packed

def from_capture(pixel):
    # melonDS expands each RGB555 channel as (value << 3) | (value >> 3).
    red,green,blue=pixel[:3]
    return (red//8)|((green//8)<<5)|((blue//8)<<10)|0x8000

def native_glyphs(font_file,characters):
    glyph,_,mapping=struct.unpack_from('<III',font_file,32)
    width,height,size=struct.unpack_from('<BBH',font_file,glyph)
    assert (width,height)==(12,15)
    lookup=[255]*127
    advances=[]
    rows=[]
    for index,code in enumerate(characters):
        if code<127:lookup[code]=index
        at=mapping
        while True:
            first,last,method,_,next_at=struct.unpack_from('<HHHHI',font_file,at)
            if first<=code<=last:
                if method==0:cell=code-first+struct.unpack_from('<H',font_file,at+12)[0]
                elif method==1:cell=struct.unpack_from('<H',font_file,at+12+2*(code-first))[0]
                else:raise ValueError('unsupported native font mapping')
                break
            assert next_at,code
            at=next_at
        start=glyph+8+cell*size
        left,visible,advance=font_file[start:start+3]
        raw=font_file[start+3:start+size]
        assert visible<=width and left+visible<=8
        advances.append(advance)
        for y in range(height):
            ink=shade=0
            for x in range(width):
                level=(raw[(y*width+x)//4]>>(6-2*((y*width+x)%4)))&3
                if level==1:ink|=1<<(x+left)
                elif level==2:shade|=1<<(x+left)
            rows.append(ink|(shade<<8))
    return lookup,characters.index(233),advances,rows

def main():
    assert hashlib.sha256(TARGET.read_bytes()).hexdigest()==PIN
    rom=ndspy.rom.NintendoDSRom.fromFile(TARGET)
    players=ndspy.narc.NARC(rom.getFileByName('a/0/3/0')).files
    assert len(players)==24 and all(bytes(players[i][:4])==b'RGCN' for i in (5,7))
    maparc=ndspy.narc.NARC(rom.getFileByName('a/0/8/4')).files
    assert bytes(maparc[16][:4])==b'RCSN' and bytes(maparc[17][:4])==b'RCSN'
    map_indices=[]
    # The NSCR canvas is 256x256; its complete painted map occupies rows 0..167.
    for y in range(168):
        for x in range(256):
            base=map_pixel(maparc[7],maparc[16],x,y)
            overlay=map_pixel(maparc[5],maparc[17],x,y)
            map_indices.append(overlay or base)
    lines=['#pragma once','// Extracted from the pinned White 2 ROM at build time.']
    packed_map=ndspy.lz10.compress(bytes(map_indices))
    assert ndspy.lz10.decompress(packed_map)==bytes(map_indices)
    lines.append(emit('UnovaMapLz',packed_map,'u8',32))
    lines.append(emit('UnovaPalette',[rgb555(maparc[0],i) for i in range(256)],'u16'))
    title=Image.open(HERE/'native-map-title.png').convert('RGB')
    assert title.size==(152,22)
    title_pixels=[from_capture(title.getpixel((x,y))) for y in range(22) for x in range(152)]
    title_palette=sorted(set(title_pixels))
    lines.append(emit('MapTitlePalette',title_palette,'u16'))
    lines.append(emit('MapTitleRle',pack_map([title_palette.index(p) for p in title_pixels]),'u8',32))
    start_node=Image.open(HERE/'native-map-start-node.png').convert('RGB')
    assert start_node.size==(8,8)
    lines.append(emit('MapStartNode',[from_capture(start_node.getpixel((x,y))) for y in range(8) for x in range(8)],'u16'))
    marker=Image.open(HERE/'native-map-marker.png').convert('RGBA')
    assert marker.size==(400,46)
    marker_palette=[0]+sorted({from_capture(marker.getpixel((x,y))) for y in range(46) for x in range(400) if marker.getpixel((x,y))[3]})
    marker_pixels=[0 if not marker.getpixel((frame*50+x,y))[3] else marker_palette.index(from_capture(marker.getpixel((frame*50+x,y))))
                   for frame in range(8) for y in range(46) for x in range(50)]
    packed_marker=ndspy.lz10.compress(bytes(marker_pixels))
    assert ndspy.lz10.decompress(packed_marker)==bytes(marker_pixels)
    lines.append(emit('MapMarkerPalette',marker_palette,'u16'))
    lines.append(emit('MapMarkerLz',packed_marker,'u8',32))
    # Half-size renders of the game's eight badge-case models, captured from
    # the supplied native badge-case state at the DS framebuffer resolution.
    badges=Image.open(HERE/'native-badges.png').convert('RGBA')
    assert badges.size==(128,34)
    badge_palette=[0]+sorted({from_capture(badges.getpixel((x,y)))
        for y in range(34) for x in range(128) if badges.getpixel((x,y))[3]})
    assert len(badge_palette)<=256
    badge_pixels=[0 if not badges.getpixel((x,y))[3] else
        badge_palette.index(from_capture(badges.getpixel((x,y))))
        for y in range(34) for x in range(128)]
    packed_badges=ndspy.lz10.compress(bytes(badge_pixels))
    assert ndspy.lz10.decompress(packed_badges)==bytes(badge_pixels)
    lines.append(emit('BadgePalette',badge_palette,'u16'))
    lines.append(emit('BadgeLz',packed_badges,'u8',32))
    # The save menu's location code indexes the White 2 location text bank.
    # Decode it at build time so no menu-owned message handle is needed later.
    messages=ndspy.narc.NARC(rom.getFileByName('a/0/0/2')).files[109]
    block_count,count=struct.unpack_from('<HH',messages)
    assert block_count==1 and count==154
    block=struct.unpack_from('<I',messages,12)[0]
    names=[]
    for index in range(count):
        offset,length,_=struct.unpack_from('<IHH',messages,block+4+index*8)
        encrypted=list(struct.unpack_from('<'+'H'*length,messages,block+offset))
        key=encrypted[-1]^0xffff
        decoded=[]
        for char in reversed(encrypted):
            decoded.insert(0,char^key)
            key=((key>>3)|(key<<13))&0xffff
        name=''.join(chr(c) if 32<=c<127 or c==233 else ' ' for c in decoded if c!=0xffff).strip()
        names.append(name)
    assert names[26]=='Route 13'
    offsets=[];chars=[]
    for name in names:
        offsets.append(len(chars))
        chars.extend(ord(c) for c in name)
        chars.append(0)
    lines.append(emit('LocationNameOffsets',offsets,'u16'))
    assert all(0<=char<256 for char in chars)
    lines.append(emit('LocationNameChars',chars,'u8'))
    fontarc=ndspy.narc.NARC(rom.getFileByName('a/0/2/3')).files
    # The same native font is used for map labels, arbitrary trainer names,
    # and the play-time digits on the upper screen.
    font_chars=sorted((set(chars)-{0})|set(map(ord,
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,-'))|{233})
    lookup,accent,advances,rows=native_glyphs(fontarc[0],font_chars)
    lines.append(emit('MapFontLookup',lookup,'u8'))
    lines.append(emit('MapFontAccent',[accent],'u8'))
    lines.append(emit('MapFontAdvance',advances,'u8'))
    lines.append(emit('MapFontRows',rows,'u16'))
    font_palette=fontarc[5]
    assert (rgb555(font_palette,1),rgb555(font_palette,2))==(0xa94b,0xd694)
    lines.append(emit('MapFontPalette',[rgb555(font_palette,i) for i in (1,2)],'u16'))
    headers=ndspy.narc.NARC(rom.getFileByName('a/0/1/2')).files[0]
    assert len(headers)==615*48
    map_names=[]
    for i in range(615):
        row=headers[i*48:(i+1)*48]
        map_names.append(row[26]|((row[27]&3)<<8))
    assert map_names[439]==122  # Floccesy Town in the provided save.
    lines.append(emit('MapLocationNames',map_names,'u16'))
    locations=ndspy.narc.NARC(rom.getFileByName('a/0/8/5')).files
    assert len(locations)==1 and len(locations[0])%54==0
    points=[]
    for i in range(len(locations[0])//54):
        record=locations[0][i*54:(i+1)*54]
        header=struct.unpack_from('<H',record,0)[0]
        x,y=struct.unpack_from('<HH',record,4)
        assert header<615 and x<256 and y<168
        points.extend((header,x,y))
    assert len(points)==85*3 and len(set(points[::3]))==85
    assert points[points.index(439):points.index(439)+3]==[439,33,127]
    lines.append(emit('MapPoints',points,'u16'))
    for sex,chars,palette in ((0,5,4),(1,7,6)):
        raw=players[chars]
        for pose,cell in enumerate((0,6,18)):
            lines.append(emit(f'Player{sex}Pose{pose}',raw[48+cell*512:48+(cell+1)*512],'u8',32))
        lines.append(emit(f'Player{sex}Palette',[rgb555(players[palette],i) for i in range(16)],'u16'))
    (HERE/'assets.generated.h').write_text('\n'.join(lines))
    print('generated map/player/font assets',len(map_indices),'map pixels')

if __name__=='__main__':main()

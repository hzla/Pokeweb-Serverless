"""Extract the Pokémon icons build_content.py needs from a built White2Upgrade ROM.

    python3 runtime/mega-evolution/content/extract_w2u_icons.py White2Upgrade.nds <out dir>

Writes <asset>_0.bin / <asset>_1.bin (a/0/0/7 members asset*2+8, +9) for the Megas the PWAN library lacks, and the
ROM's pokeicon_palette_map.bin.
"""
import struct,sys,os
import sys
rom=open(sys.argv[1],"rb").read()
os.makedirs(sys.argv[2],exist_ok=True); os.chdir(sys.argv[2])
fnt_off,fnt_len,fat_off,fat_len=struct.unpack_from('<IIII',rom,0x40)
def fat(i): return struct.unpack_from('<II',rom,fat_off+i*8)
def walk(dir_id,prefix,out):
    off=fnt_off+(dir_id&0xfff)*8
    sub,first,_=struct.unpack_from('<IHH',rom,off)
    p=fnt_off+sub; fid=first
    while True:
        l=rom[p]; p+=1
        if l==0: break
        name=rom[p:p+(l&0x7f)].decode('latin1'); p+=l&0x7f
        if l&0x80:
            d,=struct.unpack_from('<H',rom,p); p+=2; walk(d,prefix+name+'/',out)
        else: out[prefix+name]=fid; fid+=1
files={}; walk(0xf000,'',files)
def get(path):
    s,e=fat(files[path]); return rom[s:e]
def narc(b):
    # BTAF
    o=0x10; assert b[o:o+4]==b'BTAF'; sz,n=struct.unpack_from('<IH',b,o+4)
    ents=[struct.unpack_from('<II',b,o+12+i*8) for i in range(n)]
    o2=o+sz; o2+=struct.unpack_from('<I',b,o2+4)[0]  # skip BTNF
    assert b[o2:o2+4]==b'GMIF'; base=o2+8
    return [b[base+s:base+e] for s,e in ents]
icons=narc(get('a/0/0/7'))
pal=get('pokeicon_palette_map.bin')
print(len(icons), len(pal), [p for p in files if 'pwan' in p][:5])
os.makedirs('w2u_icons',exist_ok=True)
for a in (724,727,742,778,787,788,797):
    for k in (0,1):
        open(f'w2u_icons/{a}_{k}.bin','wb').write(icons[a*2+8+k])
    print(a, len(icons[a*2+8]), pal[a])
open('w2u_icons/icon_palettes.bin','wb').write(icons[0])
open('w2u_icons/pokeicon_palette_map.bin','wb').write(pal)

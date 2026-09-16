"""Verify each English ROM independently and generate private address profiles.

The W2 functions were identified from REDACTED_REFERENCE call graphs/disassembly. B2
functions are found by unique instruction signatures, not an address delta.
"""
from pathlib import Path
import hashlib, json, re, struct
import ndspy.narc, ndspy.lz10
from analyze import HERE, ROOT, load, instructions

FUNCTIONS = {
    'Add': (168, 0x21efae0, 48), 'AddPP': (168, 0x21efcb0, 48),
    'Main': (168, 0x21ef8c4, 48), 'Del': (168, 0x21f06a8, 48),
    'Release': (168, 0x21f0054, 48), 'Status': (168, 0x21f1668, 64),
    'GetPfd': (168, 0x21e00f8, 10), 'GetRule': (168, 0x21e0128, 10),
    'GetProxy': (0, 0x204c438, 26), 'PalAddr': (0, 0x204bdec, 32),
    'PPGet': (0, 0x201cd24, 48), 'EffectiveTypes': (167, 0x21bb03c, 24),
    'ViewSrc': (167, 0x21bb0a4, 22),
    'MoveDraw': (168, 0x21ed85c, 48),
    'MoveClear': (168, 0x21ee280, 48),
    'MoveKey': (168, 0x21eecfc, 64),
    'CreateScreen': (168, 0x21eaa7c, 48),
    'GetMainModule': (168, 0x21e016c, 10),
    'ViewToBattle': (167, 0x219c784, 48),
    'FrontBattler': (167, 0x219d1c8, 48),
    'TypeAffinity': (167, 0x21bd1f0, 48),
    'MoveParam': (0, 0x20212ac, 192),
    'FlushBitmap': (0, 0x2048270, 40),
    'HiddenPower': (0, 0x201d7ec, 64),
    'BattleStat': (167, 0x21bb1f4, 292),
    'CheckSick': (167, 0x21bbb04, 20),
    'SickCont': (167, 0x21bbb54, 16),
    'HeldItem': (167, 0x21bb380, 12),
    'FieldSim': (167, 0x219d9e8, 8),
    'FieldEffect': (167, 0x21d5e50, 12),
    'MoveFlag': (0, 0x202143c, 164),
    # Creation stores the HP-number sprite at panel+4 (gauge+0x44+pos*0x84).
    'HpNumberBinding': (168, 0x21f0370, 48),
    'NameDraw': (168, 0x21f0f38, 48),
    'SexDraw': (168, 0x21f10b0, 48), 'LevelDraw': (168, 0x21f1388, 48),
    'GaugePosition': (168, 0x21f070c, 64),
    # Independently verify CLWK+0x68 -> cell animation+0x0c -> current cell+0x30.
    'SpriteInit': (0, 0x204d164, 68),
    'CellInit': (0, 0x204d258, 48),
    'CellSelect': (0, 0x2061184, 40),
}
def sha(b): return hashlib.sha256(b).hexdigest()
def branches(base, data, target):
    out=[]
    for j in range(0,len(data)-4,2):
        a,z=struct.unpack_from('<HH',data,j)
        if a&0xf800==0xf000 and z&0xf800==0xf800:
            d=((a&0x7ff)<<12)|((z&0x7ff)<<1)
            if d&0x400000: d-=0x800000
            if base+j+4+d==target: out.append(base+j)
    return out
def main():
    (HERE/'build').mkdir(exist_ok=True)
    _, reference=load('W2')
    for game, code in [('W2', b'IRDO'), ('B2', b'IREO')]:
        rom, blobs=load(game)
        assert rom.idCode==code
        found={}; checks=[]
        for name,(seg,addr,size) in FUNCTIONS.items():
            wb,wd=reference[seg]; pattern=wd[addr-wb:addr-wb+size]
            mask=bytearray(b'\xff'*size)
            for i in instructions(pattern,addr):
                off=i.address-addr
                if i.mnemonic in ('bl','blx'): mask[off:off+i.size]=b'\0'*i.size
                if i.mnemonic=='ldr' and '[pc,' in i.op_str:
                    mask[off]=0
                    lit=((i.address+4)&~3)+int(i.op_str.split('#')[1].split(']')[0],0)-addr
                    if 0<=lit<=size-4:
                        value=struct.unpack_from('<I',pattern,lit)[0]
                        if 0x02000000<=value<0x02400000: mask[lit:lit+4]=b'\0'*4
            base,data=blobs[seg]; hits=[]
            for j in range(0,len(data)-size,2):
                if data[j:j+2]!=pattern[:2]: continue
                if all(((data[j+k]^pattern[k])&mask[k])==0 for k in range(size)): hits.append(base+j)
            assert len(hits)==1,(game,name,hits)
            found[name]=hits[0]
            checks.append(dict(name=name,segment=seg,address=hits[0],bytes=data[hits[0]-base:hits[0]-base+size].hex()))
        base,data=blobs[168]; hooks=[]
        for label,values in [('EnemyPositions',(216,120,44,40,216,100,48,28,220,128,44,52)),
                             ('EnemyTriplePositions',(216,120,44,40,216,98,48,20,220,117,44,39,224,136,40,58))]:
            pattern=struct.pack('<'+'h'*len(values),*values)
            hits=[i for i in range(0,len(data)-len(pattern)+1,2) if data[i:i+len(pattern)]==pattern]
            assert len(hits)==1,(game,label,hits)
            address=base+hits[0]
            # The independently matched position routine must reference this table.
            assert struct.pack('<I',address) in data[found['GaugePosition']-base:found['GaugePosition']-base+432]
            checks.append(dict(name=label,segment=168,address=address,bytes=pattern.hex()))
        for name in ('Add','AddPP','Main','Del','Release','Status','NameDraw','SexDraw','LevelDraw'):
            sites=branches(base,data,found[name])
            assert len(sites)==dict(Add=3,AddPP=3,Main=1,Del=1,Release=1,Status=2,NameDraw=1,SexDraw=1,LevelDraw=2)[name]
            for site in sites:
                hooks.append(dict(kind='THUMB_BRANCH_LINK',name=name,address=site,bytes=data[site-base:site-base+4].hex()))
            # Two exported effect functions tail-call through a literal pointer.
            if name in ('Del','Status'):
                ptr=struct.pack('<I',found[name]|1)
                sites=[base+j for j in range(0,len(data)-4,4) if data[j:j+4]==ptr]
                assert len(sites)==1,(game,name,sites)
                hooks.append(dict(kind='OFFSET',name=name,address=sites[0],bytes=ptr.hex()))
        for name in ('MoveDraw','MoveKey'):
            sites=branches(base,data,found[name])
            assert len(sites)==2,(game,name,sites)
            for site in sites:
                hooks.append(dict(kind='THUMB_BRANCH_LINK',name=name,address=site,bytes=data[site-base:site-base+4].hex()))
        site=found['CreateScreen']+10
        assert site in branches(base,data,found['MoveClear'])
        hooks.append(dict(kind='THUMB_BRANCH_LINK',name='MoveClear',address=site,bytes=data[site-base:site-base+4].hex()))
        narc=ndspy.narc.NARC(rom.getFileByName('a/0/1/1'))
        resources={}
        for n in (*range(430,447),456,457,458):
            raw=narc.files[n]
            if raw[0]==0x10: raw=ndspy.lz10.decompress(raw)
            resources[str(n)]=sha(raw)
            (HERE/'build'/f'{game}-resource-{n}.bin').write_bytes(raw)
        profile=dict(game=game,rom_code=code.decode(),overlay_base=base,functions=found,
                     signatures=checks,hooks=hooks,resources=resources,
                     reference_segments={str(n):sha(d) for n,(b,d) in blobs.items()})
        (HERE/f'profile-{game}.json').write_text(json.dumps(profile,indent=2)+'\n')
        icon_names={'Add','AddPP','Main','Del','Release','Status','GetPfd','GetRule','GetProxy','PalAddr','PPGet','EffectiveTypes','ViewSrc','HpNumberBinding','NameDraw','SexDraw','LevelDraw','GaugePosition','EnemyPositions','EnemyTriplePositions','SpriteInit','CellInit','CellSelect'}
        for module in ('TypeIcons','MoveEffectiveness'):
            part=dict(profile);icons=module=='TypeIcons'
            part['hooks']=[h for h in hooks if h['name'].startswith('Move')!=icons]
            part['signatures']=[s for s in checks if (s['name'] in icon_names if icons else s['name'] not in icon_names or s['name'] in ('PPGet','EffectiveTypes','ViewSrc'))]
            part['resources']=resources if icons else {}
            (HERE/f'profile-{module}-{game}.json').write_text(json.dumps(part,indent=2)+'\n')

        lines=['// Generated by configure.py; independently matched in '+code.decode()+'.','#pragma once']
        lines += [f'constexpr unsigned Native{k} = 0x{v|1:08x};' for k,v in found.items()]
        (HERE/'build'/f'addresses-{game}.h').write_text('\n'.join(lines)+'\n')
        wrappers=[]
        sigs={'Add':'void* g, void* m, void* b, unsigned t, unsigned p',
              'AddPP':'void* g, void* m, void* b, unsigned t, unsigned p',
              'Main':'void* g','Del':'void* g, unsigned p','Release':'void* g',
              'Status':'void* g, unsigned s, unsigned p',
              'NameDraw':'void* g, void* p, void* pp',
              'SexDraw':'void* g, void* p','LevelDraw':'void* g, void* p',
              'MoveDraw':'void* b, const unsigned short* p',
              'MoveClear':'void* b, unsigned t',
              'MoveKey':'void* b, void* tp, const signed char* k, const void* m, int h, unsigned f'}
        args={'Add':'g,m,b,t,p','AddPP':'g,m,b,t,p','Main':'g','Del':'g,p','Release':'g','Status':'g,s,p'}
        args.update(NameDraw='g,p,pp',SexDraw='g,p',LevelDraw='g,p')
        args.update(MoveDraw='b,p',MoveClear='b,t',MoveKey='b,tp,k,m,h,f')
        for h in hooks:
            ret='int' if h['name']=='MoveKey' else 'void'
            wrappers.append(f'extern "C" {ret} {h["kind"]}_168_0x{h["address"]:X}({sigs[h["name"]]}) {{ return Hud{h["name"]}({args[h["name"]]}); }}')
        (HERE/'build'/f'hooks-{game}.h').write_text('\n'.join(wrappers)+'\n')
        for module in ('TypeIcons','MoveEffectiveness'):
            lines=[line for h,line in zip(hooks,wrappers) if h['name'].startswith('Move')==(module=='MoveEffectiveness')]
            (HERE/'build'/f'hooks-{module}-{game}.h').write_text('\n'.join(lines)+'\n')
        print(game, 'independently matched',len(found),'functions;',len(hooks),'hooks')
    # Asset generation: compact first initials in a 12x11 point-up rhombus.
    names='Normal Fighting Flying Poison Ground Rock Bug Ghost Steel Fire Water Grass Electric Psychic Ice Dragon Dark Fairy'.split()
    manifest=json.loads((HERE/'approved-icons.json').read_text())
    icons={v['name']:v for v in manifest['icons']}
    patterns={
        'N':('1001','1101','1011','1001','1001'),
        'F':('1111','1000','1110','1000','1000'),
        'P':('1110','1001','1110','1000','1000'),
        'G':('0111','1000','1011','1001','0111'),
        'R':('1110','1001','1110','1010','1001'),
        'B':('1110','1001','1110','1001','1110'),
        'S':('0111','1000','0110','0001','1110'),
        # Preserve the five-pixel W approved in the circular reference.
        'W':('10001','10001','10101','10101','01010'),
        'E':('1111','1000','1110','1000','1111'),
        'I':('111','010','010','010','111'),
        'D':('1110','1001','1001','1001','1110'),
    }
    # The four shoulder pixels at (3,1), (8,1), (3,9), and (8,9) close the
    # border above and below the widest inner-corner pixels.
    outline=[96,504,1020,2046,4095,4095,4095,2046,1020,504,96]
    fill=[0,96,504,1020,2046,2046,2046,1020,504,96,0]
    rows=[];colors=[]
    for name in names:
        v=icons[name];glyph=patterns[name[0]];left=(12-len(glyph[0]))//2
        symbol=[0]*11
        for y,line in enumerate(glyph,3):
            symbol[y]=sum(2048>>x for x,bit in enumerate(line,left) if bit=='1')
            assert not symbol[y]&~fill[y]
        rows.append(symbol)
        rgb=bytes.fromhex(next(c[1:] for c in v['colors'] if c!='#FFFFFF'))
        colors.append(sum((c>>3)<<(5*i) for i,c in enumerate(rgb)))
    # The alternate build keeps the approved circular symbols. Center its
    # original 10x10 art inside the renderer's 12x11 logical footprint so both
    # variants share placement, restoration and native caught-marker behavior.
    circle8=[60,126,255,255,255,255,126,60]
    circle_outline10=[120,252,510,1023,1023,1023,1023,510,252,120]
    circular8=[
        [0,36,60,66,66,36,24,0], [0,40,106,110,112,126,60,0],
        [0,4,28,56,116,120,32,0], [0,48,112,52,4,24,60,0],
        [0,36,8,24,126,36,24,0], [0,24,60,114,124,58,28,0],
        [0,24,0,102,102,60,24,0], [0,24,62,42,126,62,20,0],
        [0,60,80,108,10,42,28,0], [0,16,8,24,44,46,28,0],
        [0,16,24,60,60,66,60,0], [0,8,40,44,108,108,44,0],
        [0,8,24,48,28,8,16,0], [0,24,102,66,36,66,60,0],
        [0,16,68,24,60,68,8,0], [0,36,60,126,90,24,24,0],
        [0,0,66,82,82,36,24,0], [0,36,102,126,36,24,36,0],
    ]
    circular_fill=[0]+[v<<2 for v in circle8]+[0,0]
    circular_outline=[v<<1 for v in circle_outline10]+[0]
    circular_rows=[[0]+[v<<2 for v in symbol]+[0,0] for symbol in circular8]

    def asset_header(comment,asset_fill,asset_outline,asset_rows):
        text=comment+'\n'
        text+='constexpr u16 Fill[11] = {'+','.join(map(str,asset_fill))+'};\n'
        text+='constexpr u16 Outline[11] = {'+','.join(map(str,asset_outline))+'};\n'
        text+='constexpr u16 Symbols[18][11] = {\n'+''.join('  {'+','.join(map(str,row))+'}, // '+name+'\n' for row,name in zip(asset_rows,names))+'};\n'
        text+='constexpr u16 Colors[18] = {'+','.join(hex(v) for v in colors)+'};\n'
        text+='static_assert(sizeof(Fill)+sizeof(Outline)+sizeof(Symbols)+sizeof(Colors)==476, "asset budget");\n'
        return text

    out=asset_header('// Compact first initials in a 12x11 point-up rhombus and black outline.',fill,outline,rows)
    circular_out=asset_header('// Approved circular symbols centered in the shared 12x11 footprint.',circular_fill,circular_outline,circular_rows)
    backgrounds=[]
    width,height,left,top=26,17,0,15
    for n in (438,435,444,441):
        raw=(HERE/'build'/f'W2-resource-{n}.bin').read_bytes()[48:]
        assert raw==(HERE/'build'/f'B2-resource-{n}.bin').read_bytes()[48:]
        packed=bytearray((width*height+1)//2)
        for y in range(height):
            for x in range(width):
                a,b=x+left,y+top
                v=(raw[((b//8)*8+a//8)*32+(b%8)*4+(a%8)//2]>>((a&1)*4))&15
                v=2 if v in (4,15) else v
                i=y*width+x;packed[i//2]|=v<<((i&1)*4)
        backgrounds.append(list(packed))
    background_out='// Verified native x=0..25, y=15..31 pixels, packed in four bits.\n'
    background_out+='constexpr u8 PanelBackground[4][221] = {\n'+''.join('  {'+','.join(map(str,b))+'},\n' for b in backgrounds)+'};\n'
    out+=background_out;circular_out+=background_out
    (HERE/'assets.h').write_text(out)
    (HERE/'assets-circular.h').write_text(circular_out)
    (HERE/'assets.json').write_text(json.dumps(dict(names=names,fill=fill,outline=outline,symbols=rows,rgb555=colors,
        iconWidth=12,iconHeight=11,stackDx=5,stackDy=6,stackTop=15,variant='letters'),indent=2)+'\n')
    (HERE/'assets-circular.json').write_text(json.dumps(dict(names=names,fill=circular_fill,outline=circular_outline,
        symbols=circular_rows,rgb555=colors,iconWidth=12,iconHeight=11,stackDx=5,stackDy=6,stackTop=15,
        variant='circular'),indent=2)+'\n')
if __name__=='__main__':
    main()
    from panel_expansion import generate
    generate()

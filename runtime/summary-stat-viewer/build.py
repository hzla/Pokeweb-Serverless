"""Build independent US B2/W2 Summary companions from verified retail inputs."""
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import ndspy.rom
import ndspy.narc
import ndspy.codeCompression

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[1]
WORKSPACE=REPO.parent
BUILD=HERE/'build'
ASSETS=REPO/'src/assets/codeinjection'
TOOLS=Path(os.environ.get('ARM_TOOLCHAIN_BIN',WORKSPACE/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('RPM_TOOL_JAR',WORKSPACE/'White2Upgrade/CTRMap.jar'))
VERSION='1.0.3'
PINS={'W2':'26657348bd732a2e970d9244cd37817141013af0a62444a816f4333ebfadb985',
      'B2':'9cf7894e8f4244ce0b06b92e9113b14eefbfabf8174e7dbab8a7986497418cce'}
HOOKS=[
    ('SummaryInit',0x21b5326,0x21b2fc0),('SummaryEnd',0x21b5352,0x21b3198),
    ('SummaryTick',0x21b337a,0x2021a68),('SummaryKeys',0x21b403a,0x21b404c),
    ('SummaryTouch',0x21b4044,0x21b4220),('SummaryHit',0x21b4012,0x203da38),
    ('SummarySlash',0x21b8fce,0x21b4f04),('SummaryHp',0x21b8fb4,0x21b5080),
    ('SummaryMaxHp',0x21b9008,0x21b5080),('SummaryTitle',0x21b8d4e,0x2045500),
    ('SummaryTitleChars',0x21b3766,0x204add4),
    *[('SummaryValue',a,0x201cd24) for a in (0x21b8f8c,0x21b903e,0x21b909c,0x21b90fa,0x21b9158,0x21b91b6)],
]
# Explicit W2 -> B2 entry points; early ARM9 functions do not share the UI
# helpers' offset. Optional anchors are independently verified retail BLs.
APIS={
    0x204c4b4:(0x204c488,0x21b341a),0x204c150:(0x204c124,0x21b3dfc),
    0x204c4e4:(0x204c4b8,None),
    0x204c23c:(0x204c210,None),0x204bb84:(0x204bb58,0x21b6bfa),
    0x204c410:(0x204c3e4,0x21b6c06),0x204c134:(0x204c108,0x21b3f2a),
    0x204bfc4:(0x204bf98,0x21b3682),0x204b9b8:(0x204b98c,0x21b3cf0),
    0x204b8e8:(0x204b8bc,None),0x204bae4:(0x204bab8,None),
    0x204bf48:(0x204bf1c,0x21b3576),0x204c06c:(0x204c040,0x21b3de4),
    0x204c54c:(0x204c520,0x21b3df2),0x2006254:(0x2006254,0x21b4276),
    0x2021a68:(0x2021a3c,0x21b337a),0x203df70:(0x203df44,0x21b4050),
    0x203da38:(0x203da0c,0x21b4012),0x201cd24:(0x201ccf8,0x21b8f8c),
    0x204add4:(0x204ada8,0x21b3766),0x20450ac:(0x2045080,None),
    0x2045500:(0x20454d4,0x21b8d4e),0x2048520:(0x20484f4,0x21b8612),
    0x2047168:(0x204713c,0x21b934e),
}
NATIVE=[0x21b2fc0,0x21b3198,0x21b4a10,0x21b404c,0x21b4220,0x21b4f04,0x21b5080,
        0x21b4e4c,0x21b8f50]

def run(*args): subprocess.run([str(x) for x in args],check=True)
def bl_target(b,address):
    a,c=struct.unpack('<HH',b)
    assert a&0xf800==0xf000 and c&0xf800==0xf800
    d=((a&2047)<<12)|((c&2047)<<1)
    if d&0x400000:d-=0x800000
    return address+4+d
def graphics(files, bw1=False):
    raw=files[13][48:48+2304]
    assert len(raw)==2304 and struct.unpack_from('<I',files[80],32)[0]==2
    assert files[80][24:28]==struct.pack('<HH',9,0)
    def pose(n):
        rows=[]
        for y in range(32):
            row=[]
            for x in range(40):
                tile=n*768+(y//8*4+x//8)*32 if x<32 else n*768+512+y//8*64
                v=raw[tile+y%8*4+x%8//2];row.append(v>>(x%2*4)&15)
            rows.append(row)
        return rows
    def pack(rows):
        out=bytearray(768)
        for y in range(32):
            for x in range(40):
                tile=(y//8*4+x//8)*32 if x<32 else 512+y//8*64
                out[tile+y%8*4+x%8//2]|=rows[y][x]<<(x%2*4)
        return bytes(out)
    def narrow(rows):
        return [r[:20]+r[30:40]+[0]*10 for r in rows]
    compact=b''.join(pack(narrow(pose(i))) for i in range(3))
    stats=pose(2)
    for y in range(5,19):
        for x in range(6,23):stats[y][x]=1
    # Three outlined horizontal bars sharing a left spine. Stepped corners
    # preserve the reference's rounded silhouette at the native icon size.
    bars=[
        '01111110000000','10000001000000','10000001000000',
        '10000001000000','11111111111110','10000000000001',
        '10000000000001','10000000000001','11111111111110',
        '10000000001000','10000000001000','10000000001000',
        '10000000001000','01111111110000',
    ]
    for y,row in enumerate(bars):
        for x,p in enumerate(row):
            if p=='1':stats[y+5][x+6]=6 # native selected/flashing palette
    statbank=raw[:1536]+pack(stats)
    statcompact=compact[:1536]+pack(narrow(stats))
    chars=files[11][48:48+8192]
    native=struct.unpack_from('<96H',files[77],36)
    # All four native title maps reserve the blank tail of this character bank.
    title_tiles=set()
    for n in (67,71,77,78):
        used={v&1023 for v in struct.unpack_from('<1024H',files[n],36)}
        title_tiles.update(used)
        if not bw1: assert max(used)<64
    if bw1:
        assert not title_tiles.intersection(list(range(64,74))+list(range(96,106)))
    def pixel(x,y):
        m=native[y//8*32+x//8];tx=7-x%8 if m&1024 else x%8;ty=7-y%8 if m&2048 else y%8
        v=chars[(m&1023)*32+ty*4+tx//2];return v>>(tx%2*4)&15
    # Copy S without binarizing its lighter diagonal edge pixels. V inherits
    # the native A's mirrored diagonal shading, with the crossbar removed.
    # Straight I/E strokes use only the native ink index, with no drop shadow.
    if bw1:
        s=[''.join(format(pixel(185+x,13+y),'x') for x in range(4)) for y in range(7)]
        a=[''.join(format(pixel(198+x,13+y),'x') for x in range(4)) for y in range(7)]
        assert s==['1221','2aa2','2aaa','1221','aaa2','2aa2','1221']
        assert a==['1221','2aa2','2aa2','2222','2aa2','2aa2','2aa2']
        # Copy V/E from the native BATTLE MOVES title. Inverting BW1's A
        # produces a U, because its stems are straight rather than diagonal.
        moves=struct.unpack_from('<96H',files[78],36)
        def move_pixel(x,y):
            m=moves[y//8*32+x//8];tx=7-x%8 if m&1024 else x%8;ty=7-y%8 if m&2048 else y%8
            return chars[(m&1023)*32+ty*4+tx//2]>>(tx%2*4)&15
        v=[''.join(format(move_pixel(222+x,13+y),'x') for x in range(4)) for y in range(7)]
        e=[''.join(format(move_pixel(228+x,13+y),'x') for x in range(4)) for y in range(7)]
        assert v==['2aa2','2aa2','2aa2','2aa2','1111','a22a','a11a']
        assert e==['2222','2aaa','2aaa','222a','2aaa','2aaa','2222']
        glyph={'I':['222','a2a','a2a','a2a','a2a','a2a','222'],'V':v,
               'E':e,'S':s}
    else:
        s=[''.join(str(pixel(190+x,14+y)) for x in range(4)) for y in range(5)]
        a=[''.join(str(pixel(201+x,14+y)) for x in range(5)) for y in range(5)]
        assert s==['9111','1333','9119','3331','1119']
        assert a==['33133','39193','31313','91119','13331']
        v=list(reversed(a));v[1]=v[1][:2]+'3'+v[1][3:]
        glyph={'I':['111','313','313','313','111'],'V':v,
               'E':['1111','1333','1113','1333','1111'],'S':s}
    maps=[];tiles=bytearray()
    for label in ('IVS','EVS'):
        rows=[[pixel(184+x,8+y) for x in range(40)] for y in range(16)]
        for y in range(5,12):
            for x in range(1 if bw1 else 6,32 if bw1 else 36):rows[y][x]=10 if bw1 else 3
        width=sum(len(glyph[c][0])+1 for c in label)-1
        x=((32 if bw1 else 40)-width)//2
        for c in label:
            g=glyph[c]
            for yy,r in enumerate(g):
                for xx,v in enumerate(r):
                    rows[(5 if bw1 else 6)+yy][x+xx]=int(v,16)
            x+=len(g[0])+1
        m=list(native)
        for ty in range(2):
            for tx in range(5):
                index=(64 if label=='IVS' else 96)+len(tiles)//32%10 if bw1 else 64+len(tiles)//32
                pos=(ty+1)*32+tx+23
                m[pos]=(native[pos]&0xf000)|index if bw1 else 0x1000|index
                for yy in range(8):
                    for xx in range(0,8,2):tiles.append(rows[ty*8+yy][tx*8+xx]|rows[ty*8+yy][tx*8+xx+1]<<4)
        maps.append(m)
    assert len(tiles)==640
    arrays={'compactTabs':compact,'statTabs':statbank,'compactStatTabs':statcompact,'titleGlyphs':tiles}
    header=['#pragma once']
    for name,data in arrays.items():header.append(f'alignas(4) static const u8 {name}[]={{'+','.join(str(v) for v in data)+'};')
    for name,m in zip(('ivTitle','evTitle'),maps):header.append(f'alignas(4) static const u16 {name}[]={{'+','.join(str(v) for v in m)+'};')
    return '\n'.join(header)+'\n'

def main():
    BUILD.mkdir(exist_ok=True)
    manifest_path=ASSETS/'summaryStatViewerManifest.json'
    previous=[]
    if manifest_path.exists():
        prior=json.loads(manifest_path.read_text())
        previous=prior.get('previousVersions',[])
        if prior['version']!=VERSION and not any(p['version']==prior['version'] for p in previous):
            previous.append({'version':prior['version'],'games':{g:{
                'codeFingerprint':p['codeFingerprint'],'bssSize':p['bssSize'],
                'hooks':[{'module':s['module'],'address':s['address']} for s in p['signatures'] if s['patchSize']]
            } for g,p in prior['games'].items()}})
    manifest={'version':VERSION,'configMagic':'5353564346473100','previousVersions':previous,'games':{}}
    original_graphics=None
    w2_api_bytes={}
    profile=['#pragma once','inline u32 nativeApiAddress(u32 w2) {','#ifdef GAME_B2','switch (w2) {']
    profile += [f'case 0x{a:x}: return 0x{b:x};' for a,(b,_) in APIS.items()]
    profile += ['default: __builtin_trap();','}','#else','return w2;','#endif','}']
    (BUILD/'profiles.generated.h').write_text('\n'.join(profile)+'\n')
    for game,filename,delta in [('W2','cleanwhite2.nds',0),('B2','cleanblack2.nds',0x40)]:
        rom=ndspy.rom.NintendoDSRom.fromFile(os.environ.get(f'SUMMARY_{game}_ROM',WORKSPACE/filename))
        assert bytes(rom.idCode)==(b'IRDO' if game=='W2' else b'IREO')
        o=rom.loadArm9Overlays([207])[207]
        assert hashlib.sha256(o.data).hexdigest()==PINS[game]
        arm=ndspy.codeCompression.decompress(rom.arm9);ad=0 if game=='W2' else 0x2c
        f=ndspy.narc.NARC(rom.getFileByName('a/0/7/7')).files
        generated=graphics(f)
        if original_graphics is not None:assert generated==original_graphics
        original_graphics=generated
        (BUILD/'graphics.generated.h').write_text(generated)
        signatures=[];asm=['.syntax unified','.thumb']
        for label,w2,target in HOOKS:
            a=w2-delta;at=a-o.ramAddress;b=bytes(o.data[at:at+4])
            assert bl_target(b,a)==target-(delta if target>=0x21b0000 else ad),(game,label,hex(a))
            signatures.append({'label':label,'module':'207','address':a,'expectedHex':b.hex(),'patchSize':4})
            sym=f'THUMB_BRANCH_LINK_207_0x{a:x}'
            # r3 and SP are preserved even for seven/ten-argument native calls.
            asm+=['.balign 4',f'.global {sym}',f'.type {sym},%function','.thumb_func',sym+':',
                  'push {r3}','ldr r3,1f','mov ip,r3','pop {r3}','bx ip','.balign 4',f'1: .word {label}',f'.size {sym},.-{sym}']
        for a in NATIVE:
            at=a-delta-o.ramAddress
            signatures.append({'label':'Native Summary ABI','module':'207','address':a-delta,'expectedHex':bytes(o.data[at:at+8]).hex(),'patchSize':0})
        for a,(b,anchor) in APIS.items():
            address=a if game=='W2' else b
            size=12 if a==0x2006254 else 26 if a==0x204c4e4 else 8
            at=address-rom.arm9RamAddress;expected=bytes(arm[at:at+size])
            if game=='W2': w2_api_bytes[a]=expected
            else: assert expected==w2_api_bytes[a],(game,'API body mismatch',hex(address))
            if anchor is not None:
                site=anchor-delta
                assert bl_target(o.data[site-o.ramAddress:site-o.ramAddress+4],site)==address,(game,'API call mismatch',hex(site))
            signatures.append({'label':'Native API ABI','module':'ARM9','address':address,'expectedHex':expected.hex(),'patchSize':0})
        # Non-hooked HP-bar reads and footer palette scheduling must remain native.
        for a,n in [(0x21b92b4,4),(0x21b92c2,4),(0x21bafc4,36),(0x21b4c9a,0x42),
                    (0x21b8f50,0x28),(0x21b929e,6),(0x21b85e0,0x8c),(0x21b8ce4,0xa4),
                    (0x21b8bd4,16)]:
            at=a-delta-o.ramAddress
            signatures.append({'label':'Summary layout','module':'207','address':a-delta,'expectedHex':bytes(o.data[at:at+n]).hex(),'patchSize':0})
        stem=f'SummaryStatViewer{game}'
        (BUILD/f'{stem}.s').write_text('\n'.join(asm)+'\n')
        obj=BUILD/f'{stem}.o';hooks=BUILD/f'{stem}Hooks.o';elf=BUILD/f'{stem}.elf'
        run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-march=armv5t','-mlong-calls','-Os','-Wall','-Wextra','-Werror',
            '-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-ffreestanding','-fno-builtin',
            '-fvisibility=hidden',f'-DGAME_{game}','-I',BUILD,'-c',HERE/'viewer.cpp','-o',obj)
        run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',BUILD/f'{stem}.s','-o',hooks)
        run(TOOLS/'arm-none-eabi-g++','-mthumb','-march=armv5t','-nostdlib','-Wl,-r',obj,hooks,'-o',elf)
        assert not subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(elf)]).strip()
        meta=BUILD/f'{stem}.yml';meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n')
        esdb=BUILD/'symbols.yml';esdb.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
        output=ASSETS/f'{stem}.dll'
        with tempfile.TemporaryDirectory(dir=BUILD) as tmp:
            candidate=Path(tmp)/output.name
            run('java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',candidate,'--esdb',esdb,'--meta',meta,'--generate-relocations','--strip')
            data=candidate.read_bytes();assert data[:4]==b'DLXF' and len(data)>128
            dump=subprocess.check_output(['java','-cp',str(JAR),'rpm.cli.RPMDump','--fourcc','DLXF','-i',str(candidate)])
            assert b'Symbol count:' in dump and b'Exception' not in dump
            output.write_bytes(data)
        (BUILD/f'{stem}.dump.txt').write_bytes(dump)
        header=struct.unpack_from('<I',data,8)[0]
        info=header+struct.unpack_from('<I',data,header+8)[0]
        code_offset,code_size=struct.unpack_from('<II',data,info+16)
        code=bytearray(data[code_offset:code_offset+code_size]);p=code.index(b'SSVCFG1\0')
        code[p+12:p+20]=bytes(8);fingerprint=0x811c9dc5
        for value in code:fingerprint=((fingerprint^value)*0x1000193)&0xffffffff
        manifest['games'][game]={'idCode':bytes(rom.idCode).decode(),'fileName':output.name,
          'codeFingerprint':f'{fingerprint:08x}','bssSize':struct.unpack_from('<I',data,header+12)[0],
          'sha256':hashlib.sha256(data).hexdigest(),'signatures':signatures,
          'resources':[{'member':n,'sha256':hashlib.sha256(f[n]).hexdigest()} for n in (5,11,13,67,71,77,78,80,131)]}
        print(output.name,len(data))
    manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
    fixture=ndspy.narc.NARC();fixture.files=[b'']*132
    for resource in manifest['games']['W2']['resources']:
        n=resource['member'];assert hashlib.sha256(f[n]).hexdigest()==resource['sha256']
        fixture.files[n]=f[n]
    (REPO/'src/test/fixtures/summaryStatViewerGraphics.narc').write_bytes(fixture.save())
if __name__=='__main__': main()

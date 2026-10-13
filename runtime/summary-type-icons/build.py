"""Build US BW2 Summary Type Icons from verified retail hooks."""
import hashlib,json,os,struct,subprocess,sys,tempfile
from pathlib import Path
import ndspy.rom,ndspy.narc,ndspy.codeCompression
from assets import build_assets,HERE

REPO=HERE.parents[1];WORKSPACE=REPO.parent;BUILD=HERE/'build';ASSETS=REPO/'src/assets/codeinjection'
TOOLS=Path(os.environ.get('ARM_TOOLCHAIN_BIN',WORKSPACE/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('RPM_TOOL_JAR',WORKSPACE/'White2Upgrade/CTRMap.jar'))
VERSION='1.0.0'
PINS={'W2':'26657348bd732a2e970d9244cd37817141013af0a62444a816f4333ebfadb985',
      'B2':'9cf7894e8f4244ce0b06b92e9113b14eefbfabf8174e7dbab8a7986497418cce'}
APIS=[0x2046c6c,0x204b6d4,0x203a228,0x203a278,0x2070ca8,0x2070ecc,
      0x204aac8,0x204ab38,0x204bbe4,0x204be0c,0x204b848,0x204bb84,
      0x204c3a4,0x2060f50,0x204b7f4,0x204c134,0x204c16c,0x2076820,
      0x204bfc4,0x204b9b8,0x204bcfc,0x204be90,0x204bf48,0x204c06c,0x204c150,0x204bae4]
HOOKS=[('IconSystem',0x21b356a,0x204b6d4),
       *[('IconGetProxy',a,0x204bb84) for a in (0x21b6bfa,0x21b6c68)],
       *[('IconPalette',a,0x204c3a4) for a in (0x21b6c1c,0x21b6c8a)],
       ('IconInfoPosition',0x21b6c38,0x204c16c),('IconInfoPosition',0x21b6ca2,0x204c16c)]

def run(*args):subprocess.run([str(a) for a in args],check=True)
def bl(b,address):
    a,c=struct.unpack('<HH',b)
    if a&0xf800!=0xf000 or c&0xf800!=0xf800:return None
    d=((a&2047)<<12)|((c&2047)<<1)
    if d&0x400000:d-=0x800000
    return address+4+d
def find(o,target,lo,hi):
    hits=[a for a in range(lo,hi,2) if bl(o.data[a-o.ramAddress:a-o.ramAddress+4],a)==target]
    assert len(hits)==1,(hex(target),hits)
    return hits[0]
def fingerprint(b):
    h=0x811c9dc5
    for v in b:h=((h^v)*0x1000193)&0xffffffff
    return f'{h:08x}'

def main():
    BUILD.mkdir(exist_ok=True);archive,records=build_assets()
    m={'version':VERSION,'archivePath':'summary-type-icons/ui.narc','archiveSha256':hashlib.sha256(archive).hexdigest(),'games':{}}
    (BUILD/'profiles.generated.h').write_text('#pragma once\nusing Address=unsigned int;\ninline Address nativeAddress(Address a){\n#ifdef GAME_B2\nreturn a-44;\n#else\nreturn a;\n#endif\n}\ninline Address overlayAddress(Address a){\n#ifdef GAME_B2\nreturn a-64;\n#else\nreturn a;\n#endif\n}\n')
    reference={}
    for game,name,delta in [('W2','cleanwhite2.nds',0),('B2','cleanblack2.nds',64)]:
        r=ndspy.rom.NintendoDSRom.fromFile(WORKSPACE/name);assert bytes(r.idCode)==(b'IRDO' if game=='W2' else b'IREO') and r.version==0
        o=r.loadArm9Overlays([207])[207];assert hashlib.sha256(o.data).hexdigest()==PINS[game]
        arm=ndspy.codeCompression.decompress(r.arm9);ad=44 if delta else 0
        if not delta:
            hooks=HOOKS+[
                ('IconBanks',find(o,0x2046c6c,0x21b346c,0x21b356a),0x2046c6c),
                ('IconEnd',find(o,0x21b3664,0x21b3198,0x21b3464),0x21b3664),
                ('IconResources',find(o,0x21b36e4,0x21b2fc0,0x21b3198),0x21b36e4)]
            hooks += [('IconVisible',a,0x204c150) for a in range(0x21b6b14,0x21b6d6c,2)
                      if bl(o.data[a-o.ramAddress:a-o.ramAddress+4],a)==0x204c150]
            (BUILD/'hooks.json').write_text(json.dumps(hooks)+'\n')
        sig=[];asm=['.syntax unified','.thumb']
        def check(label,mod,addr,n,patch=0):
            b=bytes((arm if mod=='ARM9' else o.data)[addr-(r.arm9RamAddress if mod=='ARM9' else o.ramAddress):][:n])
            assert len(b)==n
            sig.append({'label':label,'module':str(mod),'address':addr,'expectedHex':b.hex(),'patchSize':patch});return b
        for label,a,target in hooks:
            addr=a-delta;assert bl(check(label,207,addr,4,4),addr)==target-(delta if target>=0x21b0000 else ad),(game,label,hex(addr))
            sym=f'THUMB_BRANCH_LINK_207_0x{addr:x}'
            asm+=['.balign 4',f'.global {sym}',f'.type {sym},%function','.thumb_func',sym+':',
                  'push {r3}','ldr r3,1f','mov ip,r3','pop {r3}','bx ip','.balign 4',f'1: .word {label}',f'.size {sym},.-{sym}']
        thunk=0x21b3468-delta
        assert struct.unpack('<I',check('Summary VBlank thunk',207,thunk,4,4))[0]==0x204b7f5-ad
        sym=f'FULL_COPY_207_0x{thunk:x}'
        asm+=['.balign 4',f'.global {sym}',f'.type {sym},%object',sym+':','.word IconVblank',f'.size {sym},4']
        row=0x21bb154-delta;table=bytearray(check('Information row layout',207,row,40,40))
        assert table[:12]==bytes.fromhex('020110020203100202050802');table[1]=5;table[9]=1
        sym=f'FULL_COPY_207_0x{row:x}'
        asm+=['.balign 4',f'.global {sym}',f'.type {sym},%object',sym+':','.byte '+','.join(map(str,table)),f'.size {sym},40']
        for a in APIS:
            body=check('Native graphics ABI','ARM9',a-ad,8)
            if not delta:reference[a]=body
            else:assert body==reference[a],(game,hex(a))
        check('Native extended palette loader','ARM9',0x204da20-ad,0x14a)
        check('Native extended palette upload','ARM9',0x2060f50-ad,0x9c)
        assert struct.unpack('<12I',check('Summary VRAM ownership',207,0x21baf94-delta,48))==(1,0,4,0,2,0,256,0,8,32,0x200010,16)
        check('Native summary teardown',207,0x21b3664-delta,0x44)
        stem=f'SummaryTypeIcons{game}';s=BUILD/f'{stem}.s';s.write_text('\n'.join(asm)+'\n')
        run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-march=armv5t','-mlong-calls','-Os','-Wall','-Wextra','-Werror',
            '-fno-jump-tables','-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-ffreestanding','-fno-builtin',
            '-fvisibility=hidden',f'-DGAME_{game}','-I',BUILD,'-c',HERE/'icons.cpp','-o',BUILD/f'{stem}.o')
        run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',s,'-o',BUILD/f'{stem}Hooks.o')
        elf=BUILD/f'{stem}.elf';run(TOOLS/'arm-none-eabi-g++','-nostdlib','-Wl,-r',BUILD/f'{stem}.o',BUILD/f'{stem}Hooks.o','-o',elf)
        assert not subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(elf)]).strip()
        meta=BUILD/'metadata.yml';meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n')
        esdb=BUILD/'symbols.yml';esdb.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
        dll=ASSETS/f'{stem}.dll';run('java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',dll,'--esdb',esdb,'--meta',meta,'--generate-relocations','--strip')
        blob=dll.read_bytes();h=struct.unpack_from('<I',blob,8)[0];info=h+struct.unpack_from('<I',blob,h+8)[0]
        start,size=struct.unpack_from('<II',blob,info+16)
        m['games'][game]={'idCode':r.idCode.decode(),'revision':0,'fileName':dll.name,'sha256':hashlib.sha256(blob).hexdigest(),
            'codeFingerprint':fingerprint(blob[start:start+size]),'bssSize':struct.unpack_from('<I',blob,h+12)[0],'signatures':sig}
        print(stem,len(blob),'BSS',m['games'][game]['bssSize'])
    (ASSETS/'summaryTypeIconsManifest.json').write_text(json.dumps(m,indent=2)+'\n')

if __name__=='__main__':main()

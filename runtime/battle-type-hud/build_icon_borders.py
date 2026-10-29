"""Build opt-in BW2 border overlays; retain the distributed default renderers.

Each panel appends a private 32x32 outline sprite and reserves its own native
OBJ palette bank. The original HUD graphics and palette colors are retained.
"""
from pathlib import Path
import argparse, hashlib, json, os, subprocess, struct, sys
from build import HERE, ROOT, TOOLS, JAR, run
from rpm_read import read_rpm
from analyze import ROMS
import ndspy.rom, ndspy.narc, ndspy.codeCompression, ndspy.lz10
from panel_expansion import apply_edits

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--white2',type=Path)
    parser.add_argument('--black2',type=Path)
    args=parser.parse_args()
    if args.white2: ROMS['W2']=args.white2
    if args.black2: ROMS['B2']=args.black2
    out=HERE/'build/icon-borders';out.mkdir(exist_ok=True)
    assets=HERE.parents[1]/'src/assets/codeinjection'
    run('javac','-cp',JAR,'-d',out,HERE/'Compact.java')
    result=dict(games={},bw1={},resources={})
    images={}
    types=['NULL','VALUE','FUNCTION_ARM','FUNCTION_THM','SECTION']
    for game in ('B2','W2'):
        rom=ndspy.rom.NintendoDSRom.fromFile(ROMS[game]);base=rom.arm9RamAddress
        try:arm=ndspy.codeCompression.decompress(rom.arm9)
        except ValueError:arm=rom.arm9
        images[game]=rom
        delta=44 if game=='B2' else 0
        signatures=[]
        for name,address,size in [('BorderPaletteContext',0x204bdc8,36),('BorderPaletteFree',0x204bcfc,64),('BorderPaletteReserve',0x204da20,320)]:
            at=address-delta-base;signatures.append(dict(name=name,segment=0,address=address-delta,bytes=arm[at:at+size].hex()))
        assert struct.unpack_from('<I',arm,0x204bde8-delta-base)[0]==(0x214193c if game=='B2' else 0x214197c)
        result['games'][game]=dict(signatures=signatures,variants={})
        for redux in (False,True) if game=='W2' else (False,):
            for variant,define in [('letters',None),('circular','ICON_VARIANT_CIRCULAR')]:
                name='TypeIconsBorder'+('Circular' if variant=='circular' else '')+('Redux' if redux else '')+game
                version='0.3.19-border'+('-circular' if define else '')+('-redux' if redux else '')
                obj=out/(name+'.o');elf=out/(name+'.elf')
                flags=['-std=c++14','-mthumb','-march=armv5t','-mno-thumb-interwork','-mno-long-calls','-Os','-Wall','-Wextra','-Werror','-ffreestanding','-fno-builtin','-fno-jump-tables','-fvisibility=hidden','-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-DGAME_'+game,'-DICON_BORDER_CUSTOM']
                if define:flags+=['-D'+define]
                if redux:flags+=['-DBATTLE_HUD_REDUX']
                run(TOOLS/'arm-none-eabi-g++',*flags,'-c',HERE/'battle_type_hud.cpp','-o',obj)
                run(TOOLS/'arm-none-eabi-ld','-r',obj,'-o',elf)
                assert not subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(elf)]).strip()
                meta=out/(name+'.yml');meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 3\nPMCVersion: {version}\n')
                for debug in (True,False):
                    dll=out/(name+('.debug' if debug else '')+'.dll')
                    command=['java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',dll,'--esdb',HERE/'esdb.yml','--meta',meta,'--generate-relocations']
                    if not debug:command+=['--strip']
                    run(*command)
                    if not debug:run('java','-cp',str(JAR)+os.pathsep+str(out),'Compact',dll)
                data=(out/(name+'.dll')).read_bytes();rpm=read_rpm(data)
                debug=read_rpm((out/(name+'.debug.dll')).read_bytes())
                assert debug['code']==rpm['code']
                symbol=next(s for s in debug['symbols'] if s['name']=='gTypeIconBorderColor')
                offset=symbol['address'];assert symbol['size']==4 and rpm['code'][offset:offset+4]==bytes.fromhex('42080000')
                assert all(r['module']!='base' or not offset<=r['address']<offset+4 for r in rpm['relocations'])
                assert len([r for r in rpm['relocations'] if r['module']!='base'])==17
                key=variant+('-redux' if redux else '')
                result['games'][game]['variants'][key]=dict(fileName=name+'.dll',version=version,dllSha256=hashlib.sha256(data).hexdigest(),
                    build=dict(codeHex=rpm['code'].hex(),bssSize=rpm['bss'],borderColorOffset=offset,relocations=rpm['relocations'],
                        symbols=[dict(address=s['address'],type=types[s['type']],attributes=s['attributes']) for s in rpm['symbols']]))
                (assets/(name+'.dll')).write_bytes(data)
    # BW1 already owns separate icon palettes. Its one outline literal is data,
    # independent of all instructions, relocation targets and native palettes.
    standard=json.loads((assets/'battleTypeHudManifest.json').read_text())
    for game in ('B','W'):
        result['bw1'][game]={}
        for variant,suffix in [('letters',''),('circular','Circular')]:
            data=(assets/f'TypeIcons{suffix}{game}.dll').read_bytes();rpm=read_rpm(data)
            matches=[i for i in range(0,len(rpm['code'])-3,4) if rpm['code'][i:i+4]==bytes.fromhex('84100000')]
            assert len(matches)==1,(game,variant,matches)
            at=matches[0];assert all(r['module']!='base' or not at<=r['address']<at+4 for r in rpm['relocations'])
            result['bw1'][game][standard['games'][game]['variants'][variant]['version']]=at
    for key,game in [('retail','B2'),('redux','W2')]:
        archive=ndspy.narc.NARC(images[game].getFileByName('a/0/1/1'))
        expansion=json.loads((HERE/('redux-profile.json' if key=='redux' else 'panel-expansion.json')).read_text())
        if key=='redux':expansion=expansion['panelExpansion']
        result['resources'][key]={}
        for member in (435,436,438,439,441,442,444,445):
            raw=bytes(archive.files[member]);raw=ndspy.lz10.decompress(raw) if raw[0]==16 else raw
            if str(member) in expansion:raw=apply_edits(raw,expansion[str(member)]['edits'])
            def edit(at,old,new):return dict(offset=at,old=old.hex(),new=new.hex())
            edits=[]
            if raw[:4]==b'RGCN':
                for at in (8,20,40):
                    old=raw[at:at+4];edits.append(edit(at,old,struct.pack('<I',struct.unpack('<I',old)[0]+512)))
                edits.append(edit(len(raw),b'',bytes(512)))
            else:
                count=struct.unpack_from('<H',raw,48)[0];section=struct.unpack_from('<I',raw,20)[0]
                for at in (8,20):
                    old=raw[at:at+4];edits.append(edit(at,old,struct.pack('<I',struct.unpack('<I',old)[0]+8)))
                for at,value in ((48,count+1),(50,struct.unpack_from('<H',raw,50)[0]+4)):
                    edits.append(edit(at,raw[at:at+2],struct.pack('<H',value)))
                graphic=member-1
                packed=bytes(archive.files[graphic]);packed=ndspy.lz10.decompress(packed) if packed[0]==16 else packed
                if str(graphic) in expansion:packed=apply_edits(packed,expansion[str(graphic)]['edits'])
                tile=(len(packed)-48)//64
                old=raw[56:16+section];prefix=struct.pack('<HHH',0xc0,0x8000|448,tile)
                edits.append(edit(56,old,prefix+old+bytes(2)))
            patched=apply_edits(raw,edits)
            assert apply_edits(patched,edits,True)==raw
            result['resources'][key][str(member)]=dict(edits=edits,originalSha256=hashlib.sha256(raw).hexdigest(),patchedSha256=hashlib.sha256(patched).hexdigest())
    (assets/'typeIconBorderManifest.json').write_text(json.dumps(result,indent=2)+'\n')
    print('Bundled six optional BW2 border renderers and audited BW1 outline literals.')
if __name__=='__main__':main()

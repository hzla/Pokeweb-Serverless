"""Build BW1 Learnset companions; bundling checks the DS acceptance ledger."""
import hashlib
import argparse
import json
import os
import re
from pathlib import Path
import struct
import subprocess
import tempfile
from configure_bw1 import main as configure, PROFILES
from generated import write_info_messages

HERE=Path(__file__).resolve().parent
WORKSPACE=HERE.parents[2]
BUILD=HERE/'build'
TOOLS=Path(os.environ.get('ARM_TOOLCHAIN_BIN',WORKSPACE/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('RPM_TOOL_JAR',WORKSPACE/'White2Upgrade/CTRMap.jar'))
VERSION='0.1.0-bw1-candidate'

def run(*args):subprocess.run([str(x) for x in args],check=True)

def assembly(profile,group):
    lines=['.syntax unified','.thumb']
    for hook in profile['hooks']:
        menu=hook['label'] in ('MenuCreate','MenuSelect','Dispatch')
        if menu!=(group=='Menu'):continue
        label=hook['label'];address=hook['address'];overlay=hook['overlayId'];kind=hook['patchType']
        symbol=f'{kind}_{overlay}_0x{address:x}'
        lines+=['.balign 4',f'.global {symbol}',f'.type {symbol},%object' if kind=='FULL_COPY' else f'.type {symbol},%function']
        if kind!='FULL_COPY':lines+=['.thumb_func']
        lines+=[symbol+':']
        if label=='Viewer callbacks':lines+=['.word LearnsetViewerInit,LearnsetViewerMain,LearnsetViewerEnd']
        elif label in ('Screen','Window'):
            lines+=['push {r3}','ldr r3,1f','mov ip,r3','pop {r3}','bx ip','.balign 4','1: .word Learnset'+label]
        else:lines+=['ldr r3,1f','bx r3','1: .word Learnset'+label]
        lines+=[f'.size {symbol},.-{symbol}']
        if menu:
            original='Original'+label
            # Exact eight native bytes; configure rejects PC-relative replay.
            halfwords=struct.unpack('<4H',bytes.fromhex(hook['expectedHex'])[:8])
            lines+=['.balign 4',f'.global {original}',f'.type {original},%function','.thumb_func',original+':',
                    '.hword '+','.join(hex(x) for x in halfwords),'ldr r3,1f','bx r3',f'1: .word 0x{address+9:x}',f'.size {original},.-{original}']
    return '\n'.join(lines)+'\n'

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--menu-trace',action='store_true');trace=parser.parse_args().menu_trace
    configure();write_info_messages(BUILD)
    manifest={'version':VERSION,'games':{}}
    for game in PROFILES:
        profile=json.loads((HERE/f'profile-{game}.json').read_text())
        outputs=[]
        for group in ('Menu','Viewer'):
            if trace and group!='Menu':continue
            suffix='.trace' if trace else ''
            asm=BUILD/f'{group}{game}.s';asm.write_text(assembly(profile,group))
            sources=[HERE/f'{group.lower()}.cpp',HERE/'config.cpp',HERE/'memory.cpp']
            if group=='Viewer':sources.append(HERE/'info.cpp')
            objects=[]
            for source in sources:
                obj=BUILD/f'{source.stem}{group}{game}{suffix}.o';objects.append(obj)
                run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-march=armv5t','-mlong-calls','-Os','-Wall','-Wextra','-Werror',
                    '-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-ffreestanding','-fno-builtin',
                    '-fvisibility=hidden',f'-DGAME_{game}',*(['-DLEARNSET_BW1_TRACE'] if trace else []),'-I',BUILD,'-I',HERE,'-c',source,'-o',obj)
            obj=BUILD/f'{group}{game}.o';objects.append(obj)
            run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',asm,'-o',obj)
            elf=BUILD/f'Learnset{group}{game}{suffix}.elf'
            run(TOOLS/'arm-none-eabi-g++','-mthumb','-march=armv5t','-nostdlib','-Wl,-r',*objects,'-o',elf)
            undefined=subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(elf)]).decode().strip()
            assert not undefined,undefined
            sections=subprocess.check_output([str(TOOLS/'arm-none-eabi-readelf'),'-SW',str(elf)]).decode()
            assert not re.search(r'\.(init_array|fini_array|ctors|dtors)\b',sections),'Constructors are not supported'
            esdb=BUILD/f'symbols_{game}.yml';esdb.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
            meta=BUILD/f'{group}{game}.yml';meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n')
            output=BUILD/f'Learnset{group}{game}{suffix}.dll'
            with tempfile.TemporaryDirectory(prefix='learnset-bw1-',dir=BUILD) as temp:
                candidate=Path(temp)/output.name
                run('java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',candidate,'--esdb',esdb,'--meta',meta,'--generate-relocations','--strip')
                data=candidate.read_bytes();assert data[:4]==b'DLXF' and len(data)>128
                dump=subprocess.check_output(['java','-cp',str(JAR),'rpm.cli.RPMDump','--fourcc','DLXF','-i',str(candidate)])
                assert b'Symbol count:' in dump and b'Exception' not in dump
                output.write_bytes(data)
            outputs.append({'group':group,'file':output.name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)})
            print(output.name,len(data))
        manifest['games'][game]={**profile,'modules':outputs}
    (BUILD/('bw1-trace.json' if trace else 'bw1-candidates.json')).write_text(json.dumps(manifest,indent=2)+'\n')

if __name__=='__main__':main()

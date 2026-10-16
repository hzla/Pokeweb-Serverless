"""Build the pinned US Black/White buffered stream players (no ROM required)."""
import hashlib
import json
import math
import subprocess
import sys
import shutil
import struct
from build import HERE, REPO, BUILD, TOOLS, JAR, run


def main():
    manifest = json.loads((HERE / 'bw1_native.json').read_text())
    testing = '--test-driver' in sys.argv
    for game, profile in manifest['games'].items():
        out = BUILD / f'bw1-{game}{"-test" if testing else ""}'
        out.mkdir(parents=True, exist_ok=True)
        (out / 'bw1_native.generated.h').write_text('\n'.join(
            f'#define NATIVE_{b["name"]} 0x{b["address"]:08x}' for b in profile['bindings']) + '\n')
        (out / 'bw1_volume.generated.h').write_text('static const int16_t decibels[128]={' +
            ','.join(str(round(200*math.log10(v/127))) if v else '-32768' for v in range(128)) + '};\n')
        asm = ['.syntax unified', '.thumb']
        for hook in profile['hooks']:
            symbol = f'THUMB_BRANCH_LINK_ARM9_0x{hook["address"]:08x}'
            # Tail call preserves the fifth StartSeqEx argument on the stack.
            asm += ['.balign 4', f'.global {symbol}', f'.type {symbol},%function', '.thumb_func', symbol+':',
                    'push {r3}', 'ldr r3,1f', 'mov ip,r3', 'pop {r3}', 'bx ip', '.balign 4',
                    f'1: .word {hook["target"]}', f'.size {symbol},.-{symbol}']
        asm += ['.balign 4','.global __aeabi_uidiv','.global __aeabi_uidivmod',
                '.type __aeabi_uidiv,%function','.type __aeabi_uidivmod,%function',
                '.thumb_func','__aeabi_uidiv:', '.thumb_func','__aeabi_uidivmod:',
                'push {r2,lr}','sub sp,#8','mov r2,sp','bl PwDivide','ldr r1,[sp]',
                'add sp,#8','pop {r2,pc}', '.size __aeabi_uidiv,.-__aeabi_uidiv',
                '.size __aeabi_uidivmod,.-__aeabi_uidivmod']
        (out / 'hooks.s').write_text('\n'.join(asm)+'\n')
        objects = []
        for source in ['bw1_player.c', 'bw1_stream_core.c', 'mapping.c', 'bw1_divide.c'] + (['test_bw1_driver.c'] if testing else []):
            obj = out / (source+'.o')
            run(TOOLS/'arm-none-eabi-gcc','-std=c11','-mthumb','-mcpu=arm946e-s','-Os','-mlong-calls',
                '-ffreestanding','-fno-builtin','-fno-jump-tables','-fno-unwind-tables','-fno-asynchronous-unwind-tables',
                '-Wall','-Wextra','-Werror',*(['-DPOKEWEB_STREAM_TEST'] if testing else []),'-I',out,'-c',HERE/source,'-o',obj)
            objects.append(obj)
        run(TOOLS/'arm-none-eabi-as','-mthumb','-march=armv5t',out/'hooks.s','-o',out/'hooks.o')
        elf = out/'player.elf'
        run(TOOLS/'arm-none-eabi-gcc','-mthumb','-mcpu=arm946e-s','-nostdlib','-Wl,-r',*objects,out/'hooks.o','-o',elf)
        unresolved = subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(elf)]).strip()
        if unresolved: raise RuntimeError(unresolved.decode())
        (out/'symbols.yml').write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
        (out/'metadata.yml').write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {manifest["version"]}\n')
        dll = out/f'BgmToggle{game}.dll'
        dll.unlink(missing_ok=True)
        run('java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',dll,
            '--esdb',out/'symbols.yml','--meta',out/'metadata.yml','--generate-relocations','--strip')
        if not dll.exists() or dll.read_bytes()[:4] != b'DLXF':
            raise RuntimeError(f'RPM conversion failed for {game}')
        if not testing:
            shutil.copyfile(dll, REPO/f'src/assets/codeinjection/{dll.name}')
        profile['fileName'] = dll.name
        blob = dll.read_bytes()
        profile['sha256'] = hashlib.sha256(blob).hexdigest()
        header = struct.unpack_from('<I', blob, 8)[0]
        info = header + struct.unpack_from('<I', blob, header + 8)[0]
        profile['residentBytes'] = struct.unpack_from('<I', blob, info + 20)[0] + struct.unpack_from('<I', blob, header + 12)[0]
        print(game, dll.stat().st_size, 'bytes')
    if not testing:
        (REPO/'src/assets/codeinjection/bgmBw1Manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')


if __name__ == '__main__': main()

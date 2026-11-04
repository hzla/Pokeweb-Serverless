"""Build and package US revision-0 BW2 native/nature-aware PWAN modules."""
from pathlib import Path
import os, subprocess, json, re, hashlib, argparse
import ndspy.rom, ndspy.codeCompression
from pwan_build import adapt_battle, adapt_summary, black2
HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORKSPACE = REPO.parent
BUILD = HERE / 'build'
ASSETS = REPO / 'src/assets/codeinjection'
TOOLS = Path(os.environ.get('ARM_TOOLCHAIN_BIN', WORKSPACE / 'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR = Path(os.environ.get('RPM_TOOL_JAR', WORKSPACE / 'pw2-build-work/ctrmap/CTRMap.jar'))
PWAN = Path(os.environ.get('PWAN_SOURCE_ROOT', WORKSPACE.parent / 'White2Upgrade-Original-pokeweb'))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--game', choices=['W2','B2'], action='append')
parser.add_argument('--native-only', action='store_true')
args = parser.parse_args()
def run(*a): subprocess.run([str(x) for x in a], check=True)
def address(a, game):
    if game == 'B2':
        if 0x020191d8 <= a < 0x02100000: return a - 44
        if 0x02199900 <= a < 0x02200000: return a - 64
    return a
def hooks_text(name, game, combined):
    text = (HERE / name).read_text()
    if combined: text = '.set PWNP_COMBINED, 1\n' + text
    if game == 'B2': text = re.sub(r'0x[0-9a-fA-F]{8}', lambda m: f'0x{address(int(m[0],16), game):08x}', text)
    return text
def trampoline(text):
    # Preserve the original stack arguments and all four argument registers.
    return re.sub(r'    b (PWNP_\w+)', lambda m: '    push {r3}\n    ldr r3, =' + m[1] + '\n    mov ip, r3\n    pop {r3}\n    bx ip', text)
for game in args.game or ['W2','B2']:
    rom = ndspy.rom.NintendoDSRom.fromFile(os.environ.get('NATURE_PALETTE_' + game + '_ROM', WORKSPACE / ('cleanwhite2.nds' if game == 'W2' else 'cleanblack2.nds')))
    assert bytes(rom.idCode).decode() == ('IRDO' if game == 'W2' else 'IREO') and rom.version == 0
    arm = bytes(ndspy.codeCompression.decompress(rom.arm9))
    overlays = rom.loadArm9Overlays([167,168,207])
    profile = dict(idCode=bytes(rom.idCode).decode(), version='0.1.0', signatures=[], artifacts={})
    for scene in ['battle','summary']:
      for combined in ([False] if args.native_only else [False,True]):
        mode = 'pwan' if combined else 'native'
        out = BUILD / game / (scene + '-' + mode)
        out.mkdir(parents=True, exist_ok=True)
        hook = out / 'hooks.s'
        hook.write_text(trampoline(hooks_text('hooks.s' if scene == 'battle' else 'summary_hooks.s',game,combined)))
        sources = [HERE / 'palette.cpp', HERE / (scene + '.cpp'), hook]
        if combined:
            original = PWAN / 'src/pwan_animation' / ('w2u_' + scene + '_anim.cpp')
            adapted = (adapt_battle if scene == 'battle' else adapt_summary)(original.read_text())
            if game == 'B2': adapted = black2(adapted, scene)
            candidate = out / ('pwan_' + scene + '.cpp')
            candidate.write_text(adapted)
            sources += [candidate, PWAN / 'src/pwan_animation/w2u_pwan_frame_scratch.cpp', PWAN / 'src/pwan_animation/w2u_pwan_archive.cpp',
                        PWAN / 'src/pwan_animation' / (('b2_' if game == 'B2' else 'w2u_') + scene + '_hooks.s')]
        objects=[]
        for index, source in enumerate(sources):
            obj = out / f'{index}.o'
            if source.suffix == '.cpp':
                run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-mcpu=arm946e-s','-Os','-Wall','-Wextra','-Werror','-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-ffreestanding','-fno-builtin','-fstack-usage','-fvisibility=hidden',
                    *(['-DGAME_BLACK2'] if game == 'B2' else []), *(['-DPWNP_COMBINED'] if combined else []), '-I'+str(HERE), '-I'+str(PWAN/'include'), '-I'+str(PWAN/'include/swan'), '-I'+str(PWAN/'include/NitroKernel'), '-I'+str(PWAN/'src/pwan_animation'), '-c', source, '-o', obj)
            else: run(TOOLS/'arm-none-eabi-as','-mthumb','-mcpu=arm946e-s',source,'-o',obj)
            objects.append(obj)
        elf = out / 'runtime.elf'
        run(TOOLS/'arm-none-eabi-g++','-nostdlib','-Wl,-r',*objects,'-lgcc','-o',elf)
        if not combined:
            fixture=out/'fixture.o'
            run(TOOLS/'arm-none-eabi-g++','-std=c++17','-mthumb','-mcpu=arm946e-s','-Os','-fno-exceptions','-fno-rtti','-c',HERE/'test_fixture.cpp','-o',fixture)
            run(TOOLS/'arm-none-eabi-g++','-nostdlib','-Wl,-Ttext=0x02300000,-e,NatureTestAdd',*objects,fixture,'-lgcc','-o',out/'cpu.elf')
        meta = out / 'metadata.yml'
        meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: 0.1.0\nPWNaturePalettes: 1\nPWNatureScene: {scene}\nPWNatureMode: {mode}\n')
        esdb = out / 'symbols.yml'
        if combined: esdb.write_bytes((PWAN / 'pmc' / ('IRDO.yml' if game == 'W2' else 'IREO.yml')).read_bytes())
        else: esdb.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\n  - ID: 167\n    Name: 167\n    Type: OVERLAY\n  - ID: 168\n    Name: 168\n    Type: OVERLAY\n  - ID: 207\n    Name: 207\n    Type: OVERLAY\nSymbols: []\n')
        name = ('NaturePwan' if combined else 'NaturePalettes') + scene.title() + game + '.dll'
        with (out/'package.log').open('w') as log:
            subprocess.run([str(x) for x in ['java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',ASSETS/name,'--esdb',esdb,'--meta',meta,'--generate-relocations','--strip']],stdout=log,stderr=subprocess.STDOUT,check=True)
        info = out / 'runtime.json'
        run(REPO/'node_modules/.bin/vite-node',HERE/'inspect.ts',ASSETS/name,info)
        artifact = json.loads(info.read_text())
        artifact['fileName'] = name
        artifact['sourceHashes'] = {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
        profile['artifacts'][scene+'-'+mode] = artifact
        for h in artifact['hooks']:
            o=overlays[int(h['module'])]
            at=h['address']-o.ramAddress
            # Complete surrounding stock instruction window, not just patched BL.
            sig=dict(module=h['module'],address=h['address']-4,expectedHex=bytes(o.data[at-4:at+12]).hex())
            if sig not in profile['signatures']: profile['signatures'].append(sig)
        print(name, artifact['memory']['residentAllocationBytes'], 'resident bytes')
    for a in [0x02070ca8,0x02070ecc,0x02070dec,0x02070e54,0x02070e6c,0x02070de0,0x0201cd24,0x0201ef48,0x0201a8d4,0x02019c04,0x0201c178,0x0201b2cc,0x0201c008,0x0201c1b4]:
        a=address(a,game)
        profile['signatures'].append(dict(module='ARM9',address=a,expectedHex=arm[a-rom.arm9RamAddress:a-rom.arm9RamAddress+16].hex()))
    # Pin appearance lookup, stored source pointer/ID, Illusion, and Transform ABIs.
    for a,n in [(0x0219c784,90),(0x0219d1c8,96),(0x0219cc98,96),(0x021bc490,0x110),(0x021bac80,8)]:
        a=address(a,game);o=overlays[167]
        profile['signatures'].append(dict(module='167',address=a,expectedHex=bytes(o.data[a-o.ramAddress:a-o.ramAddress+n]).hex()))
    (ASSETS / ('naturePalettes'+game+'Manifest.json')).write_text(json.dumps(profile,indent=2)+'\n')

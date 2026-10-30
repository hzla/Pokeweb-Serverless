"""Build the count-aware Town Map / Fly module from a pinned public source checkout.

The adapter and generated module are GPL-3.0, like their upstream C and headers.
Only an explicit source checkout and explicit local ROM inputs are read. No network.
Generated sources, objects and diagnostics stay in the ignored build directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import struct
from elftools.elf.elffile import ELFFile
from elftools.elf.relocation import RelocationSection
import ndspy.rom
import ndspy.code
import ndspy.codeCompression
import ndspy.narc

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
TOOLS = Path(os.environ.get('ARM_TOOLCHAIN_BIN', REPO.parent / 'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR = Path(os.environ.get('RPM_TOOL_JAR', REPO.parent / 'pw2-build-work/ctrmap/CTRMap.jar'))
BUILD = HERE / 'build'
SOURCES = ['src/ov144/townmap.c', 'src/ov144/townmap_data.c', 'src/ov298/pokedex_detail_map.c',
           'src/ov303/pokedex_habitat.c', 'src/ov303/pokedex_habitat_graphic.c']
HOOKS = {144: ['TownMap_ProcInit', 'TownMap_ProcMain', 'TownMap_ProcExit', 'TownMapData_GetPlaceByZone'],
         298: ['PokedexDetailMap_Init', 'PokedexDetailMap_Exit', 'PokedexDetailMap_Main', 'PokedexDetailMap_Command'],
         303: ['PokedexHabitat_ProcInit', 'PokedexHabitat_ProcMain', 'PokedexHabitat_ProcEnd']}
SOURCE_COMMIT = '851ad6466bf44f7eb6a0323fd79f355ba77b8977'


def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def prepare_elf(path):
    """Resolve local ARM tail branches and discard checked ARMv4 BX annotations.

    The ARM946 supports BX. R_ARM_V4BX annotates an existing BX, without a
    target or addend to relocate. RPMTool does not understand that annotation.
    All symbol-bearing relocations other than same-section ARM B remain intact.
    """
    data = bytearray(path.read_bytes())
    with path.open('rb') as stream:
        elf = ELFFile(stream)
        for index, section in enumerate(elf.iter_sections()):
            if not isinstance(section, RelocationSection):
                continue
            target = elf.get_section(section['sh_info'])
            symbols = elf.get_section(section['sh_link'])
            retained = []
            for entry in section.iter_relocations():
                at = target['sh_offset'] + entry['r_offset']
                opcode = struct.unpack_from('<I', data, at)[0]
                if entry['r_info_type'] == 40:
                    if opcode & 0x0ffffff0 != 0x012fff10:
                        raise ValueError('R_ARM_V4BX does not annotate BX')
                    continue
                if entry['r_info_type'] == 29:
                    symbol = symbols.get_symbol(entry['r_info_sym'])
                    if symbol['st_shndx'] != section['sh_info'] or opcode & 0x0f000000 != 0x0a000000:
                        raise ValueError('ARM tail branch is not within the same section')
                    displacement = (opcode & 0xffffff) << 2
                    if displacement & 0x2000000:
                        displacement -= 0x4000000
                    displacement += symbol['st_value'] - entry['r_offset']
                    if displacement % 4 or not -0x2000000 <= displacement < 0x2000000:
                        raise ValueError('ARM tail branch cannot be encoded')
                    struct.pack_into('<I', data, at, (opcode & 0xff000000) | ((displacement >> 2) & 0xffffff))
                    continue
                retained.append(struct.pack('<II', entry['r_offset'], entry['r_info']))
            payload = b''.join(retained)
            data[section['sh_offset']:section['sh_offset'] + len(payload)] = payload
            struct.pack_into('<I', data, elf['e_shoff'] + index * elf['e_shentsize'] + 20, len(payload))
    path.write_bytes(data)


def constants(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    value = -1
    lines = ['/* Generated ID declarations; upstream data. */']
    for raw in source.read_text().splitlines():
        item = raw.split('#', 1)[0].strip()
        if not item:
            continue
        name, _, assigned = item.partition('=')
        value = int(assigned.strip(), 0) if assigned else value + 1
        if not name.strip().isidentifier():
            raise ValueError(f'Invalid constant list {source.name}')
        lines.append(f'#define {name.strip()} {value}')
    destination.write_text('\n'.join(lines) + '\n')


def source_symbols(root, profile):
    symbols = {}
    for path in (root / f'config/{profile}/arm9').rglob('symbols.txt'):
        match = re.search(r'overlays/ov(\d+)', str(path))
        module = str(int(match[1])) if match else 'ARM9'
        for line in path.read_text().splitlines():
            entry = re.match(r'(\S+) kind:(function|data)\(([^)]*)\) addr:(0x[0-9a-f]+)', line)
            if entry:
                name, kind, detail, address = entry.groups()
                symbols.setdefault(name, []).append((module, int(address, 16), kind, detail))
    return symbols


def adapt(root, generated, symbols):
    header = root / 'include/app/townmap/townmap_data.h'
    override = generated / 'include/app/townmap/townmap_data.h'
    override.parent.mkdir(parents=True, exist_ok=True)
    override.write_text(header.read_text().replace('#define TOWNMAP_PLACE_COUNT 85', '#define TOWNMAP_PLACE_COUNT 128'))
    (generated / 'include/town_map_config.h').write_text('''#include "types.h"
#include "gfl/overlay.h"
#undef OVERLAY_ID
#define OVERLAY_ID(n) (n)
typedef struct { u32 magic, version, count; u16 zones[128]; } TownMapConfig;
extern const volatile TownMapConfig TownMapRuntimeConfig;
struct GameData;
BOOL TownMap_RuntimeCheckFlag(struct GameData *gameData, u16 flag);
''')
    hook_names = {}
    for module, names in HOOKS.items():
        for name in names:
            candidates = [s for s in symbols[name] if s[0] == str(module)]
            if len(candidates) != 1:
                raise ValueError(f'Ambiguous hook {name}')
            hook_names[name] = f'THUMB_BRANCH_{module}_0x{candidates[0][1]:x}'
    paths = []
    for path in SOURCES:
        text = (root / path).read_text()
        prelude = '#include "town_map_config.h"\n#define TownMap_CheckFlag TownMap_RuntimeCheckFlag\n'
        for name, replacement in hook_names.items():
            prelude += f'#define {name} {replacement}\n'
            # Entry points must be exported for the RPM hook collector.
            text = re.sub(r'\bstatic (?=(?:BOOL|void|u16) ' + re.escape(name) + r'\()', '', text)
        if path.endswith('/townmap.c'):
            text = text.replace('places->count = TOWNMAP_PLACE_COUNT - 1;', 'places->count = TownMapRuntimeConfig.count - 1;')
            text, count = re.subn(r'if \(work->param->zoneId == ZONE_JOIN_AVENUE\) \{\s*work->param->zoneId = ZONE_ROUTE_4;\s*\}', '', text)
            if count != 1:
                raise ValueError('Fly selection adapter no longer matches upstream')
            text = text.replace('place->hidden = FALSE;\n    }\n    switch', 'place->hidden = FALSE;\n    }\n    if (flag == 0xf003) place->hidden = TRUE;\n    switch')
            text = text.replace('if (TownMapPlace_GetParam(place, TOWNMAP_PARAM_TYPE) != 1) {', 'if (TownMapPlace_GetParam(place, TOWNMAP_PARAM_TYPE) != 1 && flag != 0xf003) {')
        # Fixed-capacity work arrays, variable-count iteration. The disk habitat
        # records have a fixed 128-place stride and are generated by the editor.
        text = re.sub(r'([ij]) < TOWNMAP_PLACE_COUNT', r'\1 < TownMapRuntimeConfig.count', text)
        if path.endswith('/pokedex_detail_map.c'):
            text = text.replace('u16 anim;\n    u8 other;\n    u16 otherAnim;', 'u16 anim = 0;\n    u8 other = 0;\n    u16 otherAnim = 0;')
            text, count = re.subn(r'static const u16 sPokedexDetailMapZones\[TOWNMAP_PLACE_COUNT \+ 1\] = \{.*?\};', '', text, flags=re.S)
            if count != 1:
                raise ValueError('Habitat zone order adapter no longer matches upstream')
            text = text.replace('sPokedexDetailMapZones[', 'TownMapRuntimeConfig.zones[')
        if path.endswith('/pokedex_habitat.c'):
            for declaration in ['ClActor *actor;', 'ClActor *pressed;', 'ClActor *other;', 'u32 anim;', 'int anim;']:
                text = text.replace(declaration, declaration[:-1] + ' = 0;')
        if path.endswith('/pokedex_habitat_graphic.c'):
            text = text.replace('ClActUnit_Create(94, 0, HEAPID_POKEDEX_HABITAT)', 'ClActUnit_Create(192, 0, HEAPID_POKEDEX_HABITAT)')
        target = generated / Path(path).name
        target.write_text('/* GPL-3.0: adapted from the pinned pokebw2 public sources. */\n' + prelude + text)
        paths.append(target)
    config = generated / 'config.c'
    config.write_text('#include "town_map_config.h"\n#include "field/townmap_util.h"\nconst volatile TownMapConfig TownMapRuntimeConfig = {0x50414d54, 1, 85, {0}};\nBOOL TownMap_RuntimeCheckFlag(GameData *gameData, u16 flag) { return flag == 0xf003 ? FALSE : TownMap_CheckFlag(gameData, flag); }\n')
    paths.append(config)
    return paths, hook_names


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--black2', required=True, type=Path)
    parser.add_argument('--white2', required=True, type=Path)
    args = parser.parse_args()
    root = args.source.resolve()
    BUILD.mkdir(exist_ok=True)
    generated = BUILD / 'generated'
    (generated / 'include').mkdir(parents=True, exist_ok=True)
    for path in (root / 'generated').glob('*.txt'):
        constants(path, generated / f'include/constants/{path.stem}.h')
    for filename in ['town_map', 'btl_server_flow_title', 'pokedex_habitat']:
        path = generated / f'include/text/system/{filename}.h'
        path.parent.mkdir(parents=True, exist_ok=True)
        names = [line.split('=', 1)[0].strip() for line in (root / f'res/text/system/{filename}.txt').read_text().splitlines() if re.match(r'^\w+\s*=', line)]
        path.write_text('\n'.join(f'#define {name} {i}' for i, name in enumerate(names)) + '\n')
    commit = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()
    if commit != SOURCE_COMMIT:
        raise ValueError('Use the pinned public source revision; new revisions need a separate ABI audit.')
    run('git', '-C', root, 'diff', '--quiet', 'HEAD', '--', 'include', 'lib', 'generated', 'res/text/system', *SOURCES)
    includes = [generated / 'include', root / 'include', root / 'lib/nitro/include', root / 'lib/nnsys/include', root / 'lib/twl/include', root / 'lib/nns/include']
    flags = ['-mthumb', '-mcpu=arm946e-s', '-Os', '-std=gnu11', '-ffreestanding', '-fno-builtin', '-fno-short-enums',
             '-fno-jump-tables', '-fno-unwind-tables', '-fno-asynchronous-unwind-tables', '-DBUGFIX', '-D__thumb=1',
             '-Wall', '-Wextra', '-Wno-unused-parameter', '-Wno-unused-variable', '-Wno-sign-compare', '-Wno-missing-field-initializers', '-Werror']
    for inc in includes:
        flags += ['-I', str(inc)]
    contracts = {}
    for version, profile in [('B2', 'b2_us'), ('W2', 'w2_us')]:
        symbols = source_symbols(root, profile)
        paths, hook_names = adapt(root, generated, symbols)
        objects = []
        for path in paths:
            obj = BUILD / f'{version}-{path.stem}.o'
            run(TOOLS / 'arm-none-eabi-gcc', *flags, '-c', path, '-o', obj)
            objects.append(obj)
        # Reuse the reviewed Fly spawn ABI, with a 128-slot version-2 config.
        fly = (REPO / 'runtime/fly-destinations/fly_destinations.c').read_text()
        fly = fly.replace('destinations[85]', 'destinations[128]').replace('== 1372', '== 2060').replace('1, 85,', '2, 128,').replace('i < 85', 'i < 128')
        path = generated / 'fly.c'; path.write_text(fly)
        obj = BUILD / f'{version}-fly.o'; run(TOOLS / 'arm-none-eabi-gcc', *flags, '-c', path, '-o', obj); objects.append(obj)
        loader, call = (0x020190c9, 0x02178956) if version == 'B2' else (0x020190f5, 0x02178996)
        actor_capacity = 0x021a09ee if version == 'B2' else 0x021a0a2e
        asm = generated / 'fly_hook.s'
        asm.write_text(f'''.syntax unified
.cpu arm946e-s
.thumb
.section .text
.balign 4
.global THUMB_BRANCH_LINK_33_0x{call:x}
.type THUMB_BRANCH_LINK_33_0x{call:x}, %function
.thumb_func
THUMB_BRANCH_LINK_33_0x{call:x}:
    push {{r3, lr}}
    bl Fly_LoadSpawn
    pop {{r3, pc}}
.size THUMB_BRANCH_LINK_33_0x{call:x}, .-THUMB_BRANCH_LINK_33_0x{call:x}
.arm
.balign 4
.global __aeabi_idiv0
.type __aeabi_idiv0, %function
__aeabi_idiv0:
    bx lr
.size __aeabi_idiv0, .-__aeabi_idiv0
.thumb
.balign 4
.global FULL_COPY_298_0x{actor_capacity:x}
.type FULL_COPY_298_0x{actor_capacity:x}, %object
FULL_COPY_298_0x{actor_capacity:x}:
    .hword 0x20c0
.size FULL_COPY_298_0x{actor_capacity:x}, 2
''')
        obj = BUILD / f'{version}-fly-hook.o'; run(TOOLS / 'arm-none-eabi-as', '-mthumb', '-march=armv5t', asm, '-o', obj); objects.append(obj)
        libgcc = subprocess.check_output([str(TOOLS / 'arm-none-eabi-gcc'), '-mthumb', '-mcpu=arm946e-s', '-print-libgcc-file-name'], text=True).strip()
        linked = BUILD / f'TownMap{version}.elf'
        run(TOOLS / 'arm-none-eabi-ld', '-r', *objects, libgcc, '-o', linked)
        prepare_elf(linked)
        # Provider binding and packaging are completed after inspecting the actual
        # compiler's undefined symbols, never inferred from function spellings.
        undefined = set()
        for obj in [linked]:
            output = subprocess.check_output([str(TOOLS / 'arm-none-eabi-nm'), '-u', str(obj)], text=True)
            undefined.update(line.split()[-1] for line in output.splitlines() if line.strip())
        defined = set()
        for obj in [linked]:
            output = subprocess.check_output([str(TOOLS / 'arm-none-eabi-nm'), '--defined-only', str(obj)], text=True)
            defined.update(line.split()[-1] for line in output.splitlines() if line.strip())
        imports = sorted(undefined - defined)
        (BUILD / f'{version}-imports.json').write_text(json.dumps({name: symbols.get(name) for name in imports}, indent=2))
        bound = {}
        for name in imports:
            if name == 'LoadZoneSpawnInfoCheckRail':
                bound[name] = ('ARM9', loader & ~1, 'function', 'thumb,size=0x60')
            else:
                choices = symbols.get(name, [])
                if len(choices) != 1:
                    raise ValueError(f'Missing/ambiguous native provider {name}')
                bound[name] = choices[0]
        modules = ['ARM9'] + sorted(set(s[0] for s in bound.values()) | {'33', '144', '298', '303'}, key=lambda x: (x != 'ARM9', x))
        modules = list(dict.fromkeys(modules))
        segments = 'Segments:\n' + ''.join(f'  - ID: {i}\n    Name: {module}\n    Type: {"EXECUTABLE" if module == "ARM9" else "OVERLAY"}\n' for i, module in enumerate(modules))
        esdb = BUILD / f'symbols_{version}.yml'
        esdb.write_text(segments + 'Symbols:\n' + ''.join(f'  - Name: {name}\n    Segment: {modules.index(s[0])}\n    Address: 0x{s[1] | (1 if s[2] == "function" and "thumb" in s[3] else 0):x}\n' for name, s in bound.items()))
        meta = BUILD / f'metadata_{version}.yml'
        meta.write_text(f'PMCGameID: {version}\nPMCModulePriority: 4\nPMCVersion: 2.0.0\n' + segments)
        output = BUILD / f'TownMap{version}.dll'
        output.unlink(missing_ok=True)
        run('java', '-cp', JAR, 'rpm.cli.RPMTool', '-i', linked, '--fourcc', 'DLXF', '-o', output,
            '--esdb', esdb, '--meta', meta, '--generate-relocations')
        dump = subprocess.check_output(['java', '-cp', str(JAR), 'rpm.cli.RPMDump', '--fourcc', 'DLXF', '-i', str(output)], text=True)
        (BUILD / f'{version}.dump.txt').write_text(dump)
        if 'Import symbol' in dump:
            raise ValueError('Packaged module has unresolved imports')
        shutil.copyfile(output, REPO / f'src/assets/codeinjection/TownMap{version}.dll')
        source_rom = args.black2 if version == 'B2' else args.white2
        rom = ndspy.rom.NintendoDSRom(source_rom.read_bytes())
        if rom.idCode != (b'IREO' if version == 'B2' else b'IRDO') or rom.version != 0:
            raise ValueError('Native contract needs the matching US revision-0 ROM')
        overlays = ndspy.code.loadOverlayTable(rom.arm9OverlayTable, lambda _id, fid: rom.files[fid])
        arm9 = ndspy.codeCompression.decompress(rom.arm9)
        ranges = []
        for module in [144, 298, 303, 308]:
            data = overlays[module].data
            ranges.append({'module': str(module), 'address': overlays[module].ramAddress, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        for name, (module, address, kind, detail) in bound.items():
            length = re.search(r'size=(0x[0-9a-f]+)', detail)
            if kind != 'function' or not length:
                continue
            size = int(length[1], 16)
            data, base = (arm9, rom.arm9RamAddress) if module == 'ARM9' else (overlays[int(module)].data, overlays[int(module)].ramAddress)
            offset = address - base
            if offset < 0 or offset + size > len(data):
                raise ValueError(f'Provider outside native module: {name}')
            if module not in ['144', '298', '303', '308']:
                record = {'module': module, 'address': address, 'size': size, 'sha256': hashlib.sha256(data[offset:offset + size]).hexdigest()}
                if name in ['GFL_OvlLoad', 'GFL_OvlUnload']:
                    record['pmcPrefixHex'] = data[offset:offset + 16].hex()
                ranges.append(record)
        hooks = [{'module': str(module), 'address': symbols[name][0][1], 'type': 'THUMB_BRANCH'} for module, names in HOOKS.items() for name in names]
        hooks.append({'module': '33', 'address': call, 'type': 'THUMB_BRANCH_LINK'})
        if struct.unpack_from('<H', overlays[298].data, actor_capacity - overlays[298].ramAddress)[0] != 0x2060:
            raise ValueError('Native actor allocation no longer has the audited 96-slot capacity instruction')
        hooks.append({'module': '298', 'address': actor_capacity, 'type': 'FULL_COPY', 'size': 2})
        # The retail habitat map's data-order table is distinct from record order.
        zone_address = symbols['sPokedexDetailMapZones'][0][1]
        data = overlays[298].data; offset = zone_address - overlays[298].ramAddress
        zones = list(struct.unpack_from('<85H', data, offset))
        stock_data = ndspy.narc.NARC(rom.getFileByName('a/0/8/5')).files[0]
        records = [struct.unpack_from('<H', stock_data, i * 54)[0] for i in range(85)]
        contracts[version] = {'ranges': ranges, 'hooks': hooks, 'habitatZones': zones, 'stockRecordZones': records, 'sourceCommit': commit}
        print(f'{version}: {len(objects)} compiled objects; {len(imports)} bound native providers; {output.stat().st_size} byte module')
    (REPO / 'src/assets/data/bw2TownMapNativeContract.json').write_text(json.dumps(contracts, indent=2) + '\n')
    shutil.copyfile(root / 'LICENSE', HERE / 'LICENSE')
    (BUILD / 'source.json').write_text(json.dumps({'commit': commit, 'files': {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in SOURCES}}, indent=2))


if __name__ == '__main__':
    main()

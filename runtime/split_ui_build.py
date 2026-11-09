"""Package overlay-12 callbacks separately from unloadable UI code."""
import hashlib, re, struct, subprocess
from elftools.elf.elffile import ELFFile

def package_split(here, build, tools, jar, assets, game, stem, source, extra, main_define, field_define, version):
    out = build / (stem + '-split')
    out.mkdir(parents=True, exist_ok=True)
    def run(*args): subprocess.run([str(v) for v in args], check=True)
    flags = ['-std=c++17','-mthumb','-march=armv5t','-mlong-calls','-Os','-Wall','-Wextra','-Werror','-fno-jump-tables','-fvisibility=hidden','-fno-exceptions','-fno-rtti','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-ffreestanding','-fno-builtin','-ffunction-sections','-fdata-sections',f'-DGAME_{game}','-I',build]
    asm = (build / (stem + '.s')).read_text()
    blocks = re.findall(r'\.balign 4\n\.global (?:THUMB_BRANCH_LINK|FULL_COPY)_.*?\.size [^\n]+\n', asm, re.S)
    assert blocks and ''.join(blocks) == asm[asm.index('.balign 4'):], 'Unrecognized hook assembly'
    result = {}
    for part, define in [('ui', main_define), ('field', field_define)]:
        obj = out / (part + '.o')
        run(tools/'arm-none-eabi-g++',*flags,'-D'+define,'-c',here/source,'-o',obj)
        chosen = [b for b in blocks if ('_12_0x' in b.splitlines()[1]) == (part == 'field')]
        hooks = out / (part + '.s'); hooks.write_text('.syntax unified\n.thumb\n'+''.join(chosen))
        hook_obj = out / (part + '-hooks.o')
        run(tools/'arm-none-eabi-as','-mthumb','-march=armv5t',hooks,'-o',hook_obj)
        objects = [obj,hook_obj]
        for i,item in enumerate(extra):
            additional = out / f'{part}-extra-{i}.o'
            run(tools/'arm-none-eabi-g++',*flags,'-c',item,'-o',additional)
            objects.append(additional)
        roots = re.findall(r'\.global (\S+)', ''.join(chosen))
        exports = []
        if part == 'field':
            with obj.open('rb') as handle:
                for sym in ELFFile(handle).get_section_by_name('.symtab').iter_symbols():
                    if sym['st_shndx'] != 'SHN_UNDEF' and sym['st_info']['bind']=='STB_GLOBAL' and sym['st_other']['visibility']=='STV_DEFAULT':
                        exports.append(sym.name)
            roots += exports
        elf = out / (part + '.elf')
        run(tools/'arm-none-eabi-g++','-nostdlib','-Wl,-r,--gc-sections',*['-Wl,--undefined='+s for s in roots],*objects,'-o',elf)
        # RPMTool expects consolidated ELF sections. GC runs first so it can
        # discard individual functions, then merge the surviving sections.
        gc = out / (part + '-gc.elf'); elf.replace(gc)
        layout = out / 'sections.ld'
        layout.write_text('SECTIONS { .text 0 : { *(.text*) } .rodata 0 : { *(.rodata*) } .data 0 : { *(.data*) } .bss 0 : { *(.bss*) *(COMMON) } }\n')
        run(tools/'arm-none-eabi-ld','-r','-T',layout,gc,'-o',elf)
        # RPM cannot encode a nonzero addend on an unresolved data import.
        # A shared structure must be obtained through a getter, not &import.x.
        with elf.open('rb') as handle:
            image = ELFFile(handle)
            for section in image.iter_sections():
                if section['sh_type'] != 'SHT_REL': continue
                symbols = image.get_section(section['sh_link'])
                data = image.get_section(section['sh_info']).data()
                for relocation in section.iter_relocations():
                    symbol = symbols.get_symbol(relocation['r_info_sym'])
                    if relocation['r_info_type'] == 2 and symbol['st_shndx'] == 'SHN_UNDEF':
                        assert struct.unpack_from('<I', data, relocation['r_offset'])[0] == 0, f'Unsupported import addend: {symbol.name}'
        meta = out / (part + '.yml')
        meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: {3 if part=="field" else 4}\nPMCVersion: {version}\nPokewebUiPart: {part}\n')
        esdb = out / 'symbols.yml'; esdb.write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
        name = stem + '.dll' if part == 'ui' else stem.replace(game, 'Field'+game) + '.dll'
        dll = assets / name
        run('java','-cp',jar,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',dll,'--esdb',esdb,'--meta',meta,'--generate-relocations','--strip')
        blob = dll.read_bytes();h=struct.unpack_from('<I',blob,8)[0];info=h+struct.unpack_from('<I',blob,h+8)[0];start,size=struct.unpack_from('<II',blob,info+16)
        fnv=0x811c9dc5
        for b in blob[start:start+size]:fnv=((fnv^b)*0x1000193)&0xffffffff
        result[part] = dict(fileName=name,sha256=hashlib.sha256(blob).hexdigest(),codeFingerprint=f'{fnv:08x}',bssSize=struct.unpack_from('<I',blob,h+12)[0],exports=exports)
    return result

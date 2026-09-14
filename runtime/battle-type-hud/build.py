"""Build both release and symbol-bearing debug PMC DLLs, without bundling."""
from pathlib import Path
import hashlib, json, os, subprocess
HERE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get("BTH_WORKSPACE_ROOT",HERE.parents[2] if HERE.parent.name=="runtime" else HERE.parents[1]))
TOOLS=Path(os.environ.get('BTH_TOOLCHAIN_BIN',ROOT/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('BTH_CTRMAP_JAR',ROOT/'White2Upgrade/CTRMap.jar'))
from rpm_read import read_rpm
def run(*args): subprocess.run([str(a) for a in args],check=True)
def main():
    build=HERE/'build';build.mkdir(exist_ok=True)
    run('javac','-cp',JAR,'-d',build,HERE/'Compact.java')
    reports={}
    for game,module,source,state_size,hook_count in [(g,*m) for g in ('B2','W2') for m in (('TypeIcons','battle_type_hud.cpp',364,17),('MoveEffectiveness','move_effectiveness.cpp',20,5))]:
        assert (build/f'addresses-{game}.h').exists(), 'Run configure.py first'
        name=module+game
        obj=build/(name+'.o');elf=build/(name+'.elf')
        run(TOOLS/'arm-none-eabi-g++','-std=c++14','-mthumb','-march=armv5t',
            '-mno-thumb-interwork','-mno-long-calls','-Os','-Wall','-Wextra','-Werror',
            '-ffreestanding','-fno-jump-tables','-fvisibility=hidden','-fno-exceptions','-fno-rtti','-fstack-usage',
            '-fno-unwind-tables','-fno-asynchronous-unwind-tables','-DGAME_'+game,
            '-c',HERE/source,'-o',obj)
        run(TOOLS/'arm-none-eabi-ld','-r',obj,'-o',elf)
        assert not subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(elf)]).strip()
        # Load before ordinary priority-4 battle patches. This does not enlarge
        # the PMC heap; the unoptimized Cascade build has insufficient capacity.
        version='0.3.9' if module=='TypeIcons' else '0.4.0'
        meta=build/(name+'.yml');meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 3\nPMCVersion: {version}\n')
        for debug in (True,False):
            dll=build/(name+('.debug' if debug else '')+'.dll')
            args=['java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',dll,
                  '--esdb',HERE/'esdb.yml','--meta',meta,'--generate-relocations']
            if not debug: args.append('--strip')
            run(*args)
            if not debug:run('java','-cp',str(JAR)+os.pathsep+str(build),'Compact',dll)
            rpm=read_rpm(dll.read_bytes())
            assert rpm['bss']==state_size
            external=[r for r in rpm['relocations'] if r['module']!='base']
            assert len(external)==hook_count and all(r['module']=='168' for r in external)
            assert all(not s['attributes']&2 for s in rpm['symbols'])
            dll.with_suffix('.dump.txt').write_bytes(subprocess.check_output(
                ['java','-cp',str(JAR),'rpm.cli.RPMDump','--fourcc','DLXF','-i',str(dll)]))
            reports[dll.name]=dict(file_bytes=dll.stat().st_size,sha256=hashlib.sha256(dll.read_bytes()).hexdigest(),code_and_constants_bytes=len(rpm['code']),
                fixed_state_bytes=rpm['bss'],expanded_rpm_bytes=rpm['expanded_size'],
                retained_rpm_after_internal_fix_bytes=rpm['internal_fixed_size'],
                rpm_metadata_overhead_bytes=rpm['expanded_size']-len(rpm['code'])-rpm['bss'],
                icon_constants_bytes=208 if module=='TypeIcons' else 0,external_hook_count=len(external),external_modules=['168'],
                pmc_module_state_bytes=36,pmc_overlay_list_bytes=8,pmc_extern_list_bytes=8,
                pmc_allocator_headers_bytes=64,pmc_allocator_alignment_padding_bytes=4,
                estimated_total_pmc_heap_bytes=rpm['expanded_size']+120,
                estimated_retained_pmc_heap_bytes=rpm['internal_fixed_size']+120,
                battle_heap_allocations=0,added_sprites=0,added_palette_banks=0,added_graphics_vram_bytes=256 if module=='TypeIcons' else 0,
                added_graphics_vram_max_bytes=512 if module=='TypeIcons' else 0,
                added_hardware_oam_pieces_per_regular_player=1 if module=='TypeIcons' else 0,
                existing_cell_resource_growth_bytes=8 if module=='TypeIcons' else 0)
        (build/(name+'.disassembly.txt')).write_bytes(subprocess.check_output(
            [str(TOOLS/'arm-none-eabi-objdump'),'-dr',str(elf)]))
    (build/'memory-report.json').write_text(json.dumps(reports,indent=2)+'\n')
    print(json.dumps(reports,indent=2))
if __name__=='__main__': main()

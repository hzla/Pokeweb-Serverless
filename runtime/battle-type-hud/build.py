"""Build both release and symbol-bearing debug PMC DLLs, without bundling."""
from pathlib import Path
import argparse
import hashlib, json, os, subprocess
HERE=Path(__file__).resolve().parent
ROOT=Path(os.environ.get("BTH_WORKSPACE_ROOT",HERE.parents[2] if HERE.parent.name=="runtime" else HERE.parents[1]))
TOOLS=Path(os.environ.get('BTH_TOOLCHAIN_BIN',ROOT/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('BTH_CTRMAP_JAR',ROOT/'White2Upgrade/CTRMap.jar'))
from rpm_read import read_rpm
def run(*args): subprocess.run([str(a) for a in args],check=True)
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bw1',action='store_true',help='Build BW1 Type Icons; bundling checks the DS acceptance ledger.')
    parser.add_argument('--bw1-moves',action='store_true',help='Build BW1 Move Effectiveness; bundling checks the DS acceptance ledger.')
    parser.add_argument('--bw1-moves-trace',action='store_true',help='Build private target-selection diagnostic DLLs; never bundle.')
    options=parser.parse_args()
    build=HERE/'build';build.mkdir(exist_ok=True)
    run('javac','-cp',JAR,'-d',build,HERE/'Compact.java')
    reports={}
    modules=(
        ('TypeIcons','battle_type_hud.cpp',364,17,None,'0.3.18'),
        ('TypeIconsCircular','battle_type_hud.cpp',364,17,'ICON_VARIANT_CIRCULAR','0.3.18-circular'),
        ('TypeIconsSolid','battle_type_hud.cpp',364,17,'ICON_VARIANT_SOLID','0.3.24-solid'),
        ('MoveEffectiveness','move_effectiveness.cpp',20,5,None,'0.4.1'),
    )
    if options.bw1:
        modules=tuple((module,'battle_type_hud_bw1.cpp',796,hooks,variant,
                       '0.1.3-bw1'+('-circular' if variant=='ICON_VARIANT_CIRCULAR' else '-solid' if variant else '')+'-candidate')
                      for module,_,_,hooks,variant,_ in modules if module.startswith('TypeIcons'))
    if options.bw1_moves or options.bw1_moves_trace:
        assert not options.bw1, 'Select one BW1 component at a time.'
        modules=(('MoveEffectivenessTrace' if options.bw1_moves_trace else 'MoveEffectiveness',
                  'move_effectiveness.cpp',56 if options.bw1_moves_trace else 28,5,
                  'BW1_MOVE_TRACE' if options.bw1_moves_trace else None,
                  '0.1.1-bw1-moves-trace' if options.bw1_moves_trace else '0.1.1-bw1-moves-candidate'),)
    bw1=options.bw1 or options.bw1_moves or options.bw1_moves_trace
    games=('B','W') if bw1 else ('B2','W2')
    overlay='94' if bw1 else '168'
    esdb=build/'esdb-bw1.yml' if bw1 else HERE/'esdb.yml'
    if bw1:esdb.write_text('Segments:\n  - ID: 0\n    Name: "94"\n    Type: OVERLAY\nSymbols: []\n')
    for game,module,source,state_size,hook_count,variant_define,version in [(g,*m) for g in games for m in modules]:
        assert (build/f'addresses-{game}.h').exists(), 'Run configure.py first'
        name=module+game
        obj=build/(name+'.o');elf=build/(name+'.elf')
        compile_args=[TOOLS/'arm-none-eabi-g++','-std=c++14','-mthumb','-march=armv5t',
            '-mno-thumb-interwork','-mno-long-calls','-Os','-Wall','-Wextra','-Werror',
            '-ffreestanding','-fno-builtin','-fno-jump-tables','-fvisibility=hidden','-fno-exceptions','-fno-rtti','-fstack-usage',
            '-fno-unwind-tables','-fno-asynchronous-unwind-tables','-DGAME_'+game,
            '-c',HERE/source,'-o',obj]
        if variant_define: compile_args.insert(-4,'-D'+variant_define)
        run(*compile_args)
        run(TOOLS/'arm-none-eabi-ld','-r',obj,'-o',elf)
        assert not subprocess.check_output([str(TOOLS/'arm-none-eabi-nm'),'-u',str(elf)]).strip()
        # Load before ordinary priority-4 battle patches. This does not enlarge
        # the PMC heap; the unoptimized Cascade build has insufficient capacity.
        meta=build/(name+'.yml');meta.write_text(f'PMCGameID: {game}\nPMCModulePriority: 3\nPMCVersion: {version}\n')
        for debug in (True,False):
            dll=build/(name+('.debug' if debug else '')+'.dll')
            args=['java','-cp',JAR,'rpm.cli.RPMTool','-i',elf,'--fourcc','DLXF','-o',dll,
                  '--esdb',esdb,'--meta',meta,'--generate-relocations']
            if not debug: args.append('--strip')
            run(*args)
            if not debug:run('java','-cp',str(JAR)+os.pathsep+str(build),'Compact',dll)
            rpm=read_rpm(dll.read_bytes())
            assert rpm['bss']==state_size
            external=[r for r in rpm['relocations'] if r['module']!='base']
            assert len(external)==hook_count and all(r['module']==overlay for r in external)
            assert all(not s['attributes']&2 for s in rpm['symbols'])
            dll.with_suffix('.dump.txt').write_bytes(subprocess.check_output(
                ['java','-cp',str(JAR),'rpm.cli.RPMDump','--fourcc','DLXF','-i',str(dll)]))
            reports[dll.name]=dict(file_bytes=dll.stat().st_size,sha256=hashlib.sha256(dll.read_bytes()).hexdigest(),code_and_constants_bytes=len(rpm['code']),
                fixed_state_bytes=rpm['bss'],expanded_rpm_bytes=rpm['expanded_size'],
                retained_rpm_after_internal_fix_bytes=rpm['internal_fixed_size'],
                rpm_metadata_overhead_bytes=rpm['expanded_size']-len(rpm['code'])-rpm['bss'],
                icon_constants_bytes=324 if module=='TypeIconsSolid' else 476 if module.startswith('TypeIcons') else 0,
                caught_marker_constants_bytes=0,
                external_hook_count=len(external),external_modules=[overlay],
                pmc_module_state_bytes=36,pmc_overlay_list_bytes=8,pmc_extern_list_bytes=8,
                pmc_allocator_headers_bytes=64,pmc_allocator_alignment_padding_bytes=4,
                estimated_total_pmc_heap_bytes=rpm['expanded_size']+120,
                estimated_retained_pmc_heap_bytes=rpm['internal_fixed_size']+120,
                battle_heap_allocations=0,added_sprites=0,added_palette_banks=0,added_graphics_vram_bytes=256 if module.startswith('TypeIcons') else 0,
                added_graphics_vram_max_bytes=512 if module.startswith('TypeIcons') else 0,
                added_hardware_oam_pieces_per_regular_player=1 if module.startswith('TypeIcons') else 0,
                existing_cell_resource_growth_bytes=8 if module.startswith('TypeIcons') else 0)
            if options.bw1:
                reports[dll.name].update(added_graphics_vram_bytes=256,added_graphics_vram_max_bytes=1536,
                    icon_constants_bytes=72 if module=='TypeIconsSolid' else 476,
                    added_palette_banks=6,added_sprites=0,battle_heap_allocations=0,
                    added_hardware_oam_pieces_per_panel=2,added_hardware_oam_pieces_max=12,
                    existing_cell_resource_growth_bytes=16,existing_cell_resource_growth_max_bytes=96,
                    added_hardware_oam_pieces_per_regular_player=2,
                    ds_gameplay_accepted=False,dsi_gameplay_accepted=False)
            elif options.bw1_moves:
                reports[dll.name].update(ds_gameplay_accepted=False,dsi_gameplay_accepted=False)
        (build/(name+'.disassembly.txt')).write_bytes(subprocess.check_output(
            [str(TOOLS/'arm-none-eabi-objdump'),'-dr',str(elf)]))
    report_name='memory-report-bw1-moves-trace.json' if options.bw1_moves_trace else 'memory-report-bw1-moves.json' if options.bw1_moves else 'memory-report-bw1.json' if options.bw1 else 'memory-report.json'
    (build/report_name).write_text(json.dumps(reports,indent=2)+'\n')
    print(json.dumps(reports,indent=2))
if __name__=='__main__': main()

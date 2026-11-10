"""Build the position-relocatable rule template; no ROM input or remote services."""
from pathlib import Path
import json,os,subprocess,sys
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
WORKSPACE=ROOT.parent
TOOLS=Path(os.environ.get('ARM_TOOLCHAIN_BIN',WORKSPACE/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('RPM_TOOL_JAR',WORKSPACE/'pw2-build-work/ctrmap/CTRMap.jar'))
BUILD=HERE/'build';BUILD.mkdir(exist_ok=True)
def run(*args):subprocess.run([str(arg) for arg in args],check=True)
if len(sys.argv)==1:
    # Released bundles are verification inputs, not current build outputs.
    run(sys.executable,HERE/'build.py','--weather-moves-only')
    raise SystemExit(0)
run(sys.executable,HERE/'generate_move_classes.py')

(BUILD/'rules-meta.yml').write_text('PMCVersion: ability-rules-1\nPMCModulePriority: 4\n')
(BUILD/'rules-symbols.yml').write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
variants=[('',[],'abilityRuleRuntime.json'),('-priority',['-DABILITY_PRIORITY'],'abilityRuleRuntimePriority.json'),('-library',['-DABILITY_PRIORITY','-DABILITY_LIBRARY'],'abilityRuleRuntimeLibrary.json'),('-recipes',['-DABILITY_PRIORITY','-DABILITY_LIBRARY','-DABILITY_RECIPES'],'abilityRuleRuntimeRecipes.json'),('-client',['-DABILITY_PRIORITY','-DABILITY_LIBRARY','-DABILITY_RECIPES','-DABILITY_CLIENT_TRAPS'],'abilityRuleRuntimeClient.json')]
# Retain every earlier template for exact validation of existing exported ROMs.
variants += [(suffix+'-grouped',defines+['-DABILITY_POPUP_GROUPS'],asset.replace('.json','Grouped.json')) for suffix,defines,asset in variants]
variants += [(suffix+'-weather',defines+['-DABILITY_WEATHER_GUARD'],asset.replace('Grouped.json','Weather.json')) for suffix,defines,asset in variants if suffix in ['-recipes-grouped','-client-grouped']]
variants += [(suffix+'-scoped',defines+['-DABILITY_SCOPED'],asset.replace('Weather.json','Scoped.json')) for suffix,defines,asset in variants if suffix in ['-recipes-grouped-weather','-client-grouped-weather']]
variants += [(suffix+'-actions',defines+['-DABILITY_ACTIONS'],asset.replace('Scoped.json','Actions.json')) for suffix,defines,asset in variants if suffix in ['-recipes-grouped-weather-scoped','-client-grouped-weather-scoped']]
bundle_path=ROOT/'src/assets/data/abilityRuleRuntimeOptimized.json'
optimized=json.loads(bundle_path.read_text())if bundle_path.exists()else{}
classes_path=ROOT/'src/assets/data/abilityRuleRuntimeMoveClasses.json'
classes=json.loads(classes_path.read_text())if classes_path.exists()else{}
messages_path=ROOT/'src/assets/data/abilityRuleRuntimeMessages.json'
messages=json.loads(messages_path.read_text())if messages_path.exists()else{}
custom_path=ROOT/'src/assets/data/abilityRuleRuntimeCustomFlags.json'
custom=json.loads(custom_path.read_text())if custom_path.exists()else{}
results_path=ROOT/'src/assets/data/abilityRuleRuntimeActionResults.json'
results=json.loads(results_path.read_text())if results_path.exists()else{}
source_path=ROOT/'src/assets/data/abilityRuleRuntimeStatSource.json'
source={}
compact_path=ROOT/'src/assets/data/abilityRuleRuntimeCompact.json'
compact={}
weather_moves='--weather-moves-only' in sys.argv
protect='--protect-only' in sys.argv or weather_moves
strikes='--strikes-only' in sys.argv or protect
environment='--environment-only' in sys.argv or strikes
native_flags='--native-flags-only' in sys.argv or environment
native_flags_path=ROOT/('src/assets/data/abilityRuleRuntimeWeatherMoves.json' if weather_moves else 'src/assets/data/abilityRuleRuntimeProtect.json' if protect else 'src/assets/data/abilityRuleRuntimeStrikes.json' if strikes else 'src/assets/data/abilityRuleRuntimeEnvironment.json' if environment else 'src/assets/data/abilityRuleRuntimeNativeFlags.json')
compact_mode='--compact-only' in sys.argv or native_flags
variants=[(suffix,defines,asset,False)for suffix,defines,asset in variants]+[(suffix+'-optimized',defines+['-DABILITY_FILTER_EVENTS'],asset,True)for suffix,defines,asset in variants]
variants=[(suffix,defines,asset,fast,slots) for suffix,defines,asset,fast in variants for slots in ([4,8,16] if compact_mode else [16])]
for suffix,defines,asset,fast,slots in variants:
    stat_source="--stat-source-only" in sys.argv or compact_mode
    action_results="--action-results-only" in sys.argv or stat_source
    custom_flags="--custom-flags-only" in sys.argv or action_results
    custom_messages="--messages-only" in sys.argv or custom_flags
    custom_classes="--move-classes-only" in sys.argv or custom_messages
    if custom_classes:
        if not fast or '-DABILITY_POPUP_GROUPS' not in defines: continue
        suffix+='-classes';defines=defines+['-DABILITY_MOVE_CLASSES','-DABILITY_POWER_RATIO','-DABILITY_STAT_POPUPS']
        if custom_messages: suffix+='-messages';defines+=['-DABILITY_BATTLE_MESSAGES']
        if custom_flags: suffix+='-custom';defines+=['-DABILITY_CUSTOM_FLAGS']
        if action_results: suffix+='-results';defines+=['-DABILITY_ACTION_RESULTS']
        if stat_source: suffix+='-source';defines+=['-DABILITY_STAT_SOURCE']
        if compact_mode: suffix+=f'-compact-{slots}';defines+=['-DABILITY_COMPACT',f'-DABILITY_EFFECT_SLOTS={slots}']
        if native_flags: suffix+='-native-flags';defines+=['-DABILITY_NATIVE_MOVE_FLAGS']
        if environment: suffix+='-environment';defines+=['-DABILITY_ENVIRONMENT']
        if strikes: suffix+='-strikes';defines+=['-DABILITY_STRIKES']
        if protect: suffix+='-protect';defines+=['-DABILITY_PROTECT']
        if protect and os.environ.get('ABILITY_PROTECT_TEST')=='1': defines+=['-DABILITY_PROTECT_TEST']
        if weather_moves: suffix+='-weather-moves';defines+=['-DABILITY_WEATHER_MOVES']
        if weather_moves and os.environ.get('ABILITY_WEATHER_TEST')=='1': defines+=['-DABILITY_WEATHER_TEST']
    if "--optimized-only" in sys.argv and not fast: continue
    if "--legacy-only" in sys.argv and fast: continue
    if "--actions-only" in sys.argv and "-DABILITY_ACTIONS" not in defines: continue
    if "--scoped-only" in sys.argv and "-DABILITY_SCOPED" not in defines: continue
    obj=BUILD/f'rules{suffix}.o'
    run(TOOLS/'arm-none-eabi-gcc','-std=c11','-mthumb','-mcpu=arm946e-s','-Os','-Wall','-Wextra','-Werror','-Wno-parentheses',
        '-ffreestanding','-fno-builtin','-fno-jump-tables','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-fvisibility=hidden',*defines,'-c',HERE/'rules.c','-o',obj)
    dll=BUILD/f'rules{suffix}-template.dll';dll.unlink(missing_ok=True)
    run('java','-cp',JAR,'rpm.cli.RPMTool','-i',obj,'--fourcc','DLXF','-o',dll,'--esdb',BUILD/'rules-symbols.yml','--meta',BUILD/'rules-meta.yml','--generate-relocations')
    destination=BUILD/('optimized-'+asset)if fast else ROOT/'src/assets/data'/asset
    run(ROOT/'node_modules/.bin/vite-node',HERE/'describe.ts',dll,destination)
    if compact_mode: compact.setdefault(asset,{})[str(slots)]=json.loads(destination.read_text())
    elif stat_source: source[asset]=json.loads(destination.read_text())
    elif action_results: results[asset]=json.loads(destination.read_text())
    elif custom_flags: custom[asset]=json.loads(destination.read_text())
    elif custom_messages: messages[asset]=json.loads(destination.read_text())
    elif custom_classes: classes[asset]=json.loads(destination.read_text())
    elif fast: optimized[asset]=json.loads(destination.read_text())
if compact_mode:
    (native_flags_path if native_flags else compact_path).write_text(json.dumps(compact,separators=(',',':'))+'\n')
elif "--stat-source-only" in sys.argv:
    source_path.write_text(json.dumps(source,separators=(',',':'))+'\n')
elif "--action-results-only" in sys.argv:
    results_path.write_text(json.dumps(results,separators=(',',':'))+'\n')
elif "--custom-flags-only" in sys.argv:
    custom_path.write_text(json.dumps(custom,separators=(',',':'))+'\n')
elif "--messages-only" in sys.argv:
    messages_path.write_text(json.dumps(messages,separators=(',',':'))+'\n')
elif "--move-classes-only" in sys.argv:
    classes_path.write_text(json.dumps(classes,separators=(',',':'))+'\n')
elif "--legacy-only" not in sys.argv:
    bundle_path.write_text(json.dumps(optimized,separators=(',',':'))+'\n')

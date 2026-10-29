"""Build the position-relocatable rule template; no ROM input or remote services."""
from pathlib import Path
import os,subprocess,sys
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
WORKSPACE=ROOT.parent
TOOLS=Path(os.environ.get('ARM_TOOLCHAIN_BIN',WORKSPACE/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('RPM_TOOL_JAR',WORKSPACE/'pw2-build-work/ctrmap/CTRMap.jar'))
BUILD=HERE/'build';BUILD.mkdir(exist_ok=True)
def run(*args):subprocess.run([str(arg) for arg in args],check=True)
run(sys.executable,HERE/'generate_move_classes.py')

(BUILD/'rules-meta.yml').write_text('PMCVersion: ability-rules-1\nPMCModulePriority: 4\n')
(BUILD/'rules-symbols.yml').write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
variants=[('',[],'abilityRuleRuntime.json'),('-priority',['-DABILITY_PRIORITY'],'abilityRuleRuntimePriority.json'),('-library',['-DABILITY_PRIORITY','-DABILITY_LIBRARY'],'abilityRuleRuntimeLibrary.json'),('-recipes',['-DABILITY_PRIORITY','-DABILITY_LIBRARY','-DABILITY_RECIPES'],'abilityRuleRuntimeRecipes.json'),('-client',['-DABILITY_PRIORITY','-DABILITY_LIBRARY','-DABILITY_RECIPES','-DABILITY_CLIENT_TRAPS'],'abilityRuleRuntimeClient.json')]
# Retain every earlier template for exact validation of existing exported ROMs.
variants += [(suffix+'-grouped',defines+['-DABILITY_POPUP_GROUPS'],asset.replace('.json','Grouped.json')) for suffix,defines,asset in variants]
variants += [(suffix+'-weather',defines+['-DABILITY_WEATHER_GUARD'],asset.replace('Grouped.json','Weather.json')) for suffix,defines,asset in variants if suffix in ['-recipes-grouped','-client-grouped']]
for suffix,defines,asset in variants:
    obj=BUILD/f'rules{suffix}.o'
    run(TOOLS/'arm-none-eabi-gcc','-std=c11','-mthumb','-mcpu=arm946e-s','-Os','-Wall','-Wextra','-Werror','-Wno-parentheses',
        '-ffreestanding','-fno-builtin','-fno-jump-tables','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-fvisibility=hidden',*defines,'-c',HERE/'rules.c','-o',obj)
    dll=BUILD/f'rules{suffix}-template.dll';dll.unlink(missing_ok=True)
    run('java','-cp',JAR,'rpm.cli.RPMTool','-i',obj,'--fourcc','DLXF','-o',dll,'--esdb',BUILD/'rules-symbols.yml','--meta',BUILD/'rules-meta.yml','--generate-relocations')
    run(ROOT/'node_modules/.bin/vite-node',HERE/'describe.ts',dll,ROOT/'src/assets/data'/asset)

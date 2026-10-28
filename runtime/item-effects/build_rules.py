"""Build the position-relocatable rule template; no ROM input or remote services."""
from pathlib import Path
import os,subprocess,json,sys
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
WORKSPACE=ROOT.parent
TOOLS=Path(os.environ.get('ARM_TOOLCHAIN_BIN',WORKSPACE/'toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin'))
JAR=Path(os.environ.get('RPM_TOOL_JAR',WORKSPACE/'pw2-build-work/ctrmap/CTRMap.jar'))
BUILD=HERE/'build';BUILD.mkdir(exist_ok=True)
def run(*args):subprocess.run([str(arg) for arg in args],check=True)
legacy='--legacy' in sys.argv
run(TOOLS/'arm-none-eabi-gcc','-std=c11','-mthumb','-mcpu=arm946e-s','-Os','-Wall','-Wextra','-Werror','-Wno-parentheses',
    '-ffreestanding','-fno-builtin','-fno-jump-tables','-fno-unwind-tables','-fno-asynchronous-unwind-tables','-fvisibility=hidden','-c',HERE/('rules.c' if legacy else 'rules_v4.c'),'-o',BUILD/'rules.o')
(BUILD/'rules-meta.yml').write_text(f'PMCVersion: item-rules-{3 if legacy else 4}\nPMCModulePriority: 4\n')
(BUILD/'rules-symbols.yml').write_text('Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n')
dll=BUILD/'rules-template.dll';dll.unlink(missing_ok=True)
run('java','-cp',JAR,'rpm.cli.RPMTool','-i',BUILD/'rules.o','--fourcc','DLXF','-o',dll,'--esdb',BUILD/'rules-symbols.yml','--meta',BUILD/'rules-meta.yml','--generate-relocations')
run(ROOT/'node_modules/.bin/vite-node',HERE/'describe_rules.ts',dll,ROOT/'src/assets/data'/('itemRuleRuntimeV3.json' if legacy else 'itemRuleRuntime.json'))

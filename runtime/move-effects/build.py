"""Build a relocatable shared move runtime, without ROM input or network access."""
from pathlib import Path
import os
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORKSPACE = ROOT.parent
TOOLS = Path(os.environ.get("ARM_TOOLCHAIN_BIN", WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"))
JAR = Path(os.environ.get("RPM_TOOL_JAR", WORKSPACE / "pw2-build-work/ctrmap/CTRMap.jar"))
BUILD = HERE / "build"
BUILD.mkdir(exist_ok=True)
(BUILD / "events.inc").write_text("\n".join(f"PUBLIC void MoveEvent_{n:02x}(void*i,void*f,u8 o,u32*w){{dispatch(i,f,o,w,{n});}}" for n in range(166)) + "\n")
(BUILD / "symbols.yml").write_text("Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n")
(BUILD / "meta.yml").write_text("PMCVersion: move-rules-1\nPMCModulePriority: 4\n")
def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)
run(TOOLS / "arm-none-eabi-gcc", "-std=c11", "-mthumb", "-mcpu=arm946e-s", "-Os", "-Wall", "-Wextra", "-Werror", "-Wno-parentheses", "-Wno-misleading-indentation", "-ffreestanding", "-fno-builtin", "-fno-jump-tables", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables", "-fvisibility=hidden", "-c", HERE / "rules.c", "-o", BUILD / "rules.o")
(BUILD / "template.dll").unlink(missing_ok=True)
run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", BUILD / "rules.o", "--fourcc", "DLXF", "-o", BUILD / "template.dll", "--esdb", BUILD / "symbols.yml", "--meta", BUILD / "meta.yml", "--generate-relocations")
run(ROOT / "node_modules/.bin/vite-node", HERE / "describe.ts", BUILD / "template.dll", ROOT / "src/assets/data/moveRuleRuntime.json")

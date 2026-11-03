"""Build a relocatable shared move runtime, without ROM input or network access."""
from pathlib import Path
import os
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORKSPACE = ROOT.parent
TOOLS = Path(os.environ.get("ARM_TOOLCHAIN_BIN", WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"))
JAR = Path(os.environ.get("RPM_TOOL_JAR", WORKSPACE / "pw2-build-work/ctrmap/CTRMap.jar"))
BUILD = HERE / "build"
BUILD.mkdir(exist_ok=True)
compact = True
# The host interpreter tests use named wrappers for all native events. Never
# overwrite retained verification assets when building those test objects.
test_only = "--test-only" in sys.argv
if test_only:
    sys.argv.remove("--test-only")
if "--compact" in sys.argv:
    sys.argv.remove("--compact")
(BUILD / "events.inc").write_text(
    "PUBLIC void MoveEventTemplate(void*i,void*f,u8 o,u32*w){dispatch(i,f,o,w,0);}\n" if not test_only else
    "\n".join(f"PUBLIC void MoveEvent_{n:02x}(void*i,void*f,u8 o,u32*w){{dispatch(i,f,o,w,{n});}}" for n in range(166)) + "\n")
(BUILD / "symbols.yml").write_text("Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n")
(BUILD / "meta.yml").write_text("PMCVersion: move-rules-1\nPMCModulePriority: 4\n")
def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)
if len(sys.argv)==1:
    for variant in ["--base","--history","--persistent","--modern-knock"]:
        run(sys.executable,HERE / "build.py",variant, *(["--test-only"] if test_only else []))
    raise SystemExit(0)
modern_knock = sys.argv[1:] == ["--modern-knock"]
persistent = modern_knock or sys.argv[1:] == ["--persistent"]
history = persistent or sys.argv[1:] == ["--history"]
if sys.argv[1:] != ["--base"] and not history:
    raise SystemExit("Usage: build.py [--base|--history|--persistent|--modern-knock] [--compact]")
run(TOOLS / "arm-none-eabi-gcc", "-std=c11", "-mthumb", "-mcpu=arm946e-s", "-Os", "-Wall", "-Wextra", "-Werror", "-Wno-parentheses", "-Wno-misleading-indentation", "-ffreestanding", "-fno-builtin", "-fno-jump-tables", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables", "-fvisibility=hidden", *(["-DMOVE_HISTORY"] if history else []), *(["-DMOVE_PERSISTENT"] if persistent else []), *(["-DMOVE_MODERN_KNOCK"] if modern_knock else []), *(["-DMOVE_COMPACT"] if compact else []), "-c", HERE / "rules.c", "-o", BUILD / "rules.o")
if test_only:
    raise SystemExit(0)
(BUILD / "template.dll").unlink(missing_ok=True)
run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", BUILD / "rules.o", "--fourcc", "DLXF", "-o", BUILD / "template.dll", "--esdb", BUILD / "symbols.yml", "--meta", BUILD / "meta.yml", "--generate-relocations")
name = "moveRuleRuntime" + ("ModernKnock" if modern_knock else "Persistent" if persistent else "History" if history else "") + ("Compact" if compact else "")
run(ROOT / "node_modules/.bin/vite-node", HERE / "describe.ts", BUILD / "template.dll", ROOT / f"src/assets/data/{name}.json", BUILD / "rules.o")

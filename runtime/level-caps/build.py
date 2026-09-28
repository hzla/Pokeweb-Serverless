"""Build Hard Level Caps PMC DLLs for clean US Black 2 and White 2."""
import os
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORKSPACE = REPO.parent
TOOLS = Path(os.environ.get("ARM_TOOLCHAIN_BIN", WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"))
JAR = Path(os.environ.get("RPM_TOOL_JAR", WORKSPACE / "White2Upgrade/CTRMap.jar"))
BUILD = HERE / "build"

COMMON = {
    "GameData_GetEventWork": (0, 0x02017395),
    "PassPower_ApplyEXP": (0, 0x020137f1),
    "DayCareSave_GetPkmStatus": (0, 0x0200c449),
    "DayCareSave_GetPkm": (0, 0x0200c3cd),
    "DayCareSave_GetPkmStepCounter": (0, 0x0200c479),
}
VERSIONS = {
    "B2": {
        "EventWork_GetWkPtr": (0, 0x02019295),
        "PokeParty_GetParam": (0, 0x0201ccf9),
        "PokeParty_SetParam": (0, 0x0201cd1d),
        "PML_UtilGetPkmLvExp": (0, 0x0201d5b5),
        "CalcLevelByExp": (0, 0x0201d53d),
        "DayCare_CommitPkmGrowth": (1, 0x021bd649),
        "DayCare_CalcNewExp": (1, 0x021bd629),
        "DayCare_RemovePkm": (1, 0x021bd349),
        "DayCare_CalcNewLevel": (1, 0x021bd4f5),
        "PokeList_CanItemWithBattleStatsBeUsed": (2, 0x021a23e9),
        "PokeList_CanItemAfterPrologue": (2, 0x021a23f1),
        "AddExpAndEVs": (3, 0x021aee0d),
    },
    "W2": {
        "EventWork_GetWkPtr": (0, 0x020192c1),
        "PokeParty_GetParam": (0, 0x0201cd25),
        "PokeParty_SetParam": (0, 0x0201cd49),
        "PML_UtilGetPkmLvExp": (0, 0x0201d5e1),
        "CalcLevelByExp": (0, 0x0201d569),
        "DayCare_CommitPkmGrowth": (1, 0x021bd681),
        "DayCare_CalcNewExp": (1, 0x021bd661),
        "DayCare_RemovePkm": (1, 0x021bd381),
        "DayCare_CalcNewLevel": (1, 0x021bd52d),
        "PokeList_CanItemWithBattleStatsBeUsed": (2, 0x021a2429),
        "PokeList_CanItemAfterPrologue": (2, 0x021a2431),
        "AddExpAndEVs": (3, 0x021aee4d),
    },
}
def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def main():
    BUILD.mkdir(exist_ok=True)
    for version, specific in VERSIONS.items():
        symbols = {**COMMON, **specific}
        esdb = BUILD / f"symbols_{version.lower()}.yml"
        segments = "Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\n"
        segments += "".join(f"  - ID: {segment}\n    Name: {overlay}\n    Type: OVERLAY\n"
                            for segment, overlay in ((1, 36), (2, 165), (3, 167)))
        esdb.write_text(segments + "Symbols:\n"
                        + "".join(f"  - Name: {name}\n    Segment: {segment}\n    Address: 0x{address:08x}\n"
                                  for name, (segment, address) in symbols.items()))
        metadata = BUILD / f"metadata_{version.lower()}.yml"
        metadata.write_text(f"PMCGameID: {version}\nPMCModulePriority: 4\nPMCVersion: 1.0.0\n"
                            + segments)
        cobj = BUILD / f"level_caps_{version.lower()}.o"
        aobj = BUILD / "hooks.o"
        run(TOOLS / "arm-none-eabi-gcc", "-mthumb", "-mcpu=arm946e-s", "-Os", "-std=c11",
            "-ffreestanding", "-fno-builtin", "-fno-jump-tables", "-fno-unwind-tables",
            "-fno-asynchronous-unwind-tables", "-Wall", "-Wextra", "-Werror",
            *( ["-DLEVEL_CAP_B2=1"] if version == "B2" else []),
            "-c", HERE / "level_caps.c", "-o", cobj)
        run(TOOLS / "arm-none-eabi-as", "-mthumb", "-march=armv5t", HERE / "hooks.s", "-o", aobj)
        elf = BUILD / f"HardLevelCaps{version}.elf"
        run(TOOLS / "arm-none-eabi-ld", "-r", cobj, aobj, "-o", elf)
        output = REPO / f"src/assets/codeinjection/HardLevelCaps{version}.dll"
        run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", elf, "--fourcc", "DLXF", "-o", output,
            "--esdb", esdb, "--meta", metadata, "--generate-relocations", "--strip")
        dump = subprocess.check_output(["java", "-cp", str(JAR), "rpm.cli.RPMDump", "--fourcc", "DLXF", "-i", str(output)]).decode()
        expected = {
            ("THUMB_BRANCH", "36", specific["DayCare_CalcNewLevel"][1] & ~1),
            ("THUMB_BRANCH", "165", specific["PokeList_CanItemWithBattleStatsBeUsed"][1] & ~1),
            ("THUMB_BRANCH_LINK", "36", specific["DayCare_RemovePkm"][1] - 1 + 0x28),
            ("THUMB_BRANCH_LINK", "36", specific["DayCare_CommitPkmGrowth"][1] - 1 + 0x58),
            ("THUMB_BRANCH_LINK", "167", specific["AddExpAndEVs"][1] - 1 + 0x264),
        }
        actual = {(kind, segment, int(address, 16)) for kind, segment, address in
                  re.findall(r"Target: (\S+) @ (\S+) :: (0x[0-9a-f]+)", dump)
                  if segment != "base"}
        if actual != expected or "Import symbol" in dump:
            raise RuntimeError(f"{version}: unexpected hook or unresolved import: {actual}")
        (BUILD / f"HardLevelCaps{version}.dump.txt").write_text(dump)
        print(f"{output.name}: {output.stat().st_size} bytes")


if __name__ == "__main__":
    main()

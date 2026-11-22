"""Build Hard Level Caps PMC DLLs for US Black, White, Black 2 and White 2."""
import argparse
import os
import json
from pathlib import Path
import re
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORKSPACE = REPO.parent
TOOLS = Path(os.environ.get("ARM_TOOLCHAIN_BIN", WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"))
JAR = Path(os.environ.get("RPM_TOOL_JAR", WORKSPACE / "pw2-build-work/ctrmap/CTRMap.jar"))
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

BW1_BEACONS = {"B": 0x02146940, "W": 0x02146960}

def bw1_symbols(game):
    white = game == "W"
    day = 0x18 if white else 0
    battle = 0x20 if white else 0
    return {
        "GameData_GetEventWork": (0, 0x0201296d),
        "EventWork_GetWkPtr": (0, 0x020143e9 if white else 0x020143cd),
        "PassPower_ApplyEXP": (0, 0x02011169),
        "PokeParty_GetParam": (0, 0x02017e39 if white else 0x02017e1d),
        "PokeParty_SetParam": (0, 0x02017e5d if white else 0x02017e41),
        "PML_UtilGetPkmLvExp": (0, 0x020185a1 if white else 0x02018585),
        "CalcLevelByExp": (0, 0x02018529 if white else 0x0201850d),
        "DayCareSave_GetPkmStatus": (0, 0x0200bca9),
        "DayCareSave_GetPkm": (0, 0x0200bc2d),
        "DayCareSave_GetPkmStepCounter": (0, 0x0200bcd9),
        "DayCare_CommitPkmGrowth": (1, 0x021c3531 + day),
        "DayCare_CalcNewExp": (1, 0x021c3511 + day),
        "DayCare_RemovePkm": (1, 0x021c3271 + day),
        "DayCare_CalcNewLevel": (1, 0x021c341d + day),
        "PokeList_CanItemWithBattleStatsBeUsed": (2, 0x021bdd79 + battle),
        "PokeList_CanItemAfterPrologue": (2, 0x021bdd81 + battle),
        "AddExpAndEVs": (3, 0x021cb2d5 + battle),
    }
def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", choices=[*BW1_BEACONS, *VERSIONS], action="append")
    args = parser.parse_args()
    BUILD.mkdir(exist_ok=True)
    sys.path.insert(0, str(REPO / "runtime/battle-type-hud"))
    from rpm_read import read_rpm
    manifest_path = REPO / "src/assets/codeinjection/levelCapsManifest.json"
    manifest = json.loads(manifest_path.read_text())
    for version in args.game or [*BW1_BEACONS, *VERSIONS]:
        bw1 = version in BW1_BEACONS
        symbols = bw1_symbols(version) if bw1 else {**COMMON, **VERSIONS[version]}
        day_care, party, battle = (21, 91, 93) if bw1 else (36, 165, 167)
        exp_call = 0x23a if bw1 else 0x264
        esdb = BUILD / f"symbols_{version.lower()}.yml"
        segments = "Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\n"
        segments += "".join(f"  - ID: {segment}\n    Name: {overlay}\n    Type: OVERLAY\n"
                            for segment, overlay in enumerate((day_care, party, battle), 1))
        esdb.write_text(segments + "Symbols:\n"
                        + "".join(f"  - Name: {name}\n    Segment: {segment}\n    Address: 0x{address:08x}\n"
                                  for name, (segment, address) in symbols.items()))
        metadata = BUILD / f"metadata_{version.lower()}.yml"
        metadata.write_text(f"PMCGameID: {version}\nPMCModulePriority: 4\nPMCVersion: 1.1.0\n"
                            + segments)
        cobj = BUILD / f"level_caps_{version.lower()}.o"
        aobj = BUILD / "hooks.o"
        run(TOOLS / "arm-none-eabi-gcc", "-mthumb", "-mcpu=arm946e-s", "-Os", "-std=c11",
            "-ffreestanding", "-fno-builtin", "-fno-jump-tables", "-fno-unwind-tables",
            "-fno-asynchronous-unwind-tables", "-Wall", "-Wextra", "-Werror",
            *(["-DLEVEL_CAP_BW1=1", f"-DLEVEL_CAP_GAME_BEACON={BW1_BEACONS[version]:#x}"] if bw1
              else ["-DLEVEL_CAP_B2=1"] if version == "B2" else []),
            "-c", HERE / "level_caps.c", "-o", cobj)
        run(TOOLS / "arm-none-eabi-as", "-mthumb", "-march=armv5t", *(["--defsym", "LEVEL_CAP_BW1=1"] if bw1 else []),
            HERE / "hooks.s", "-o", aobj)
        elf = BUILD / f"HardLevelCaps{version}.elf"
        run(TOOLS / "arm-none-eabi-ld", "-r", cobj, aobj, "-o", elf)
        output = REPO / f"src/assets/codeinjection/HardLevelCaps{version}.dll"
        run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", elf, "--fourcc", "DLXF", "-o", output,
            "--esdb", esdb, "--meta", metadata, "--generate-relocations", "--strip")
        dump = subprocess.check_output(["java", "-cp", str(JAR), "rpm.cli.RPMDump", "--fourcc", "DLXF", "-i", str(output)]).decode()
        expected = {
            ("THUMB_BRANCH", str(day_care), symbols["DayCare_CalcNewLevel"][1] & ~1),
            ("THUMB_BRANCH", str(party), symbols["PokeList_CanItemWithBattleStatsBeUsed"][1] & ~1),
            ("THUMB_BRANCH_LINK", str(day_care), symbols["DayCare_RemovePkm"][1] - 1 + 0x28),
            ("THUMB_BRANCH_LINK", str(day_care), symbols["DayCare_CommitPkmGrowth"][1] - 1 + 0x58),
            ("THUMB_BRANCH_LINK", str(battle), symbols["AddExpAndEVs"][1] - 1 + exp_call),
        }
        actual = {(kind, segment, int(address, 16)) for kind, segment, address in
                  re.findall(r"Target: (\S+) @ (\S+) :: (0x[0-9a-f]+)", dump)
                  if segment != "base"}
        if actual != expected or "Import symbol" in dump:
            raise RuntimeError(f"{version}: unexpected hook or unresolved import: {actual}")
        rpm = read_rpm(output.read_bytes())
        nm = subprocess.check_output([str(TOOLS / "arm-none-eabi-nm"), "--defined-only", str(elf)], text=True)
        offset = int(re.search(r"^([0-9a-f]+)\s+\S\s+LevelCaps_CandyItemId$", nm, re.M).group(1), 16)
        assert rpm["code"][offset:offset + 4] == (622).to_bytes(4, "little")
        assert all(r["module"] != "base" or not offset <= r["address"] < offset + 4 for r in rpm["relocations"])
        manifest["games"].setdefault(version, {})["current"] = dict(version="1.1.0", codeHex=rpm["code"].hex(),
            itemIdOffset=offset, relocations=rpm["relocations"], symbols=rpm["symbols"], bssSize=rpm["bss"])
        (BUILD / f"HardLevelCaps{version}.dump.txt").write_text(dump)
        print(f"{output.name}: {output.stat().st_size} bytes")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()

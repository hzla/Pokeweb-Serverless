"""Build the optional trainer-win cap companion for US revision-0 B2/W2."""
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORKSPACE = REPO.parent
TOOLS = Path(os.environ.get("ARM_TOOLCHAIN_BIN", WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"))
JAR = Path(os.environ.get("RPM_TOOL_JAR", WORKSPACE / "pw2-build-work/ctrmap/CTRMap.jar"))
BUILD = Path(os.environ.get("TRAINER_CAPS_BUILD_DIR", HERE / "build/trainer-caps"))
PROFILES = {
    "B2": ("IREO", 0x021690e8, 0x02168f39, 0x02019295, -44),
    "W2": ("IRDO", 0x02169128, 0x02168f79, 0x020192c1, 0),
}


def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(REPO / "runtime/battle-type-hud"))
    from rpm_read import read_rpm
    manifest = {}
    for game, (id_code, sync, broadcast, wkptr, fs_delta) in PROFILES.items():
        symbols = {
            "EventBattleCall_SyncGameDataOnReturn": (1, sync | 1),
            "EventBattleCall_BroadcastBattleResult": (1, broadcast),
            "GameData_GetEventWork": (0, 0x02017395),
            "EventWork_GetWkPtr": (0, wkptr),
            **{name: (0, (address + fs_delta) | 1) for name, address in {
                "FS_InitFile": 0x02070ca8, "FS_OpenFile": 0x02070ecc,
                "FS_ReadFile": 0x02070e6c, "FS_GetLength": 0x02070dec,
                "FS_SeekFile": 0x02070e54, "FS_CloseFile": 0x02070de0,
            }.items()},
        }
        segments = "Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\n  - ID: 1\n    Name: 12\n    Type: OVERLAY\n"
        esdb = BUILD / f"symbols_{game}.yml"
        esdb.write_text(segments + "Symbols:\n" + "".join(
            f"  - Name: {name}\n    Segment: {segment}\n    Address: 0x{address:08x}\n"
            for name, (segment, address) in symbols.items()))
        meta = BUILD / f"metadata_{game}.yml"
        meta.write_text(f"PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: 1.0.0\n" + segments)
        elf = BUILD / f"TrainerLevelCaps{game}.elf"
        subprocess.run([str(TOOLS / "arm-none-eabi-gcc"), "-mthumb", "-mcpu=arm946e-s", "-Os", "-std=c11",
                        "-ffreestanding", "-fno-builtin", "-fno-jump-tables", "-fno-unwind-tables",
                        "-fno-asynchronous-unwind-tables", "-Wall", "-Wextra", "-Werror", "-c",
                        str(HERE / "trainer_caps.c"), "-o", str(elf)], check=True)
        output = REPO / f"src/assets/codeinjection/TrainerLevelCaps{game}.dll"
        subprocess.run(["java", "-cp", str(JAR), "rpm.cli.RPMTool", "-i", str(elf), "--fourcc", "DLXF",
                        "-o", str(output), "--esdb", str(esdb), "--meta", str(meta), "--generate-relocations", "--strip"], check=True)
        rpm = read_rpm(output.read_bytes())
        hooks = [r for r in rpm["relocations"] if r["module"] != "base"]
        assert len(hooks) == 1 and hooks[0]["module"] == "12" and hooks[0]["address"] == sync + 0x14
        assert hooks[0]["type"] == "THUMB_BRANCH_LINK"
        assert not any(s["attributes"] & 2 for s in rpm["symbols"]), "Unresolved imports"
        # Short audited context includes result access, the replaced call, and next call.
        context = "38b5051c0c1ca968201ca8310968aef6" + ("ddf9" if game == "B2" else "bdf9") + "281cfff71cff281cfff7bbff"
        manifest[game] = dict(idCode=id_code, fileName=output.name, version="1.0.0", hookAddress=sync + 0x14,
                              signatureAddress=sync, expectedHex=context, codeHex=rpm["code"].hex(),
                              bssSize=rpm["bss"], symbols=rpm["symbols"], relocations=rpm["relocations"])
        print(f"{output.name}: {output.stat().st_size} bytes")
    (REPO / "src/assets/codeinjection/trainerLevelCapsManifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()

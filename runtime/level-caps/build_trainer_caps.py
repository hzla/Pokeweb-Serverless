"""Build the optional trainer-win cap companion for US revision-0 BW and BW2."""
import argparse
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
    "B": ("IRBO", 0x0216eff0, 0x0216ee7d, 0x020143cd, 0),
    "W": ("IRAO", 0x0216f010, 0x0216ee9d, 0x020143e9, 24),
    "B2": ("IREO", 0x021690e8, 0x02168f39, 0x02019295, -44),
    "W2": ("IRDO", 0x02169128, 0x02168f79, 0x020192c1, 0),
}

BW1_FS = {
    "INIT": 0x020788ac, "OPEN": 0x02078c18, "READ": 0x02078b70,
    "LENGTH": 0x02078a94, "SEEK": 0x02078b44, "CLOSE": 0x02078a80,
}
BW1_CONTEXT = {
    "B": "38b5051c0c1ca968201c8c310968a3f625fda968201ceff7d3fa281cfff736ff281cfff7b7ff",
    "W": "38b5051c0c1ca968201c8c310968a3f615fda968201ceff7d3fa281cfff736ff281cfff7b7ff",
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", choices=PROFILES, action="append")
    args = parser.parse_args()
    BUILD.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(REPO / "runtime/battle-type-hud"))
    from rpm_read import read_rpm
    manifest_path = REPO / "src/assets/codeinjection/trainerLevelCapsManifest.json"
    manifest = json.loads(manifest_path.read_text())
    for game in args.game or PROFILES:
        id_code, sync, broadcast, wkptr, fs_delta = PROFILES[game]
        bw1 = game in BW1_CONTEXT
        overlay, hook_offset = (10, 0x1c) if bw1 else (12, 0x14)
        symbols = {
            "EventBattleCall_SyncGameDataOnReturn": (1, sync | 1),
            "EventBattleCall_BroadcastBattleResult": (1, broadcast),
            "GameData_GetEventWork": (0, 0x0201296d if bw1 else 0x02017395),
            "EventWork_GetWkPtr": (0, wkptr),
            **({} if bw1 else {name: (0, (address + fs_delta) | 1) for name, address in {
                "FS_InitFile": 0x02070ca8, "FS_OpenFile": 0x02070ecc,
                "FS_ReadFile": 0x02070e6c, "FS_GetLength": 0x02070dec,
                "FS_SeekFile": 0x02070e54, "FS_CloseFile": 0x02070de0,
            }.items()}),
        }
        segments = f"Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\n  - ID: 1\n    Name: {overlay}\n    Type: OVERLAY\n"
        esdb = BUILD / f"symbols_{game}.yml"
        esdb.write_text(segments + "Symbols:\n" + "".join(
            f"  - Name: {name}\n    Segment: {segment}\n    Address: 0x{address:08x}\n"
            for name, (segment, address) in symbols.items()))
        meta = BUILD / f"metadata_{game}.yml"
        meta.write_text(f"PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: 1.0.0\n" + segments)
        elf = BUILD / f"TrainerLevelCaps{game}.elf"
        subprocess.run([str(TOOLS / "arm-none-eabi-gcc"), "-mthumb", "-mcpu=arm946e-s", "-Os", "-std=c11",
                        "-ffreestanding", "-fno-builtin", "-fno-jump-tables", "-fno-unwind-tables",
                        "-fno-asynchronous-unwind-tables", "-Wall", "-Wextra", "-Werror",
                        *(["-DTRAINER_CAPS_BW1=1", *(f"-DNATIVE_FS_{key}={address+fs_delta:#x}"
                            for key, address in BW1_FS.items())] if bw1 else []), "-c",
                        str(HERE / "trainer_caps.c"), "-o", str(elf)], check=True)
        output = REPO / f"src/assets/codeinjection/TrainerLevelCaps{game}.dll"
        subprocess.run(["java", "-cp", str(JAR), "rpm.cli.RPMTool", "-i", str(elf), "--fourcc", "DLXF",
                        "-o", str(output), "--esdb", str(esdb), "--meta", str(meta), "--generate-relocations", "--strip"], check=True)
        rpm = read_rpm(output.read_bytes())
        hooks = [r for r in rpm["relocations"] if r["module"] != "base"]
        assert len(hooks) == 1 and hooks[0]["module"] == str(overlay) and hooks[0]["address"] == sync + hook_offset
        assert hooks[0]["type"] == "THUMB_BRANCH_LINK"
        assert not any(s["attributes"] & 2 for s in rpm["symbols"]), "Unresolved imports"
        # Short audited context includes result access, the replaced call, and next call.
        context = BW1_CONTEXT[game] if bw1 else "38b5051c0c1ca968201ca8310968aef6" + ("ddf9" if game == "B2" else "bdf9") + "281cfff71cff281cfff7bbff"
        manifest[game] = dict(idCode=id_code, fileName=output.name, version="1.0.0", hookAddress=sync + hook_offset,
                              signatureAddress=sync, expectedHex=context, codeHex=rpm["code"].hex(),
                              bssSize=rpm["bss"], symbols=rpm["symbols"], relocations=rpm["relocations"])
        manifest[game]["overlay"] = overlay
        print(f"{output.name}: {output.stat().st_size} bytes")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()

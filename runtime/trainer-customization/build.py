"""Build BW2 Trainer Customization DLLs using the existing trainer nature hooks."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

import ndspy.codeCompression
import ndspy.rom

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORKSPACE = REPO.parent
TOOLS = Path(os.environ.get("ARM_TOOLCHAIN_BIN", WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"))
JAR = Path(os.environ.get("RPM_TOOL_JAR", WORKSPACE / "pw2-build-work/ctrmap/CTRMap.jar"))
ASSETS = REPO / "src/assets/codeinjection"
VERSION = "2.7.0"
WEIGHTED = {
    "B2": "78d294c12ea62e805dbd4fe911ff78bf12b0b4e0d39c03367165ccf5669e8f47",
    "W2": "3b74353330cec72d879505c775e6f14c56872847e1a844ddfdec29b12379acf1",
}
PREVIOUS = {
    "B2": "e9c9406d219edd77f858ac5a8462d1e3720b342675a5327d2c9bd82599e6a5e5",
    "W2": "22a2ffb6dd7a56b92b560725e94806b68ad9050f9907fb9f7d3734577d5f9328",
}
CONDITIONAL = {
    "B2": "03f9ee4a3310f489af634e47cc3296b0591068e0a1deedc3567de0ab1b74d2f2",
    "W2": "96b1fb068bb87121c4f9eeab21de6566c18b4c3c82f7a80f1ca8ff0a99607668",
}
LINKED_POOLS = {
    "B2": "6d6e998f3727aa58c001c3e512f000b2a135bfef1d3999db1baff5a8fa64aac7",
    "W2": "dcb9bbb77a43d96b6d7190905078b9e63feaef9f810492befcd2d583125d1975",
}
DIRECT_POOLS = {
    "B2": "78f4a8f38730a7a91db66c715a298b6211babb508df861f1243b8da365bc3eb1",
    "W2": "5ccc43e52b9693bf758675c3438a131505145c45f7dc6266aa035e81f388792b",
}
FIXED_PARTIES = {
    "B2": "32bec2170e380b701e4262706870baf5ea9332677ac92f30b51fe5a0873bf034",
    "W2": "e34b0cc0556a28aac7506eea008c8e278f9b78862f024a0bb4b6bbc568ae2c2c",
}
SLOT_POOLS = {
    "B2": "7a7abf9e2722a869668ec7b391a8bb829eac9bc4c91118e5f8743b3e8ad74784",
    "W2": "d9d6176b48c3704a89da37708a1d8ff2ea0feebe3e6aa375bd1d959c98102184",
}
MANIFEST = {}
# Keep machine paths out of __FILE__ and debug info; the output is stripped as well.
PATH_FLAGS = [f"-fmacro-prefix-map={REPO}=.", f"-fdebug-prefix-map={REPO}=."]

def run(*args):
    subprocess.run([str(arg) for arg in args], check=True)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def signature(base, data, address, size):
    part = data[address - base:address - base + size]
    assert len(part) == size
    return dict(address=address, size=size, sha256=digest(part))

for game, basename, code in (("B2", "cleanblack2", b"IREO"), ("W2", "cleanwhite2", b"IRDO")):
    black = game == "B2"
    build = HERE / "build" / game
    build.mkdir(parents=True, exist_ok=True)
    flags = ["-mthumb", "-mcpu=arm946e-s", *PATH_FLAGS, *(["-DBLACK2"] if black else [])]
    asm, cpp, rosters, pools, nature = (build / name for name in ("hook.o", "runtime.o", "rosters.o", "pools.o", "nature.o"))
    run(TOOLS / "arm-none-eabi-gcc", *flags, "-c", HERE / "hook.S", "-o", asm)
    run(TOOLS / "arm-none-eabi-gcc", *flags, "-c", HERE.parent / "trainer-nature/TrainerNature.S", "-o", nature)
    for source, obj in (("runtime.cpp", cpp), ("rosters.cpp", rosters), ("pools.cpp", pools)):
        run(TOOLS / "arm-none-eabi-g++", *flags, "-std=c++17", "-Os", "-Wall", "-Wextra", "-Werror", "-fno-exceptions",
            "-fno-rtti", "-fno-unwind-tables", "-ffreestanding", "-fno-builtin", "-fno-jump-tables", "-c", HERE / source, "-o", obj)
    elf = build / "runtime.elf"
    run(TOOLS / "arm-none-eabi-g++", "-nostdlib", "-Wl,-r", asm, cpp, rosters, pools, nature, "-o", elf)
    undefined = subprocess.check_output([str(TOOLS / "arm-none-eabi-nm"), "-u", str(elf)], text=True)
    native_symbols = {"Trainer_ExpForLevel", "Trainer_Put", "Trainer_RecalcStats", "Trainer_SetParam", "Trainer_SetupEx"}
    assert {line.split()[-1] for line in undefined.splitlines()} == native_symbols, undefined
    symbols = build / "symbols.yml"
    source_symbols = (HERE.parent / "trainer-nature" / f"symbols_{game.lower()}.yml").read_text()
    symbols.write_text(source_symbols.replace("Symbols:", "  - ID: 167\n    Name: 167\n    Type: OVERLAY\nSymbols:"))
    meta = build / "metadata.yml"
    meta.write_text(f"PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n")
    rom = ndspy.rom.NintendoDSRom.fromFile(str(WORKSPACE / (basename + ".nds")))
    assert rom.idCode == code and rom.version == 0
    arm9 = ndspy.codeCompression.decompress(rom.arm9)
    for address, insn in [(0x020308fa, "eff731fa"), (0x02030952, "fff7dbfe"), (0x0203095a, "fff7f9fe")]:
        offset = address - (44 if black else 0) - rom.arm9RamAddress
        assert arm9[offset:offset + 4] == bytes.fromhex(insn)
    overlay = rom.loadArm9Overlays([167])[167]
    shift = 0x40 if black else 0
    hook = 0x0219cdd2 - shift
    assert overlay.data[hook - overlay.ramAddress:hook - overlay.ramAddress + 4] == bytes.fromhex("1df0f7fb")
    output = ASSETS / f"TrainerCustomization{game}.dll"
    run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", elf, "--fourcc", "DLXF", "-o", output,
        "--esdb", symbols, "--meta", meta, "--generate-relocations", "--strip")
    MANIFEST[game] = dict(
        gameCode=code.decode(), version=VERSION, hook=hook,
        sha256=digest(output.read_bytes()),
        previousSha256=PREVIOUS[game],
        weightedSha256=WEIGHTED[game],
        conditionalSha256=CONDITIONAL[game],
        linkedPoolsSha256=LINKED_POOLS[game],
        directPoolsSha256=DIRECT_POOLS[game],
        fixedPartiesSha256=FIXED_PARTIES[game],
        slotPoolsSha256=SLOT_POOLS[game],
        legacySha256=digest((ASSETS / f"TrainerNature{game}.dll").read_bytes()),
        arm9=[signature(rom.arm9RamAddress, arm9, address - (44 if black else 0), size)
              for address, size in [(0x0201cd24, 12), (0x0201cd48, 12), (0x0208d894, 12),
                                    (0x020308ec, 0x74), (0x020787d4, 12),
                                    (0x0201fd60, 0x38), (0x0203070c, 0x44), (0x02030750, 16),
                                    (0x0201fe24, 4), (0x0201ff34, 10), (0x020191d8, 0x2c), (0x020192c0, 12),
                                    *[(address, 12) for address in (0x02070ca8, 0x02070ecc, 0x02070e6c, 0x02070dec, 0x02070e54, 0x02070de0)]]],
        setup=[signature(rom.arm9RamAddress, arm9, address, size) for address, size in
               [(0x02017c94, 22), (0x02017cec, 14), (0x02017e54, 0x5c),
                (0x0201828c, 0x180), (0x02005748, 0x38), (0x0201735c, 8), (0x02017394, 8), (0x02017f82, 2)]],
        overlay=[signature(overlay.ramAddress, overlay.data, address - shift, size)
                 for address, size in [(0x0219cd7c, 0x60), (0x021ba5c4, 0x108), (0x021ce2d8, 0x1c)]],
    )
    print(output.name, output.stat().st_size, "bytes")

(ASSETS / "trainerCustomizationManifest.json").write_text(json.dumps(MANIFEST, indent=2) + "\n")

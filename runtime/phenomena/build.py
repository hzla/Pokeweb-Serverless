"""Build the configurable dust cloud / flying shadow DLLs for US B, W, B2 and W2.

Inputs are clean revision-0 ROMs (the usual workspace paths) or, with --dumps DIR,
the decompressed ARM9 and phenomenon overlay of each ROM saved as
<IDCODE>_arm9.bin / <IDCODE>_ov<N>.bin plus info.json ({idCode: {ovRam, arm9Ram}}).
White (BW1) is optional: without its ROM the hook bytes are derived from Black,
whose overlay 21 code White loads 0x20 higher with the same encoding. The
installer still compares every hook byte with the user's ROM before staging.
"""
import argparse
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORKSPACE = REPO.parent
TOOLS = Path(os.environ.get("ARM_TOOLCHAIN_BIN", WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"))
JAR = Path(os.environ.get("RPM_TOOL_JAR", WORKSPACE / "pw2-build-work/ctrmap/CTRMap.jar"))
BUILD = HERE / "build"
ASSETS = REPO / "src/assets/codeinjection"
VERSION = "1.0.0"
CONFIG_SIZE = 2516

# Native step handler and the three call sites inside it. Offsets are from the
# function start: the BL to the 0-999 random roll, the flying-shadow item
# picker and the dust-cloud item picker. r4 holds the active spot at all three.
GAMES = {
    "B": dict(idCode="IRBO", rom=WORKSPACE / "cleanblack.nds", overlay=21, trigger=0x021AA944, roll=0x68, shadow=0x7C, dust=0x9C,
              random=0x02005728, nativeShadow=0x021AB070, nativeDust=0x021AB018, stones=0x021D8E8A),
    "W": dict(idCode="IRAO", rom=Path.home() / "Downloads/cleanroms/cleanwhite.nds", overlay=21, trigger=0x021AA964, roll=0x68, shadow=0x7C, dust=0x9C,
              random=0x02005728, nativeShadow=0x021AB090, nativeDust=0x021AB038, stones=0x021D8EAA, deriveFrom="B", overlayShift=0x20),
    "B2": dict(idCode="IREO", rom=WORKSPACE / "cleanblack2.nds", overlay=36, trigger=0x021A21D0, roll=0x6A, shadow=0x7E, dust=0xAA,
               random=0x02005784, nativeShadow=0x021A296C, nativeDust=0x021A28E4, stones=0x021D02DC, shards=0x021D02CA, shardZones=0x021D0304),
    "W2": dict(idCode="IRDO", rom=WORKSPACE / "cleanwhite2.nds", overlay=36, trigger=0x021A2210, roll=0x6A, shadow=0x7E, dust=0xAA,
               random=0x02005784, nativeShadow=0x021A29AC, nativeDust=0x021A2924, stones=0x021D0310, shards=0x021D02FE, shardZones=0x021D0338),
}
GEMS = list(range(548, 565))  # native: Fire Gem + random(1700) / 100
EVERSTONE = 229
WINGS = list(range(565, 571))  # native: Health Wing + random(600) / 100
PRETTY_WING = 571


def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def bl_target(data: bytes, at: int, address: int) -> int:
    hi, lo = struct.unpack_from("<HH", data, at)
    assert hi & 0xF800 == 0xF000 and lo & 0xF800 == 0xF800, f"no Thumb BL at 0x{address:x}"
    offset = ((hi & 0x7FF) << 12) | ((lo & 0x7FF) << 1)
    if offset & 0x400000: offset -= 0x800000
    return address + 4 + offset


def thumb_bl(site: int, destination: int) -> bytes:
    delta = (destination & ~1) - (site + 4)
    assert -(1 << 22) <= delta < (1 << 22)
    return struct.pack("<HH", 0xF000 | ((delta >> 12) & 0x7FF), 0xF800 | ((delta >> 1) & 0x7FF))


class Image:
    def __init__(self, arm9: bytes, arm9_ram: int, overlay: bytes, overlay_ram: int, overlay_id: int):
        self.arm9, self.arm9_ram, self.overlay, self.overlay_ram, self.overlay_id = arm9, arm9_ram, overlay, overlay_ram, overlay_id

    def read(self, address: int, size: int) -> bytes:
        if self.overlay_ram <= address < self.overlay_ram + len(self.overlay):
            data, at = self.overlay, address - self.overlay_ram
        else:
            data, at = self.arm9, address - self.arm9_ram
        raw = bytes(data[at:at + size])
        assert len(raw) == size and at >= 0, f"0x{address:x} outside the loaded code"
        return raw

    def u16s(self, address: int, count: int) -> list[int]:
        return list(struct.unpack("<%dH" % count, self.read(address, count * 2)))


def load_image(game: str, spec: dict, dumps: Path | None) -> Image | None:
    if dumps is not None:
        info = json.loads((dumps / "info.json").read_text()).get(spec["idCode"])
        ov = dumps / f"{spec['idCode']}_ov{spec['overlay']}.bin"
        if not info or not ov.exists(): return None
        return Image((dumps / f"{spec['idCode']}_arm9.bin").read_bytes(), info["arm9Ram"], ov.read_bytes(), info["ovRam"], spec["overlay"])
    if not spec["rom"].exists(): return None
    import ndspy.codeCompression
    import ndspy.rom
    rom = ndspy.rom.NintendoDSRom.fromFile(str(spec["rom"]))
    assert rom.idCode == spec["idCode"].encode() and rom.version == 0, f"{game}: expected clean revision-0 {spec['idCode']}"
    overlay = rom.loadArm9Overlays([spec["overlay"]])[spec["overlay"]]
    return Image(bytes(ndspy.codeCompression.decompress(rom.arm9)), rom.arm9RamAddress, bytes(overlay.data), overlay.ramAddress, spec["overlay"])


def check_hooks(game: str, spec: dict, image: Image) -> dict:
    """Assert the retail instruction shape around each redirected call."""
    t = spec["trigger"]
    roll, shadow, dust = t + spec["roll"], t + spec["shadow"], t + spec["dust"]
    start, end = roll - 4, dust + 4
    region = image.read(start, end - start)
    assert region[:4] == bytes.fromhex("fa208000"), f"{game}: roll argument is not 1000"
    assert bl_target(region, roll - start, roll) == spec["random"], f"{game}: roll does not call the native random"
    assert region[8:16] == bytes.fromhex("0004010c207b0728"), f"{game}: roll result/kind check"
    assert bl_target(region, shadow - start, shadow) == spec["nativeShadow"], f"{game}: shadow picker call"
    assert bl_target(region, dust - start, dust) == spec["nativeDust"], f"{game}: dust picker call"
    # The spot pointer is r4 = field gimmick / encount state + 0x10 (BW1) or 0x18 (BW2).
    head = image.read(t, spec["roll"])
    assert (bytes.fromhex("1034") if spec["overlay"] == 21 else bytes.fromhex("1834")) in head, f"{game}: spot register setup"
    # Dust threshold 400 compare and its unsigned branch (the legacy Patches-page
    # item removal rewrote this branch; Pokeweb restores it before installing).
    threshold = bytes.fromhex("192000018142")  # movs r0, #25; lsls r0, #4; cmp r1, r0
    compare = region.find(threshold)
    assert compare > 0 and region.count(threshold) == 1 and region[compare + 6:compare + 8] == b"\x00\xd2", f"{game}: dust threshold branch"
    return dict(start=start, region=region, compare=start + compare + 7)


def defaults(game: str, spec: dict, image: Image) -> dict:
    stones = image.u16s(spec["stones"], 10)
    dust = [dict(item=i, weight=10) for i in stones] + [dict(item=g, weight=50) for g in GEMS] + [dict(item=EVERSTONE, weight=50)]
    shadow = [dict(item=w, weight=150) for w in WINGS] + [dict(item=PRETTY_WING, weight=100)]
    groups = []
    if "shards" in spec:
        shards = image.u16s(spec["shards"], 4)
        zones = image.u16s(spec["shardZones"], 15)
        groups.append(dict(kind="dust", zones=zones, encounterPermille=None, items=[dict(item=i, weight=250) for i in shards]))
    return dict(dustEncounterPermille=400, shadowEncounterPermille=200, dust=dust, shadow=shadow, groups=groups)


def derive_white(black: dict, spec: dict) -> dict:
    """White's overlay 21 equals Black's 0x20 higher; only BLs into ARM9 change."""
    shift = spec["overlayShift"]
    region = bytearray(black["region"])
    start = black["start"] + shift
    roll = spec["trigger"] + spec["roll"]
    region[roll - start:roll - start + 4] = thumb_bl(roll, spec["random"])
    return dict(start=start, region=bytes(region), compare=black["compare"] + shift)


def build(game: str, spec: dict) -> dict:
    t, ov = spec["trigger"], spec["overlay"]
    asm = [".syntax unified", ".cpu arm946e-s", ".thumb", ".text"]
    for name, offset, target, arg in (("Roll", spec["roll"], "Phen_Roll", "r1"), ("Shadow", spec["shadow"], "Phen_ShadowItem", "r0"),
                                      ("Dust", spec["dust"], "Phen_DustItem", "r0")):
        symbol = f"THUMB_BRANCH_LINK_{ov}_0x{t + offset:x}"
        # The native call site keeps r4 = spot; pass it to the C handler.
        asm += [".balign 2", f".global {symbol}", f".type {symbol},%function", ".thumb_func", f"{symbol}:",
                "push {r3, lr}", f"movs {arg}, r4", f"bl {target}", "pop {r3, pc}", f".size {symbol},.-{symbol}"]
    source = BUILD / f"hooks{game}.s"
    source.write_text("\n".join(asm) + "\n")
    cobj, hobj = BUILD / f"phenomena{game}.o", BUILD / f"hooks{game}.o"
    run(TOOLS / "arm-none-eabi-gcc", "-mthumb", "-mcpu=arm946e-s", "-Os", "-std=c11", "-ffreestanding", "-fno-builtin",
        "-fno-jump-tables", "-fno-unwind-tables", "-fno-asynchronous-unwind-tables", "-Wall", "-Wextra", "-Werror",
        "-c", HERE / "phenomena.c", "-o", cobj)
    run(TOOLS / "arm-none-eabi-as", "-mthumb", "-march=armv5t", source, "-o", hobj)
    elf = BUILD / f"Phenomena{game}.elf"
    run(TOOLS / "arm-none-eabi-ld", "-r", cobj, hobj, "-o", elf)
    undefined = subprocess.check_output([str(TOOLS / "arm-none-eabi-nm"), "-u", str(elf)], text=True).split()
    assert sorted(u for u in undefined if u != "U") == ["Phen_NativeDustItem", "Phen_NativeRandom", "Phen_NativeShadowItem"], undefined
    segments = f"Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\n  - ID: 1\n    Name: {ov}\n    Type: OVERLAY\n"
    esdb = BUILD / f"symbols{game}.yml"
    esdb.write_text(segments + "Symbols:\n" + "".join(
        f"  - Name: {name}\n    Segment: {segment}\n    Address: 0x{address | 1:08x}\n"
        for name, segment, address in (("Phen_NativeRandom", 0, spec["random"]), ("Phen_NativeDustItem", 1, spec["nativeDust"]),
                                       ("Phen_NativeShadowItem", 1, spec["nativeShadow"]))))
    meta = BUILD / f"metadata{game}.yml"
    meta.write_text(f"PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n" + segments)
    dll = ASSETS / f"Phenomena{game}.dll"
    run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", elf, "--fourcc", "DLXF", "-o", dll, "--esdb", esdb, "--meta", meta,
        "--generate-relocations", "--strip")
    sys.path.insert(0, str(REPO / "runtime/battle-type-hud"))
    from rpm_read import read_rpm
    raw = dll.read_bytes()
    rpm = read_rpm(raw)
    expected = {("THUMB_BRANCH_LINK", str(ov), t + o) for o in (spec["roll"], spec["shadow"], spec["dust"])}
    actual = {(r["type"], r["module"], r["address"]) for r in rpm["relocations"] if r["module"] != "base"}
    assert actual == expected, actual
    # Locate the configuration block in the code image by its unique header.
    magic = struct.pack("<IHH", 0x314E4850, 1, 0)
    offsets = [m.start() for m in re.finditer(re.escape(magic), rpm["code"])]
    assert len(offsets) == 1 and offsets[0] % 4 == 0, offsets
    config_offset = offsets[0]
    assert all(not (r["module"] == "base" and config_offset <= r["address"] < config_offset + CONFIG_SIZE) for r in rpm["relocations"])
    dump = subprocess.check_output(["java", "-cp", str(JAR), "rpm.cli.RPMDump", "--fourcc", "DLXF", "-i", str(dll)], stderr=subprocess.DEVNULL).decode()
    assert "Import symbol" not in dump, dump
    (BUILD / f"Phenomena{game}.dump.txt").write_text(dump)
    return dict(fileName=dll.name, sha256=hashlib.sha256(raw).hexdigest(), configOffset=config_offset, configSize=CONFIG_SIZE,
                codeHex=rpm["code"].hex(), bssSize=rpm["bss"], relocations=rpm["relocations"], symbols=rpm["symbols"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dumps", type=Path)
    args = parser.parse_args()
    BUILD.mkdir(exist_ok=True)
    manifest = dict(version=VERSION, configSize=CONFIG_SIZE, games={})
    checked, images = {}, {}
    for game, spec in GAMES.items():
        image = load_image(game, spec, args.dumps)
        if image is None:
            if "deriveFrom" not in spec: raise SystemExit(f"{game}: clean ROM not found ({spec['rom']})")
            source = GAMES[spec["deriveFrom"]]
            hooks = derive_white(checked[spec["deriveFrom"]], spec)
            values = defaults(spec["deriveFrom"], source, images[spec["deriveFrom"]])
            retail = False
        else:
            hooks, values, retail = check_hooks(game, spec, image), defaults(game, spec, image), True
            checked[game], images[game] = hooks, image
        out = build(game, spec)
        t = spec["trigger"]
        manifest["games"][game] = dict(
            idCode=spec["idCode"], overlay=spec["overlay"], retailChecked=retail, **out,
            hooks=[dict(label=label, module=str(spec["overlay"]), address=t + spec[key], patchSize=4)
                   for label, key in (("Phenomenon roll", "roll"), ("Flying shadow item", "shadow"), ("Dust cloud item", "dust"))],
            signature=dict(module=str(spec["overlay"]), address=hooks["start"], expectedHex=hooks["region"].hex(),
                           dustBranchAddress=hooks["compare"], dustBranchNative=0xD2, dustBranchLegacy=0xBF),
            defaults=values)
        print(game, out["fileName"], len(bytes.fromhex(out["codeHex"])), "bytes code;", "retail bytes checked" if retail else "derived from Black")
    (ASSETS / "phenomenaManifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()

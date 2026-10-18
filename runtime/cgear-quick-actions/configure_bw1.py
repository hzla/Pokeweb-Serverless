"""Explicit US revision-0 BW1 C-Gear adapters (entry bits retain ARM/Thumb mode)."""

import hashlib, importlib.util, json, os, struct
from pathlib import Path
import ndspy.rom, ndspy.codeCompression, ndspy.narc

HERE = Path(__file__).resolve().parent
WS = HERE.parents[2]
spec = importlib.util.spec_from_file_location(
    "party_bw1", HERE.parent / "party-quick-actions/configure_bw1.py"
)
party = importlib.util.module_from_spec(spec)
spec.loader.exec_module(party)

# Symbol-bearing function matches are only candidates; these entries are also
# checked against retail callers, tables, argument layouts and execution mode.
FUNCTIONS = {
    "Game": ("ARM9", 0x20120F5, 0x20120F5),
    "Field": ("ARM9", 0x201210D, 0x201210D),
    "Save": ("ARM9", 0x2012EBD, 0x2012EBD),
    "Etc": ("ARM9", 0x200ED49, 0x200ED49),
    "Bag": ("ARM9", 0x201292D, 0x201292D),
    "Party": ("ARM9", 0x2012935, 0x2012935),
    "Player": ("ARM9", 0x20127A5, 0x20127A5),
    "PlayerForm": ("ARM9", 0x2012B29, 0x2012B29),
    "Flags": ("ARM9", 0x201296D, 0x201296D),
    "EncounterState": ("ARM9", 0x2012A39, 0x2012A39),
    "Misc": ("ARM9", 0x2012F09, 0x2012F09),
    "Badge": ("ARM9", 0x200C235, 0x200C235),
    "SubscreenMode": ("ARM9", 0x20129B9, 0x20129B9),
    "EventCreate": ("ARM9", 0x20122C1, 0x20122C1),
    "EventChild": ("ARM9", 0x2012375, 0x2012375),
    "EventSystem": ("ARM9", 0x20124E5, 0x20124E5),
    "EventData": ("ARM9", 0x20124E9, 0x20124E9),
    "Random": ("ARM9", 0x2005729, 0x2005729),
    "RepelStep": ("ARM9", 0x200D565, 0x200D565),
    "RepelDepleted": ("ARM9", 0x200D58D, 0x200D58D),
    "Touch": ("ARM9", 0x2035CB8, 0x2035CD0),
    "BackgroundVisible": ("ARM9", 0x2040588, 0x20405A0),
    "SubPlanes": ("ARM9", 0x20435F4, 0x204360C),
    "NativeButtonInput": ("ARM9", 0x2051C88, 0x2051CA0),
    "ActorPalette": ("ARM9", 0x204B6F4, 0x204B70C),
    "NetworkPosition": ("ARM9", 0x203D88C, 0x203D8A4),
    "ArchiveSize": ("ARM9", 0x20493D4, 0x20493EC),
    "Init": ("21", 0x21A0FE9, 0x21A1009),
    "Update": ("21", 0x21A10E1, 0x21A1101),
    "Exit": ("21", 0x21A10C1, 0x21A10E1),
    "Event": ("21", 0x21A1139, 0x21A1159),
    "NoGearInit": ("21", 0x21A1145, 0x21A1165),
    "GearDispose": ("29", 0x21F26E1, 0x21F2701),
    "GearTouch": ("29", 0x21F1759, 0x21F1779),
    "GearIdle": ("29", 0x21F2181, 0x21F21A1),
    "GearSleep": ("29", 0x21F2DA9, 0x21F2DC9),
    "FieldHeap": ("21", 0x2188C85, 0x2188CA5),
    "FieldMessage": ("21", 0x2188C55, 0x2188C75),
    "FieldEncounter": ("21", 0x2188CE9, 0x2188D09),
    "FieldController": ("21", 0x2188CFD, 0x2188D1D),
    "Phenomenon": ("21", 0x21AA80D, 0x21AA82D),
    "PhenomenonInterval": ("21", 0x21AABC5, 0x21AABE5),
    "Script": ("10", 0x2158769, 0x2158789),
    "Application": ("10", 0x216075D, 0x216077D),
    "TownMapReturn": ("10", 0x2161281, 0x21612A1),
    "ItemCheck": ("10", 0x21644C5, 0x21644E5),
    "ItemEvent": ("10", 0x21644F5, 0x2164515),
    "FlyInit": ("10", 0x215E841, 0x215E861),
    "FlyCheck": ("10", 0x215EC6D, 0x215EC8D),
    "FlyUse": ("10", 0x215EA39, 0x215EA59),
    "Report": ("10", 0x2169AB9, 0x2169AD9),
    "SubscreenChange": ("21", 0x21A0F31, 0x21A0F51),
    "SubscreenReady": ("21", 0x21A0ED5, 0x21A0EF5),
}
# Reuse sprite/library APIs already independently audited by the BW1 toolbar.
SHARED = {
    "VBlank": 0x20056FC,
    "Sound": 0x2006254,
    "HasItem": 0x2008474,
    "Flag": 0x20191D8,
    "GetMon": 0x201FF34,
    "PartyCount": 0x201FE24,
    "MonGet": 0x201CD24,
    "HeapFree": 0x2039F8C,
    "HeapLargest": 0x2039FBC,
    "Alloc": 0x203A228,
    "Free": 0x203A278,
    "TaskDelete": 0x203A6D4,
    "VramInvalid": 0x203CB14,
    "Keys": 0x203DF4C,
    "ArchiveInit": 0x204AAC8,
    "ArchiveClose": 0x204AB38,
    "ArchiveRead": 0x204AB48,
    "PaletteLoad": 0x204BBCC,
    "PaletteDelete": 0x204BCFC,
    "PaletteUpload": 0x204BD3C,
    "AnimationLoad": 0x204BE0C,
    "AnimationDelete": 0x204BE90,
    "UnitCreate": 0x204BF48,
    "CharCreate": 0x204B8E8,
    "CharDelete": 0x204B9B8,
    "CharUpload": 0x204BA6C,
    "ActorCreate": 0x204C06C,
    "ActorDelete": 0x204C134,
    "ActorVisible": 0x204C150,
    "ActorPlace": 0x204C16C,
    "ActorAnimate": 0x204C54C,
    "FileInit": 0x2070CA8,
    "FileOpen": 0x2070ECC,
}
for name, ref in SHARED.items():
    FUNCTIONS[name] = ("ARM9", *party.BINDINGS[ref])

# Calls have explicit sites and targets in each game, including ARM BLX.
CALLS = [
    ("QaInput", 29, 0x21F2136, 0x21F2156, "NativeButtonInput", ""),
    ("QaGearUnit", 29, 0x21F1E12, 0x21F1E32, "UnitCreate", ""),
    ("QaGearEnd", 29, 0x21F2988, 0x21F29A8, "GearDispose", ""),
    ("QaGearEnd", 29, 0x21F29B0, 0x21F29D0, "GearDispose", ""),
    ("QaRepelStep", 21, 0x218AC5C, 0x218AC7C, "RepelStep", "adds r1,r4,#0"),
    ("QaRepelDepleted", 21, 0x21A9420, 0x21A9440, "RepelDepleted", "adds r1,r4,#0"),
    ("QaPhenomenonInterval", 21, 0x21AA8A4, 0x21AA8C4, "PhenomenonInterval", ""),
    ("QaPhenomenonChance", 21, 0x21AA8B0, 0x21AA8D0, "Random", ""),
]
WORDS = [
    ("QaCGearInit", 21, 0x21D872C, 0x21D8744, "Init"),
    ("QaCGearUpdate", 21, 0x21D8730, 0x21D8748, "Update"),
    ("QaCGearEvent", 21, 0x21D8738, 0x21D8750, "Event"),
    ("QaCGearExit", 21, 0x21D873C, 0x21D8754, "Exit"),
    ("QaNoGearInit", 21, 0x21D87B8, 0x21D87D0, "NoGearInit"),
    ("QaTownMapReturn", 10, 0x2171380, 0x21713A0, "TownMapReturn"),
]


def rom_path(game):
    default = (
        WS / "cleanblack.nds" if game == "B" else Path.home() / "Downloads/cleanroms/cleanwhite.nds"
    )
    return Path(os.environ.get(f"QUICK_ACTIONS_{game}_ROM", default))


def configure(game):
    index = 1 if game == "B" else 2
    rom = ndspy.rom.NintendoDSRom.fromFile(str(rom_path(game)))
    assert rom.idCode == (b"IRBO" if game == "B" else b"IRAO") and rom.version == 0
    overlays = rom.loadArm9Overlays([10, 21, 29])
    arm = ndspy.codeCompression.decompress(rom.arm9)
    signatures = []

    def pin(label, module, address, length, patch=0):
        base = rom.arm9RamAddress if module == "ARM9" else overlays[int(module)].ramAddress
        data = arm if module == "ARM9" else overlays[int(module)].data
        out = bytes(data[address - base : address - base + length])
        assert len(out) == length
        signatures.append(
            {
                "label": label,
                "module": str(module),
                "address": address,
                "expectedHex": out.hex(),
                "patchSize": patch,
            }
        )
        return out

    for name, row in FUNCTIONS.items():
        pin("Native " + name, row[0], row[index] & ~1, 32)
    assert pin("Reserved save block size", "ARM9", 0x200ED38, 4) == bytes.fromhex("fc207047")
    assert pin("Reserved save block getter", "ARM9", 0x200ED48, 12)[0:6] == bytes.fromhex(
        "014b44211847"
    )
    script = ndspy.narc.NARC(rom.files[rom.filenames.idOf("a/0/5/7")]).files[868]
    assert (
        hashlib.sha256(script).hexdigest()
        == "6df48b0926233422b88e6bf0a62f1b42b36fcc786b59f6332e420910027903ed"
    )
    assert script[0x2EE:0x2F4] == bytes.fromhex("280027800000")
    for label, module, black, white, target, prep in CALLS:
        address = black if game == "B" else white
        raw = pin(label, module, address, 4, 4)
        x, y = struct.unpack("<HH", raw)
        assert x & 0xF800 == 0xF000 and y & 0xE800 == 0xE800, (label, raw.hex())
        delta = ((x & 2047) << 12) | ((y & 2047) << 1)
        if delta & 0x400000:
            delta -= 0x800000
        actual = address + 4 + delta
        if y & 0xF800 == 0xE800:
            actual &= ~3
        assert actual == FUNCTIONS[target][index] & ~1, (
            game,
            label,
            hex(address),
            hex(actual),
            hex(FUNCTIONS[target][index]),
        )
    for label, module, black, white, target in WORDS:
        address = black if game == "B" else white
        assert (
            struct.unpack("<I", pin(label, module, address, 4, 4))[0] == FUNCTIONS[target][index]
        ), (game, label, hex(address))
    # Pin the complete request initializer, dispatch tables, generator and
    # C-Gear work initialization, not just each function's prologue.
    for label, module, black, white, length in [
        ("Subscreen visibility cache synchronization", "ARM9", 0x20435F4, 0x204360C, 40),
        ("Application request ownership", 10, 0x216075C, 0x216077C, 148),
        ("Native field item dispatch", 10, 0x21714DC, 0x21714FC, 88),
        ("C-Gear work layout", 29, 0x21F251C, 0x21F253C, 452),
        ("Native phenomenon generator", 21, 0x21AA80C, 0x21AA82C, 0x108),
        ("Native PC script mapping", 10, 0x21702D4, 0x21702F4, 10),
        ("Native script VM ownership and instruction pointer", 10, 0x2158BFC, 0x2158C1C, 0xB8),
    ]:
        pin(label, module, black if game == "B" else white, length)
    profile = {
        "idCode": rom.idCode.decode(),
        "revision": 0,
        "fileName": f"CGearQuickActions{game}.dll",
        "signatures": signatures,
        "functions": {n: {"module": v[0], "entry": v[index]} for n, v in FUNCTIONS.items()},
        "nativeArchive": "a/0/3/0",
        "maxSaveFlag": 2911,
        "saveRecord": {"block": 68, "offset": 164, "size": 48},
        "sourceHashes": {
            "ARM9": hashlib.sha256(arm).hexdigest(),
            **{str(k): hashlib.sha256(v.data).hexdigest() for k, v in overlays.items()},
        },
    }
    return rom, profile


def header():
    out = ["#pragma once", "namespace Native {"]
    for name, (_, black, white) in FUNCTIONS.items():
        out += [
            f"#ifdef GAME_B",
            f"constexpr u32 {name}=0x{black:x};",
            "#else",
            f"constexpr u32 {name}=0x{white:x};",
            "#endif",
        ]
    out += [
        "#ifdef GAME_B",
        "constexpr u32 SpriteSystem=0x2146a74;",
        "#else",
        "constexpr u32 SpriteSystem=0x2146a94;",
        "#endif",
        "}",
    ]
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    for game in ("B", "W"):
        rom, profile = configure(game)
        (HERE / f"profile-{game}.json").write_text(json.dumps(profile, indent=2) + "\n")
        print(game, "retail hook signatures verified")

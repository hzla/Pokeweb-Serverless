"""Build separately checked English B2/W2 PMC modules and their private archive."""

import hashlib, json, os, struct, subprocess
from pathlib import Path
import ndspy.rom, ndspy.codeCompression

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WS = REPO.parent
BUILD = HERE / "build"
ASSETS = REPO / "src/assets/codeinjection"
TOOLS = Path(
    os.environ.get(
        "ARM_TOOLCHAIN_BIN",
        WS / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin",
    )
)
JAR = Path(os.environ.get("RPM_TOOL_JAR", WS / "White2Upgrade/CTRMap.jar"))
VERSION = "0.5.6"
# Every native import is an explicit US address. No reference source is a build
# dependency. Verified early getters share addresses; the saved flag helper
# and the later imported helpers differ by 44.
APIS = [
    0x2048828, 0x2048800, 0x2048788, 0x204A960, 0x20136C0,
    0x204BBE4, 0x2026548, 0x2026AC0, 0x20228B4, 0x2021D54,
    0x200C9BC, 0x2008538, 0x2008238, 0x2008268, 0x200842C, 0x20095A0,
    0x2016A98,
    0x204AC84,
    0x2042F58,
    0x20098D0,
    0x2026E90,
    0x20450AC,
    0x204534C,
    0x2045080,
    0x2045698,
    0x2044FBC,
    0x20056FC,
    0x2006254,
    0x2008474,
    0x2008DDC,
    0x20098C0,
    0x2009918,
    0x200DDB8,
    0x200DDE0,
    0x200C97C,
    0x2013878,
    0x20174A4,
    0x2017974,
    0x2016AD8,
    0x2016AF0,
    0x2016CB4,
    0x2016D68,
    0x2016ED8,
    0x2016EDC,
    0x20171F4,
    0x2017354,
    0x201735C,
    0x2017394,
    0x20175A4,
    0x20175E4,
    0x2017934,
    0x20191D8,
    0x201CD24,
    0x201FE24,
    0x201FF34,
    0x2039F8C,
    0x2039FBC,
    0x203A228,
    0x203A278,
    0x203A6D4,
    0x203CB14,
    0x203DA74,
    0x203DAB0,
    0x203DF4C,
    0x204AAC8,
    0x204AB38,
    0x204AB48,
    0x204AC38,
    0x204B8E8,
    0x204B9B8,
    0x204BA6C,
    0x204BBCC,
    0x204BCFC,
    0x204BD3C,
    0x204BE0C,
    0x204BE90,
    0x204BF48,
    0x204C06C,
    0x204C134,
    0x204C150,
    0x204C16C,
    0x204C4E4,
    0x204C530,
    0x204C54C,
    0x2070CA8,
    0x2070ECC,
    0x200D184,
    0x200D660,
    0x2039DC8,
    0x2070DEC,
    0x2070E54,
    0x2070E6C,
    0x2070DE0,
]
NATIVE = {
    12: [
        0x21551C4, 0x2153F60,
        0x21536AC,
        0x2159270,
        0x2159460,
        0x21596C4,
        0x2163B78,
        0x215B4C8,
        0x215C038,
        0x215EFF4,
        0x215F024,
    ],
    36: [
        0x21A85BC, 0x21ABBB0, 0x21AC0D4, 0x21AC374, 0x21AD08C,
        0x21ACEA4, 0x21ACEE0, 0x21AC3B0, 0x21AD724, 0x21AC6A0, 0x21AC110, 0x21AD510, 0x21AD5A0,
        0x2180518,
        0x21804D0,
        0x2180564,
        0x2180578,
        0x21A16E8,
        0x21A20AC,
        0x21A24AC,
        0x21983DC,
        0x21984AC,
        0x2180500,
        0x218130C,
        0x21983EC,
        0x2198564,
        0x219863C,
        0x219865C,
        0x21986B4,
        0x21986C0,
    ],
    79: [0x21EB730, 0x21EB748, 0x21EB894, 0x21EC808, 0x21EC9CC, 0x21ED2E0],
}
CALLS = [
    ("QaShopUnit", 36, 0x21ACEAE, 0x204BF48, ""),
    ("QaShopGraphics", 36, 0x21AC058, 0x21ACEA4, ""),
    ("QaShopGraphicsEnd", 36, 0x21AC5FE, 0x21ACEE0, ""),
    ("QaShopBalanceText", 36, 0x21AD16E, 0x2021D54, ""),
    ("QaShopStockFile", 36, 0x21AC794, 0x204A960, ""),
    ("QaShopStockFile", 36, 0x21AC7BC, 0x204A960, ""),
    ("QaShopLabel", 36, 0x21AC80A, 0x21AC6A0, ""),
    ("QaShopSelect", 36, 0x21AC2F8, 0x21AC110, ""),
    ("QaShopPrice", 36, 0x21AC81E, 0x20136C0, ""),
    ("QaShopMessageBank", 36, 0x21ACA64, 0x2048788, ""),
    ("QaShopBalance", 36, 0x21AC114, 0x21AC0D4, ""),
    ("QaShopBalance", 36, 0x21AC214, 0x21AC0D4, ""),
    ("QaShopMoney", 36, 0x21AD126, 0x200C9BC, ""),
    ("QaShopPay", 36, 0x21AC562, 0x21AC374, ""),
    ("QaShopAdd", 36, 0x21AC576, 0x2008268, ""),
    ("QaShopTick", 36, 0x21ABE1E, 0x21AC3B0, ""),
    ("QaInput", 79, 0x21EC980, 0x21EB894, ""),
    ("QaButtonHit", 79, 0x21EB8C8, 0x21EB748, ""),
    ("QaGearUnit", 79, 0x21EC740, 0x204BF48, ""),
    ("QaGearEnd", 79, 0x21ECE42, 0x21EC808, ""),
    ("QaRepelStep", 36, 0x21824BC, 0x200DDB8, "adds r1,r7,#0"),
    ("QaRepelDepleted", 36, 0x21A0B2C, 0x200DDE0, "adds r1,r4,#0"),
    ("QaPhenomenonInterval", 36, 0x21A2164, 0x21A24AC, ""),
    ("QaPhenomenonChance", 36, 0x21A2170, 0x2013878, ""),
]
WORDS = [
    ("QaShopRowPrice", 36, 0x21AD4BC, 0x21AD511),
    ("QaShopTmRowPrice", 36, 0x21AD4C0, 0x21AD5A1),
    ("QaShopChoiceAdd", 12, 0x216B834, 0x21A85BD),
    ("QaShopBuyCommand", 12, 0x216BA9C, 0x21ABBB1),
    ("QaCGearInit", 36, 0x21CFA10, 0x2198565),
    ("QaCGearUpdate", 36, 0x21CFA14, 0x219865D),
    ("QaCGearEvent", 36, 0x21CFA1C, 0x21986B5),
    ("QaCGearExit", 36, 0x21CFA20, 0x219863D),
    ("QaNoGearInit", 36, 0x21CFA9C, 0x21986C1),
    ("QaTownMapReturn", 12, 0x216CCA4, 0x215C039),
]
RETAIL_HASHES = {
    "W2": {
        "ARM9": "013f8943fa632b0803451bb341473b44915a1756edaf3f9d2d18116822727c21",
        "12": "4086a96335723d80eba824fadd689d1f46a90d39992639b8d102ab4b7d66725b",
        "36": "ddd209a6bf958685d0311b49c3c6a575787c2cefbe35cbce8acf2760acdeaf08",
        "79": "c0c65423f1ed097347a0c9a58916cca997a76adfcfd5e566dd44b9205a0994a4",
    },
    "B2": {
        "ARM9": "03b2e68d7ebc98f4c2d2e78d41d1ef85647f041a096ed65f3fe342e08859e92d",
        "12": "7a3f4df4c7ce8b09194a95afbbf2a0f185560bf853ef1545f89d330c57a7ade0",
        "36": "21fa0a20eefb8234f66a2e786bb0ee0eb5b07bf3d440c0e37d09961b6184fadb",
        "79": "01357a95204975214935b7a95944751c38459c1ee4962f7a08e54a77be028c50",
    },
}


def run(*args):
    subprocess.run([str(a) for a in args], check=True)


def bl_target(b, a):
    x, y = struct.unpack("<HH", b)
    assert x & 0xF800 == 0xF000 and y & 0xF800 == 0xF800
    d = ((x & 2047) << 12) | ((y & 2047) << 1)
    return a + 4 + (d - 0x800000 if d & 0x400000 else d)


def main():
    BUILD.mkdir(exist_ok=True)
    run(REPO / "node_modules/.bin/vite-node", REPO / "scripts/generate-system-shop-bindings.ts")
    dial = json.loads((REPO / "src/cgearButtons/dial.json").read_text())
    (BUILD / "dial.generated.h").write_text(
        "#pragma once\nnamespace dial {\n"
        + "".join(f"constexpr int {k}={v};\n" for k, v in dial.items() if k != "atan")
        + "constexpr u16 angles[]={"
        + ",".join(map(str, dial["atan"]))
        + "};\n}\n"
    )
    graphics_rom = ndspy.rom.NintendoDSRom.fromFile(
        os.environ.get("QUICK_ACTIONS_W2_ROM", WS / "cleanwhite2.nds")
    )
    run(
        REPO / "node_modules/.bin/vite-node",
        REPO / "scripts/generate-cgear-button-defaults.ts",
        os.environ.get("QUICK_ACTIONS_W2_ROM", WS / "cleanwhite2.nds"),
    )
    arc = __import__("ndspy.narc", fromlist=["NARC"]).NARC(
        (ASSETS / "cgearQuickActions.narc").read_bytes()
    )
    fnv = 0x811C9DC5
    for b in b"".join(arc.files[1:12]):
        fnv = ((fnv ^ b) * 0x1000193) & 0xFFFFFFFF
    manifest = {
        "graphicsFingerprint": f"{fnv:08x}",
        "version": VERSION,
        "defaultPcHideFlag": 1517,
        "maxSaveFlag": 3059,
        "archivePath": "quick-actions/ui.narc",
        "archiveSha256": hashlib.sha256(
            (ASSETS / "cgearQuickActions.narc").read_bytes()
        ).hexdigest(),
        "previousVersions": json.loads((HERE / "previous.json").read_text()),
        "games": {},
    }
    script = (
        __import__("ndspy.narc", fromlist=["NARC"])
        .NARC(graphics_rom.files[graphics_rom.filenames.idOf("a/0/5/6")])
        .files[1244]
    )
    assert (
        hashlib.sha256(script).hexdigest()
        == "1e757aa8d2706a809fed4c08309481793820af82c3fbdf55cd614c966b995531"
    )
    pc_hash = 0x811C9DC5
    for b in script:
        pc_hash = ((pc_hash ^ b) * 0x1000193) & 0xFFFFFFFF
    manifest["pcScript"] = {
        "archive": "a/0/5/6",
        "member": 1244,
        "length": len(script),
        "fingerprint": f"{pc_hash:08x}",
    }
    (BUILD / "pc.generated.h").write_text(
        f"#pragma once\nconstexpr u32 PC_SCRIPT_SIZE={len(script)},PC_SCRIPT_HASH=0x{pc_hash:x};\n"
    )
    shop = (
        __import__("ndspy.narc", fromlist=["NARC"])
        .NARC(graphics_rom.files[graphics_rom.filenames.idOf("a/0/5/6")])
        .files[1247]
    )
    assert hashlib.sha256(shop).hexdigest() == "a6e348ad83826cc5ddb07e851122a52e597fdfac393ff8deca1503b4a27eece0"
    shop_hash = 0x811C9DC5
    for b in shop:
        shop_hash = ((shop_hash ^ b) * 0x1000193) & 0xFFFFFFFF
    manifest["shopScript"] = {
        "archive": "a/0/5/6", "member": 1247, "length": len(shop),
        "entry": 24, "fingerprint": f"{shop_hash:08x}",
    }
    manifest["shopInventory"] = {
        "archive": "a/2/8/2", "countsArchive": "a/2/8/3",
        "badgeRows": [0, 1, 1, 2, 2, 3, 3, 4, 5],
    }
    (BUILD / "shop.generated.h").write_text(
        f"#pragma once\nconstexpr u32 SHOP_SCRIPT_SIZE={len(shop)},"
        f"SHOP_SCRIPT_ENTRY=24,SHOP_SCRIPT_HASH=0x{shop_hash:x};\n"
    )
    profiles = [
        "#pragma once",
        "inline u32 nativeAddress(u32 a) {",
        "#ifdef GAME_B2",
        "switch(a) {",
    ]
    profiles += [f"case 0x{a:x}: return 0x{a-(0x2c if a>=0x20191d8 else 0):x};" for a in APIS]
    profiles += [
        "case 0x214197c: return 0x214193c;",
        "default: __builtin_trap();",
        "}",
        "#else",
        "return a;",
        "#endif",
        "}",
        "inline u32 overlayAddress(u32 a) {",
        "#ifdef GAME_B2",
        "return a-0x40;",
        "#else",
        "return a;",
        "#endif",
        "}",
    ]
    (BUILD / "profiles.generated.h").write_text("\n".join(profiles) + "\n")
    reference = {}
    for game, name, delta in [("W2", "cleanwhite2.nds", 0), ("B2", "cleanblack2.nds", 64)]:
        rom = ndspy.rom.NintendoDSRom.fromFile(
            os.environ.get(f"QUICK_ACTIONS_{game}_ROM", WS / name)
        )
        assert bytes(rom.idCode) == (b"IRDO" if game == "W2" else b"IREO") and rom.version == 0
        overlays = rom.loadArm9Overlays(NATIVE.keys())
        arm = ndspy.codeCompression.decompress(rom.arm9)
        for module, expected in RETAIL_HASHES[game].items():
            data = arm if module == "ARM9" else bytes(overlays[int(module)].data)
            assert (
                hashlib.sha256(data).hexdigest() == expected
            ), f"{game} retail {module} source hash differs"
        signatures = []
        asm = [".syntax unified", ".thumb"]

        def signature(label, module, address, length, patch=0):
            base = rom.arm9RamAddress if module == "ARM9" else overlays[int(module)].ramAddress
            data = arm if module == "ARM9" else overlays[int(module)].data
            b = bytes(data[address - base : address - base + length])
            assert len(b) == length
            signatures.append(
                {
                    "label": label,
                    "module": str(module),
                    "address": address,
                    "expectedHex": b.hex(),
                    "patchSize": patch,
                }
            )
            return b

        for label, mod, a, target, prep in CALLS:
            a -= delta
            t = target - (
                delta
                if target >= 0x2150000
                else (44 if game == "B2" and target >= 0x201C000 else 0)
            )
            assert bl_target(signature(label, mod, a, 4, 4), a) == t, (game, label, hex(a))
            sym = f"THUMB_BRANCH_LINK_{mod}_0x{a:x}"
            asm += [
                ".balign 4",
                f".global {sym}",
                f".type {sym},%function",
                ".thumb_func",
                sym + ":",
            ]
            if prep:
                asm.append(prep)
            asm += [
                "push {r3}",
                "ldr r3,1f",
                "mov ip,r3",
                "pop {r3}",
                "bx ip",
                ".balign 4",
                f"1: .word {label}",
                f".size {sym},.-{sym}",
            ]
        for label, mod, a, value in WORDS:
            a -= 52 if game == "B2" and mod == 36 and not label.startswith("QaShop") else delta
            expected = value - delta
            assert struct.unpack("<I", signature(label, mod, a, 4, 4))[0] == expected, (
                game,
                label,
                hex(a),
            )
            sym = f"FULL_COPY_{mod}_0x{a:x}"
            asm += [
                ".balign 4",
                f".global {sym}",
                f".type {sym},%object",
                sym + ":",
                f".word {label}",
                f".size {sym},4",
            ]
        for a in APIS:
            address = a - (44 if game == "B2" and a >= 0x20191D8 else 0)
            b = signature("Native API", "ARM9", address, 8)
            # PC-relative loads/BLs may encode different offsets while the ABI
            # remains the same. Preserve independent signatures for each game.
            if game == "W2":
                reference[a] = b
        for a in [
            0x2005336,
            0x2005E02,
            0x2005E62,
            0x2005EB0,
            0x2005FA2,
            0x206DC84 - (44 if game == "B2" else 0),
        ]:
            signature("Shared music runtime hook", "ARM9", a, 4)
        assert struct.unpack(
            "<I",
            signature(
                "Native graphics system pointer", "ARM9", 0x204B9A8 - (44 if game == "B2" else 0), 4
            ),
        )[0] == (0x214193C if game == "B2" else 0x214197C)
        for mod, addresses in NATIVE.items():
            for a in addresses:
                signature("Native field ABI", mod, a - delta, 12)
        signature(
            "Pokenav PK5 shell decrypt flags", "ARM9", 0x201CCC4 - (44 if game == "B2" else 0), 0x60
        )
        signature("Pokenav encounter owner/data layout", 36, 0x21A1680 - delta, 0x50)
        signature("Pokenav active seasonal encounter buffer", 12, 0x215CF70 - delta, 4)
        signature("Pokenav seasonal table loader", 12, 0x215912C - delta, 0x94)
        signature("Native phenomenon generator", 36, 0x21A20AC - delta, 0x108)
        signature("Native phenomenon tile search", 36, 0x21A25C4 - delta, 0x168)
        signature("Native phenomenon effect setup", 36, 0x21A272C - delta, 0xA0)
        signature("Native save request layout", 12, 0x215C538 - delta, 80)
        signature("Native script event/VM ownership layout", 12, 0x2153864 - delta, 0x58)
        signature("Native script VM entry/data layout", 12, 0x2153BEC - delta, 0x68)
        assert signature(
            "Native PC script archive mapping", 12, 0x216B190 - delta, 10
        ) == struct.pack("<5H", 10090, 10099, 1244, 3, 479)
        pc = (
            __import__("ndspy.narc", fromlist=["NARC"])
            .NARC(rom.files[rom.filenames.idOf("a/0/5/6")])
            .files[1244]
        )
        assert pc == script, f"{game} native storage script differs"
        native_shop = __import__("ndspy.narc", fromlist=["NARC"]).NARC(
            rom.files[rom.filenames.idOf("a/0/5/6")]
        ).files[1247]
        assert native_shop == shop, f"{game} native shop script differs"
        assert signature("Native shop script archive mapping", 12, 0x216B172 - delta, 10) == struct.pack("<5H", 10110, 10119, 1247, 3, 614)
        assert signature("Native Buy script command", 12, 0x216BA9C - delta, 4) == struct.pack("<I", 0x21ABBB1 - delta)
        signature("Native shop constructor, owned context and completion", 36, 0x21ABBB0 - delta, 0x3DC)
        signature("Native shop initialization and purchase checks", 36, 0x21ABF8C - delta, 0x424)
        signature("Native Buy state machine and cleanup", 36, 0x21AC3B0 - delta, 0x3B4)
        signature("Native shop stock loading", 36, 0x21AC764 - delta, 0x258)
        signature("Native shop resource ownership", 36, 0x21ACA54 - delta, 0xE4)
        assert signature("Native general-store badge tiers", 36, 0x21D0970 - (52 if game == "B2" else 0), 9) == bytes(manifest["shopInventory"]["badgeRows"])
        signature("Native event allocation and destruction layout", "ARM9", 0x2016CB4, 0x6C)
        signature("Native badge count and money access", "ARM9", 0x200C9A0, 0x40)
        signature("Native item price accessor", "ARM9", 0x20136C0, 0x18)
        signature("Native shop item-data loading", "ARM9", 0x202681C - (44 if game == "B2" else 0), 0x30)
        signature("Native item icon table pointer", "ARM9", 0x202672C - (44 if game == "B2" else 0), 4)
        signature("Native bag pocket getter and pointer", "ARM9", 0x20088F0, 12)
        signature("Native bag add/remove ownership", "ARM9", 0x2008238, 0x240)
        signature("Native TM name, move and owned renderer", 36, 0x21AC678 - delta, 0xEC)
        signature("Native shop balance/price renderers", 36, 0x21AD08C - delta, 0x610)
        signature("Native shop message formatting", 36, 0x21AD724 - delta, 0x1E0)
        signature("Native text object ownership", "ARM9", 0x2048788 - (44 if game == "B2" else 0), 0x24C)
        signature("Native field choice ownership", 12, 0x215534C - delta, 0xE8)
        assert (
            bl_target(
                signature("Native menu selection sound", 36, 0x219FE14 - delta, 4),
                0x219FE14 - delta,
            )
            == 0x2006254
        )
        assert signature("Native menu selection sound ID", 36, 0x219FE90 - delta, 4) == struct.pack(
            "<I", 1356
        )
        signature("Native save prompt state machine", 12, 0x2163B78 - delta, 864)
        assert signature("Native save message getter", 36, 0x21804D0 - delta, 4) == bytes.fromhex(
            "806a7047"
        )
        assert signature("Native deferred subscreen change", 36, 0x21984AC - delta, 16)[
            8:14
        ] == bytes.fromhex("60600120a060")
        signature("Native key-item event dispatch table", 12, 0x216CE24 - delta, 48)
        signature("Native key-item eligibility table", 12, 0x216CE54 - delta, 48)
        signature("C-Gear save block size", "ARM9", 0x2009890, 4)
        signature("C-Gear decal loader and palette routing", 79, 0x21ECA94 - delta, 0xC8)
        signature("C-Gear decal VRAM layout", 79, 0x21EB6BC - delta, 0x70)
        signature("C-Gear display-only upper-right touch circle", 79, 0x21EB894 - delta, 64)
        assert signature(
            "C-Gear native panel actor layout", 79, 0x21EBBAC - delta, 12
        ) == bytes.fromhex("49000d3189004018c06e111c")
        signature("C-Gear touch control IDs", 79, 0x21EB748 - delta, 0x70)
        assert bl_target(
            signature("Native selector actor/frame setter", 79, 0x21EC96E - delta, 10)[6:10],
            0x21EC974 - delta,
        ) == 0x204C530 - (44 if game == "B2" else 0)
        signature("Native selector actor index", 79, 0x21EC92E - delta, 6)
        assert bl_target(
            signature("C-Gear network icon position", 79, 0x21EB56A - delta, 4), 0x21EB56A - delta
        ) == 0x2042F58 - (44 if game == "B2" else 0)
        signature("C-Gear ring colour layout", 79, 0x21EB3E4 - delta, 28)
        signature("C-Gear delayed dimming layout", 79, 0x21ED290 - delta, 48)
        assert signature("C-Gear dimming colours", 79, 0x21ED834 - delta, 4) == struct.pack(
            "<HH", 0x0441, 0x0423
        )
        signature("C-Gear save initialization", "ARM9", 0x2009890, 44)
        signature("C-Gear save accessors", "ARM9", 0x20098BC, 104)
        signature("Options initialization and accessors", "ARM9", 0x20089C0, 0x144)
        signature(
            "Saved event flag accessor layout", "ARM9", 0x2019278 - (44 if game == "B2" else 0), 68
        )
        assert signature("Native trainer flag range", 12, 0x2155078 - delta, 6) == bytes.fromhex(
            "5f2212018918"
        )
        # The default lies in the gap between item flags and trainer flags.
        # Neither retail script data nor entity data contains this operand.
        for path in ["a/0/5/6", "a/1/2/6"]:
            arc = __import__("ndspy.narc", fromlist=["NARC"]).NARC(
                rom.files[rom.filenames.idOf(path)]
            )
            assert not any(struct.pack("<H", 1517) in b for b in arc.files), (
                game,
                path,
                "default PC flag is referenced",
            )
        stem = f"CGearQuickActions{game}"
        source = BUILD / f"{stem}.s"
        source.write_text("\n".join(asm) + "\n")
        run(
            TOOLS / "arm-none-eabi-g++",
            "-std=c++17",
            "-mthumb",
            "-march=armv5t",
            "-mlong-calls",
            "-Os",
            "-Wall",
            "-Wextra",
            "-Werror",
            "-fno-jump-tables",
            "-fvisibility=hidden",
            "-fno-exceptions",
            "-fno-rtti",
            "-fno-unwind-tables",
            "-fno-asynchronous-unwind-tables",
            "-ffreestanding",
            "-fno-builtin",
            f"-DGAME_{game}",
            "-I",
            BUILD,
            "-c",
            HERE / "quick_actions.cpp",
            "-o",
            BUILD / f"{stem}.o",
        )
        run(
            TOOLS / "arm-none-eabi-as",
            "-mthumb",
            "-march=armv5t",
            source,
            "-o",
            BUILD / f"{stem}Hooks.o",
        )
        extra = []
        for item in [
            HERE.parent / "nuzlocke-encounters/runtime.cpp",
            HERE.parent / "learnset-viewer/memory.cpp",
        ]:
            obj = BUILD / f"{item.stem}{game}.o"
            extra.append(obj)
            run(
                TOOLS / "arm-none-eabi-g++",
                "-std=c++17",
                "-mthumb",
                "-march=armv5t",
                "-mlong-calls",
                "-Os",
                "-Wall",
                "-Wextra",
                "-Werror",
                "-fno-exceptions",
                "-fno-rtti",
                "-fno-unwind-tables",
                "-fno-asynchronous-unwind-tables",
                "-ffreestanding",
                "-fno-builtin",
                "-fvisibility=hidden",
                f"-DGAME_{game}",
                "-c",
                item,
                "-o",
                obj,
            )
        elf = BUILD / f"{stem}.elf"
        run(
            TOOLS / "arm-none-eabi-g++",
            "-nostdlib",
            "-Wl,-r",
            BUILD / f"{stem}.o",
            BUILD / f"{stem}Hooks.o",
            *extra,
            "-o",
            elf,
        )
        assert subprocess.check_output(
            [str(TOOLS / "arm-none-eabi-nm"), "-u", str(elf)]
        ).decode().split() == ["U", "PokewebBgmMute"]
        meta = BUILD / "metadata.yml"
        meta.write_text(f"PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {VERSION}\n")
        esdb = BUILD / "symbols.yml"
        esdb.write_text("Segments:\n  - ID: 0\n    Name: ARM9\n    Type: EXECUTABLE\nSymbols: []\n")
        dll = ASSETS / f"{stem}.dll"
        run(
            "java",
            "-cp",
            JAR,
            "rpm.cli.RPMTool",
            "-i",
            elf,
            "--fourcc",
            "DLXF",
            "-o",
            dll,
            "--esdb",
            esdb,
            "--meta",
            meta,
            "--generate-relocations",
            "--strip",
        )
        blob = dll.read_bytes()
        h = struct.unpack_from("<I", blob, 8)[0]
        info = h + struct.unpack_from("<I", blob, h + 8)[0]
        start, size = struct.unpack_from("<II", blob, info + 16)
        code = blob[start : start + size]
        fnv = 0x811C9DC5
        for b in code:
            fnv = ((fnv ^ b) * 0x1000193) & 0xFFFFFFFF
        manifest["games"][game] = {
            "idCode": bytes(rom.idCode).decode(),
            "revision": 0,
            "fileName": dll.name,
            "sha256": hashlib.sha256(blob).hexdigest(),
            "codeFingerprint": f"{fnv:08x}",
            "bssSize": struct.unpack_from("<I", blob, h + 12)[0],
            "signatures": signatures,
        }
        print(dll.name, len(blob), "bytes; code", size)
    (ASSETS / "cgearQuickActionsManifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()

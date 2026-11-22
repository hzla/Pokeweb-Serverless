"""Build the standalone US Gen V PMC modules and tab art."""
import hashlib
import json
import os
import struct
import sys
from pathlib import Path

import ndspy.codeCompression
import ndspy.narc
import ndspy.rom

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ASSETS = ROOT / "src/assets/codeinjection"
VERSION = "1.0.3"
PREVIOUS_RUNTIMES = {
    "B2": [
        {"sha256": "2929a1fb006e2ec83fc71c026096359492725f20d80e488c8947c644fa60c953", "size": 4672},
        {"sha256": "c2360c8796d800216473aa29960d839d0b5270c252311b8224fb9f9027285625", "size": 4864},
        {"sha256": "9a0c9b21742003b9b8048247b11870f41cceb14c5275912f2268819582a83236", "size": 4864},
    ],
    "W2": [
        {"sha256": "8fb18cba2164396b95b7aca78f13a437276239d2468944a7a234ca6dafb52e58", "size": 4672},
        {"sha256": "3b4073310ebcd5dbf3d3530909a41267c18aa9dc9d7c677a729a3652218270b1", "size": 4864},
        {"sha256": "0439afa8bf974b15b0a2fe1749a614a7ba6cb96e86b6207efac42dbf9519c2ff", "size": 4864},
    ],
    "B": [
        {"sha256": "289ec211a2064f1386b9a199152be167a4523b025b4236917c568c03d0a9f6a6", "size": 4832},
        {"sha256": "04bab512fd059e4912be108c331a26e0460ae5a2099b6c6238062f9a880f7dda", "size": 4832},
    ],
    "W": [
        {"sha256": "d0cf49df0685cad545a4a8318d972fdcac0d16aaa9791035ac95a78f370de8bd", "size": 4832},
        {"sha256": "8d3a715213dada5abfecfac2ed79fd7f04b4ee605d21c918fe74dc41a7f62beb", "size": 4832},
    ],
}
# SHA-256 of each older archive's ordered, concatenated member hashes.
PREVIOUS_ARCHIVE_MEMBER_DIGESTS = [
    "387ac8520043963447fb04e9f861cee3bf6e3ed0f2cdb5c4541475dbe13932a8",
    "ccfd4dd734f250b34a38b15466735b33ba06bc685d3fd1fb1751feaf01f354cc",
]
ACTOR_SYSTEM_POINTERS = {"B2": 0x0214193C, "W2": 0x0214197C}

sys.path.insert(0, str(HERE.parent / "item-expansion"))
import build as shared  # noqa: E402
import build_bw1 as bw1  # noqa: E402
import bw1_profile  # noqa: E402
from tab import BALLS, build_archive  # noqa: E402


class RetailCode:
    def __init__(self, rom):
        self.arm = ndspy.codeCompression.decompress(rom.arm9)
        self.regions = {"ARM9": (rom.arm9RamAddress, self.arm)}
        for segment, overlay in rom.loadArm9Overlays([167, 168, 169]).items():
            self.regions[str(segment)] = (overlay.ramAddress, overlay.data)

    def read(self, segment, address, size):
        base, binary = self.regions[segment]
        data = binary[address - base:address - base + size]
        assert len(data) == size, (segment, hex(address), size)
        return data


def build_modules(out, game, symbols, segments, battle_overlay, hooks, defines=()):
    battle = out / "quick_ball.o"
    session = out / "session.o"
    for source, obj in (("quick_ball.c", battle), ("session.c", session)):
        shared.run(shared.tool("arm-none-eabi-gcc"), *shared.CFLAGS, *defines, "-I", out,
                   "-c", HERE / source, "-o", obj)
    choice = "PokewebQuickBallChoice"
    battle_roots = [symbol for name, symbol in hooks.items() if name != "HOOK_NEW_SESSION"]
    battle_dll, battle_dump = shared.link_dll(out, f"QuickPokeBall{game}", [battle], battle_roots,
        symbols, segments, game, VERSION, [battle_overlay], imports=(choice,))
    session_dll, session_dump = shared.link_dll(out, f"QuickPokeBallSession{game}", [session],
        [hooks["HOOK_NEW_SESSION"]], symbols, ["ARM9"], game, VERSION, ["ARM9"], priority=3)
    return {**shared.describe(battle_dll, battle_dump, [], None),
            "session": shared.describe(session_dll, session_dump, [], None)}, [battle_dll, session_dll]


def build(game, cfg, rom):
    out = HERE / "build" / game
    out.mkdir(parents=True, exist_ok=True)
    symbols = shared.Symbols(cfg["pokebw2"])
    retail = RetailCode(rom)

    bindings = {
        "HOOK_POLL": ("167", "BattleClient_ActionSelectRoot", "BtlvCore_WaitCommandSelect"),
        "HOOK_STOP": ("167", "BattleClient_ActionSelectRoot", "BtlvCore_StopCommandSelect"),
        "HOOK_DELETE": ("167", "BtlMain_Cleanup", "BtlvCore_Delete"),
        "HOOK_DELETE_SKIP": ("167", "BtlMain_StartRecSkip", "BtlvCore_Delete"),
        "HOOK_NEW_SESSION": ("ARM9", "GameData_Create", "BagCursor_Create"),
    }
    hooks = {}
    signatures = []
    for name, (segment, caller, callee) in bindings.items():
        target = symbols.get(segment, callee)[0]
        site = shared.find_bl(symbols, retail, segment, caller, target)
        hooks[name] = shared.hook_name("THUMB_BRANCH_LINK", segment, site)
        signatures.append(dict(label=name, segment=segment, address=site, expectedHex=retail.read(segment, site, 4).hex()))

    # Overlay 169 runs from VRAM. The runtime identifies its command callback
    # by address and calls the screen-idle check through overlay 167.
    command_main = symbols.get("169", "BtlvScd_CommandMain")[0] | 1
    declarations = [f"#define {name} {symbol}" for name, symbol in hooks.items()]
    declarations += [f"#define COMMAND_MAIN {command_main:#x}u",
                     f"#define ACTOR_SYSTEM_POINTER {ACTOR_SYSTEM_POINTERS[game]:#x}u",
                     "#define BALL_IDS " + ", ".join(map(str, BALLS))]
    (out / "bindings.h").write_text("\n".join(declarations) + "\n")
    modules, dlls = build_modules(out, game, symbols, ["167", "168", "ARM9"], "167", hooks)

    checked = [
        ("167", "BattleClient_ActionSelectRoot"), ("167", "IsPokeBallTargetHiding"),
        ("167", "BattleClientCmd_StartItemSelect"), ("167", "BattleClient_ActionSelectItem"),
        ("167", "BtlvCore_WaitCommandSelect"), ("167", "BtlvCore_ProcCommandSelect"),
        ("167", "selItemWork_Reserve"), ("167", "BtlvCore_Delete"),
        ("169", "BtlvScd_RunProcs"), ("169", "BtlvScd_CommandMain"),
        ("168", "BtlvInput_IsBusy"), ("168", "BtlvInput_CheckInput"),
        ("168", "BtlvGauge_LoadResources"), ("168", "BtlvClact_AddActorEx"), ("168", "BtlvClact_InitGauge"),
    ]
    # Check the call sites separately from the read-only ABI signatures so the
    # installer can identify which native routines differ on an edited ROM.
    abi = []
    for segment, name in checked:
        address, _, _, size = symbols.get(segment, name)
        data = retail.read(segment, address, size)
        abi.append(dict(label=name, overlay=int(segment), address=address, sha256=hashlib.sha256(data).hexdigest(), size=size))
    return {**modules, "idCode": rom.idCode.decode(),
            "previousRuntimes": PREVIOUS_RUNTIMES[game],
            "hooks": signatures, "abi": abi}, dlls, build_archive(rom, retail.arm)


def build_bw1(game, inputs, black, rom):
    out = HERE / "build" / game
    out.mkdir(parents=True, exist_ok=True)
    hooks = {}
    signatures = []
    for name, (caller, callee) in bw1_profile.HOOKS.items():
        segment, site = bw1.find_bl(inputs, caller, callee)
        hooks[name] = shared.hook_name("THUMB_BRANCH_LINK", segment, site)
        expected = inputs.binaries.read(segment, site, 4)
        signatures.append(dict(label=name, segment=segment, address=site, expectedHex=expected.hex()))

    actor_pointer = bw1.data_address(black, inputs, "CLACT_InitSystem", 0x02146a74)
    command_main = inputs.symbols.get("BTLV_SCD_WaitActionTouchStep")[1]
    declarations = [f"#define {name} {symbol}" for name, symbol in {**hooks, **bw1_profile.NAMES}.items()]
    declarations += [f"#define COMMAND_MAIN {command_main:#x}u",
                     f"#define ACTOR_SYSTEM_POINTER {actor_pointer:#x}u",
                     "#define BALL_IDS " + ", ".join(map(str, BALLS))]
    (out / "bindings.h").write_text("\n".join(declarations) + "\n")
    # The retail unsigned divide returns the quotient in r0 and remainder in r1.
    inputs.symbols.funcs["_u32_div_f"] = inputs.symbols.get("_div_by_zero_check")
    modules, dlls = build_modules(out, game, bw1.Symbols(inputs, {}),
                                  [*bw1_profile.BATTLE_OVERLAYS, "ARM9"], "93", hooks, ("-DPW_BW1",))
    abi = []
    for name in bw1_profile.ABI:
        segment, address, code = inputs.code(name)
        abi.append(dict(label=name, overlay=int(segment), address=address,
                        sha256=hashlib.sha256(code).hexdigest(), size=len(code)))
    return {**modules, "idCode": rom.idCode.decode(),
            "previousRuntimes": PREVIOUS_RUNTIMES[game],
            "hooks": signatures, "abi": abi}, dlls, build_archive(rom, inputs.binaries.arm9)


def main():
    games = json.loads((HERE.parent / "item-expansion/games.json").read_text())["games"]
    artifacts = []
    profiles = {}
    archive = None
    for game, cfg in games.items():
        default = ROOT.parent / ("cleanwhite2.nds" if game == "W2" else "cleanblack2.nds")
        rom = ndspy.rom.NintendoDSRom.fromFile(os.environ.get(f"QUICK_POKE_BALL_{game}_ROM", default))
        assert rom.version == 0 and rom.idCode.decode() == cfg["idCode"]
        profiles[game], dlls, graphics = build(game, cfg, rom)
        assert archive is None or graphics == archive, "The retail battle Bag icons differ"
        archive = graphics
        artifacts.extend(dlls)
    black = bw1.Inputs("B")
    for game, id_code, filename in [("B", b"IRBO", "cleanblack.nds"), ("W", b"IRAO", "cleanwhite.nds")]:
        inputs = black if game == "B" else bw1.Inputs(game)
        rom = ndspy.rom.NintendoDSRom.fromFile(os.environ.get(f"BW1_ROM_{game}", ROOT.parent / filename))
        assert rom.version == 0 and rom.idCode == id_code
        profiles[game], dlls, graphics = build_bw1(game, inputs, black, rom)
        assert graphics == archive, "The retail battle Bag icons differ"
        artifacts.extend(dlls)
    (ASSETS / "quickPokeBall.narc").write_bytes(archive)
    for dll in artifacts:
        (ASSETS / dll.name).write_bytes(dll.read_bytes())
    manifest = dict(version=VERSION, archivePath="quick-poke-ball/tab.narc",
                    archiveSha256=hashlib.sha256(archive).hexdigest(),
                    archiveMembers=[hashlib.sha256(member).hexdigest() for member in ndspy.narc.NARC(archive).files],
                    previousArchiveMemberDigests=PREVIOUS_ARCHIVE_MEMBER_DIGESTS,
                    games=profiles)
    (ASSETS / "quickPokeBallManifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()

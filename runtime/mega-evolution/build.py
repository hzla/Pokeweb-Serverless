"""Build the Pokeweb Mega Evolution DLLs (Black 2 / White 2, Black / White).

    python3 runtime/mega-evolution/build.py [--game W2|B2|B|W] [--test] [--test-routes]

Uses the item expansion's toolchain helpers and inputs (POKEBW2_CONFIG symbol tables, POKEBW2_EXTRACT binaries,
ARM_TOOLCHAIN_BIN, RPM_TOOL_JAR). Every hook address comes from pokebw2's symbols and is checked against the retail
binaries (BL call sites are found by their target). Outputs (src/assets/codeinjection unless --test):
PokewebMega<game>.dll and megaEvolutionManifest.json (hooks, table offset).

Black / White (--game B / W) use the same source built with PW_BW1 (src/mega_bw1.h maps the retail calls to
aletheia's names) and the item expansion's Black / White inputs (ALETHEIA, BW1_ROM_B / BW1_ROM_W or
BW1_EXTRACT_B / BW1_EXTRACT_W; see runtime/item-expansion/build_bw1.py). The DLL loads with battle overlay 93.

--test-routes builds a DLL whose table already holds a test route (Rotom + Leftovers -> Heat Rotom), for the
emulator check without Pokeweb's installer.
"""
import argparse
import json
import struct
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "runtime/item-expansion"))
import build as items  # noqa: E402

CFLAGS = ["-std=gnu99", "-mthumb", "-mcpu=arm946e-s", "-Os", "-ffreestanding", "-fno-builtin", "-fno-short-enums",
          "-ffunction-sections", "-fdata-sections", "-fno-jump-tables", "-fno-unwind-tables",
          "-fno-asynchronous-unwind-tables", "-Wall", "-Wextra", "-Wno-unused-parameter", "-Werror"]
SEGMENTS = ["167", "168", "169", "ARM9"]
BW1_SEGMENTS = ["93", "94", "95", "ARM9"]
TABLE_TAG = struct.pack("<I", 0x474D5750)  # "PWMG"


def build_game(game, cfg, version, out_root, test_routes):
    symbols = items.Symbols(cfg["pokebw2"])
    binaries = items.Binaries(cfg)
    out = out_root / game
    out.mkdir(parents=True, exist_ok=True)

    def addr(name, segment="167"):
        return symbols.get(segment, name)[0]

    def bl(function, target):
        return items.find_bl(symbols, binaries, "167", function, addr(target))

    hooks = {
        "HOOK_RUN_TURN_BUILD": items.hook_name("THUMB_BRANCH_LINK", "167", bl("BtlServerFlow_RunTurn", "ActionOrder_Build")),
        "HOOK_RUN_PROC": items.hook_name("THUMB_BRANCH_LINK", "167", bl("ActionOrder_Run", "ActionOrder_Proc")),
        "HOOK_CHANGE_FORM": items.hook_name("THUMB_BRANCH", "167", addr("ChangeForm")),
        "HOOK_WRITE_TO_SRC": items.hook_name("THUMB_BRANCH", "167", addr("BattleMon_WriteToSrc")),
        "HOOK_ITEM_CHECK": items.hook_name("THUMB_BRANCH", "167", addr("GiratinaArceusGenesectItemCheck")),
        "HOOK_WAIT_MOVE_SELECT": items.hook_name(
            "THUMB_BRANCH_LINK", "167", bl("BattleClient_ActionSelectFight", "BtlvCore_WaitMoveSelect")),
        "HOOK_START_FORM_CHANGE": items.hook_name("THUMB_BRANCH", "167", addr("BtlvCore_StartFormChange")),
        "HOOK_WAIT_FORM_CHANGE": items.hook_name("THUMB_BRANCH", "167", addr("BtlvCore_WaitFormChange")),
    }
    (out / "hooks.h").write_text("".join(f"#define {k} {v}\n" for k, v in hooks.items()))
    obj = out / "mega.o"
    defines = ["-DPW_MEGA_TEST_ROUTES"] if test_routes else []
    items.run(items.tool("arm-none-eabi-gcc"), *CFLAGS, *defines, "-I", out, "-I", HERE / "src", "-c",
              HERE / "src/mega.c", "-o", obj)
    name = f"PokewebMega{game}"
    dll, dump = items.link_dll(out, name, [obj], list(hooks.values()) + ["gPwMegaConfig"], symbols, SEGMENTS, game,
                               version, ["167"])
    blob = dll.read_bytes()
    if blob.count(TABLE_TAG) != 1:
        raise RuntimeError(f"{name}: expected one PWMG table")
    manifest = items.describe(dll, dump, [], None)
    manifest["tableOffset"] = blob.index(TABLE_TAG)
    return manifest


def build_bw1_game(game, version, out_root, test_routes):
    import build_bw1 as bw1  # noqa: E402 (runtime/item-expansion)

    inputs = bw1.Inputs(game)
    out = out_root / game
    out.mkdir(parents=True, exist_ok=True)

    def entry(function):
        segment, address, size, isa = inputs.function(function)
        if isa != "thumb" or size < 12:
            raise RuntimeError(f"{game} {function}: cannot take a THUMB_BRANCH ({isa}, {size} bytes)")
        return items.hook_name("THUMB_BRANCH", segment, address)

    def call(caller, callee):
        segment, site = bw1.find_bl(inputs, caller, callee)
        return items.hook_name("THUMB_BRANCH_LINK", segment, site)

    # The same hook points as Black 2 / White 2's. The client's form change is redirected at its one call site
    # (BTL_CLIENT_CmdChangeForm); Black / White's BTLV_CORE_StartMonSpriteChange / WaitMonSpriteChange are short
    # thunks with that one caller.
    hooks = {
        "HOOK_RUN_TURN_BUILD": call("BTL_SERVER_FLOW_StartTurn", "BTL_SERVER_FLOW_BuildActionOrder"),
        "HOOK_RUN_PROC": call("BTL_SERVER_FLOW_RunActionOrder", "BTL_SERVER_FLOW_ProcAction"),
        "HOOK_CHANGE_FORM": entry("BTL_POKEPARAM_ChangeForm"),
        "HOOK_WRITE_TO_SRC": entry("BTL_POKEPARAM_WriteBackToParam"),
        "HOOK_ITEM_CHECK": entry("HAND_COMMON_IsItemBoundToSpecies"),
        "HOOK_WAIT_MOVE_SELECT": call("BTL_CLIENT_StepSelectMove", "BTLV_CORE_PollMoveMenu"),
        "HOOK_START_FORM_CHANGE": call("BTL_CLIENT_CmdChangeForm", "BTLV_CORE_StartMonSpriteChange"),
        "HOOK_WAIT_FORM_CHANGE": call("BTL_CLIENT_CmdChangeForm", "BTLV_CORE_WaitMonSpriteChange"),
    }
    (out / "hooks.h").write_text("".join(f"#define {k} {v}\n" for k, v in hooks.items()))
    obj = out / "mega.o"
    defines = ["-DPW_BW1"] + (["-DPW_MEGA_TEST_ROUTES"] if test_routes else [])
    items.run(items.tool("arm-none-eabi-gcc"), *CFLAGS, *defines, "-I", out, "-I", HERE / "src", "-c",
              HERE / "src/mega.c", "-o", obj)
    name = f"PokewebMega{game}"
    dll, dump = items.link_dll(out, name, [obj], list(hooks.values()) + ["gPwMegaConfig"], bw1.Symbols(inputs, {}),
                               BW1_SEGMENTS, game, version, ["93"])
    blob = dll.read_bytes()
    if blob.count(TABLE_TAG) != 1:
        raise RuntimeError(f"{name}: expected one PWMG table")
    manifest = items.describe(dll, dump, [], None)
    manifest["tableOffset"] = blob.index(TABLE_TAG)
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", choices=["W2", "B2", "B", "W"], action="append")
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--test-routes", action="store_true")
    args = parser.parse_args()
    cfg = json.loads((REPO / "runtime/item-expansion/games.json").read_text())
    out_root = HERE / "build"
    shipped = {"version": 3, "tableTag": "PWMG", "games": {}}
    for game in args.game or [*cfg["games"], "B", "W"]:
        if game in ("B", "W"):
            manifest = build_bw1_game(game, 3, out_root, args.test_routes)
        else:
            manifest = build_game(game, cfg["games"][game], 3, out_root, args.test_routes)
        shipped["games"][game] = manifest
        print(f"{game} {manifest['fileName']}: {manifest['size']} bytes, {len(manifest['targets'])} targets, "
              f"table at 0x{manifest['tableOffset']:x}")
        if not args.test and not args.test_routes:
            (REPO / "src/assets/codeinjection" / manifest["fileName"]).write_bytes(
                (out_root / game / manifest["fileName"]).read_bytes())
    if not args.test and not args.test_routes:
        path = REPO / "src/assets/codeinjection/megaEvolutionManifest.json"
        previous = json.loads(path.read_text()) if path.exists() else {"games": {}}
        previous.update({k: v for k, v in shipped.items() if k != "games"})
        previous.setdefault("games", {}).update(shipped["games"])
        path.write_text(json.dumps(previous, indent=2) + "\n")


if __name__ == "__main__":
    main()

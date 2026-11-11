"""Build the regional forms' battle runtime: Zen Mode for Galarian Darmanitan (all four games).

    python3 runtime/regional-forms/build.py [--game W2|B2|B|W] [--test]

RegionalZenMode<game>.dll (the battle overlay: 167, Black / White 93; src/zen_mode.c). Hooks, each a BL found by
caller and callee in the retail binary: in the Zen Mode turn-end handler, its form read (checked to read value 0x13)
and its form change; in the revert handler, its form change. Inputs as runtime/form-evolution/build.py's. Outputs
(src/assets/codeinjection unless --test): the DLLs and regionalZenModeManifest.json.
"""
import argparse
import importlib.util
import json
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "runtime/item-expansion"))
import build as items  # noqa: E402

_spec = importlib.util.spec_from_file_location("form_evolution_build", REPO / "runtime/form-evolution/build.py")
fe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fe)

VERSION = "1.0.0"
NAMES = {
    "bw2": {"segment": "167", "update": "HandlerZenMode", "revert": "HandlerZenModeGastroAcid",
            "value": "GetBattleMonStat", "send": "BattleHandler_PopWork"},
    "bw1": {"segment": "93", "update": "HAND_TOKUSEI_ZenModeUpdateForm", "revert": "HAND_TOKUSEI_ZenModeRevertForm",
            "value": "BTL_POKEPARAM_GetValue", "send": "BTL_SERVER_FLOW_CommitCmdRecord"},
}


def form_read(code, address, sites):
    """The value read passing 0x13 (the form): MOVS r1, #0x13 just before the BL."""
    hits = [site for site in sites if struct.pack("<H", 0x2113) in code[site - address - 6:site - address]]
    if len(hits) != 1:
        raise RuntimeError(f"expected one form read, found {len(hits)}")
    return hits[0]


def build(game, out_root):
    family = "bw1" if game in ("B", "W") else "bw2"
    names = NAMES[family]
    out = out_root / game
    out.mkdir(parents=True, exist_ok=True)
    if family == "bw2":
        cfg = json.loads((REPO / "runtime/item-expansion/games.json").read_text())["games"][game]
        symbols, binaries = items.Symbols(cfg["pokebw2"]), items.Binaries(cfg)

        def function(name):
            address, _, _, size = symbols.get(names["segment"], name)
            return address & ~1, binaries.read(names["segment"], address & ~1, size)

        def target(name):
            return symbols.get(names["segment"], name)[0] & ~1
        link_symbols = symbols
    else:
        import build_bw1 as bw1  # noqa: E402
        inputs = bw1.Inputs(game)

        def function(name):
            seg, address, size, _ = inputs.function(name)
            assert seg == names["segment"], (name, seg)
            return address, inputs.binaries.read(seg, address, size)

        def target(name):
            return inputs.function(name)[1]
        link_symbols = bw1.Symbols(inputs, {})

    seg = names["segment"]
    address, code = function(names["update"])
    reads = fe.bl_sites(code, address, target(names["value"]))
    update_sends = fe.bl_sites(code, address, target(names["send"]))
    r_address, r_code = function(names["revert"])
    revert_sends = fe.bl_sites(r_code, r_address, target(names["send"]))
    if len(update_sends) != 1 or len(revert_sends) != 1:
        raise RuntimeError(f"{game}: {len(update_sends)} / {len(revert_sends)} form changes in the Zen Mode handlers")
    hooks = {"HOOK_ZEN_FORM_READ": items.hook_name("THUMB_BRANCH_LINK", seg, form_read(code, address, reads)),
             "HOOK_ZEN_UPDATE_SEND": items.hook_name("THUMB_BRANCH_LINK", seg, update_sends[0]),
             "HOOK_ZEN_REVERT_SEND": items.hook_name("THUMB_BRANCH_LINK", seg, revert_sends[0])}
    (out / "hooks.h").write_text("".join(f"#define {k} {v}\n" for k, v in hooks.items()))
    obj = out / "zen_mode.o"
    items.run(items.tool("arm-none-eabi-gcc"), *fe.CFLAGS, *(["-DPW_BW1"] if family == "bw1" else []), "-I", out, "-c",
              HERE / "src/zen_mode.c", "-o", obj)
    dll, dump = items.link_dll(out, f"RegionalZenMode{game}", [obj], list(hooks.values()), link_symbols, [seg, "ARM9"],
                               game, VERSION, [seg])
    manifest = items.describe(dll, dump, [], None)
    data = dll.read_bytes()
    if data.count(b"PWZN") != 1:
        raise RuntimeError(f"{game}: the DLL must hold one PWZN mark")
    manifest["configOffset"] = data.index(b"PWZN")
    return manifest, dll


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", choices=["W2", "B2", "B", "W"], action="append")
    parser.add_argument("--test", action="store_true")
    args = parser.parse_args()
    shipped = {}
    for game in args.game or ["W2", "B2", "B", "W"]:
        manifest, dll = build(game, HERE / "build")
        print(f"{game} {manifest['fileName']}: {manifest['size']} bytes, {len(manifest['targets'])} targets, PWZN at 0x{manifest['configOffset']:x}")
        if not args.test:
            (REPO / "src/assets/codeinjection" / manifest["fileName"]).write_bytes(dll.read_bytes())
        shipped[game] = manifest
    if not args.test:
        path = REPO / "src/assets/codeinjection/regionalZenModeManifest.json"
        previous = json.loads(path.read_text()) if path.exists() else {"games": {}}
        previous["version"] = VERSION
        previous.setdefault("games", {}).update(shipped)
        path.write_text(json.dumps(previous, indent=2) + "\n")


if __name__ == "__main__":
    main()

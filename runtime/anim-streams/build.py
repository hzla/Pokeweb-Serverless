"""Build the Pokeweb animated sprite stream runtime (w2anim W2AS / MANI) for Black 2 and White 2.

    python3 runtime/anim-streams/build.py [--game W2|B2] [--test]

Uses the item expansion's toolchain helpers and inputs (POKEBW2_CONFIG symbol tables, POKEBW2_EXTRACT binaries,
ARM_TOOLCHAIN_BIN, RPM_TOOL_JAR). Every hook is a BL call site found by its caller and target in pokebw2's symbols and
checked against the retail binaries of that game. Outputs (src/assets/codeinjection unless --test):
PokewebAnimStreams<game>.dll and animStreamsManifest.json (hook targets, sizes, hashes).
"""
import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "runtime/item-expansion"))
import build as items  # noqa: E402

CFLAGS = ["-std=gnu99", "-mthumb", "-mcpu=arm946e-s", "-Os", "-ffreestanding", "-fno-builtin", "-fno-short-enums",
          "-ffunction-sections", "-fdata-sections", "-fno-jump-tables", "-fno-unwind-tables",
          "-fno-asynchronous-unwind-tables", "-Wall", "-Wextra", "-Wno-unused-parameter", "-Werror"]
INCLUDES = [items.VENDOR / "include", items.VENDOR / "lib/nitro/include"]

# (macro, segment, caller, callee): the BL in `caller` to `callee` that the hook replaces.
CALL_SITES = [
    ("HOOK_LOAD_RELOAD", "ARM9", "MCSS_Reload", "LoadMCSSGraphicsData"),
    ("HOOK_LOAD_ADD", "ARM9", "MCSSSys_Add", "LoadMCSSGraphicsData"),
    ("HOOK_LOAD_MOSAIC", "ARM9", "MCSS_SetMosaic", "LoadMCSSGraphicsData"),
    ("HOOK_REMOVE", "ARM9", "MCSSSys_Remove", "MCSS_FreeFiles"),
    ("HOOK_UPDATE_BATTLE", "168", "BtlvMcss_Main", "MCSSSys_Update"),
    ("HOOK_UPDATE_TRADE", "194", "PokemonTrade_ProcMain", "MCSSSys_Update"),
    ("HOOK_UPDATE_SUMMARY", "207", "PStatus_Main", "MCSSSys_Update"),
    ("HOOK_UPDATE_HALL_OF_FAME", "265", "DDemoMain_Main3D", "MCSSSys_Update"),
    ("HOOK_UPDATE_EVOLUTION", "284", "ShinkaDemoView_Update", "MCSSSys_Update"),
    ("HOOK_UPDATE_INTRO", "294", "IntroMcss_Draw", "MCSSSys_Update"),
    ("HOOK_UPDATE_ZUKAN", "298", "ZukanDetailForm_Main", "MCSSSys_Update"),
    ("HOOK_UPDATE_EGG", "307", "EggDemoView_Update", "MCSSSys_Update"),
    ("HOOK_EVO_MORPH_UPDATE", "284", "ShinkaDemoView_Update", "ShinkaDemoView_UpdatePieces"),
    ("HOOK_EVO_MORPH_DRAW", "284", "ShinkaDemoView_Draw", "ShinkaDemoView_DrawPieces"),
]
# ShinkaDemoView_AddMcss calls MCSSSys_AddPartyPkm twice: the loop (before, then after) and the replay (after only).
EVO_ADDS = ("284", "ShinkaDemoView_AddMcss", "MCSSSys_AddPartyPkm", ["HOOK_EVO_ADD_PAIR", "HOOK_EVO_ADD_AFTER"])
SEGMENTS = ["ARM9", "168", "194", "207", "265", "284", "294", "298", "307"]


def bl_sites(symbols, binaries, segment, function, target):
    """Every BL in `function` to `target`, in address order."""
    import struct
    address, _, _, size = symbols.get(segment, function)
    address &= ~1
    code = binaries.read(segment, address, size)
    hits = []
    for i in range(0, len(code) - 3, 2):
        hi, lo = struct.unpack_from("<HH", code, i)
        if hi & 0xF800 == 0xF000 and lo & 0xF800 == 0xF800:
            offset = ((hi & 0x7FF) << 12) | ((lo & 0x7FF) << 1)
            if offset & 0x400000:
                offset -= 0x800000
            if address + i + 4 + offset == target:
                hits.append(address + i)
    return hits


def build_game(game, cfg, version, out_root):
    symbols = items.Symbols(cfg["pokebw2"])
    binaries = items.Binaries(cfg)
    out = out_root / game
    out.mkdir(parents=True, exist_ok=True)

    def target(name):
        segment, entry = symbols.resolve(name, SEGMENTS)
        if not entry:
            raise RuntimeError(f"{game}: no symbol {name}")
        return entry[0] & ~1

    hooks = {}
    signatures = []

    def add(macro, segment, caller, callee, site):
        hooks[macro] = items.hook_name("THUMB_BRANCH_LINK", segment, site)
        # Pokeweb checks these bytes (the retail BL) in the ROM before it installs the runtime.
        signatures.append({"id": macro, "caller": caller, "callee": callee, "segment": segment,
                           "address": f"0x{site:08x}", "expectedHex": binaries.read(segment, site, 4).hex()})

    for macro, segment, caller, callee in CALL_SITES:
        sites = bl_sites(symbols, binaries, segment, caller, target(callee))
        if len(sites) != 1:
            raise RuntimeError(f"{game}: {caller} -> {callee}: expected one BL, found {[hex(s) for s in sites]}")
        add(macro, segment, caller, callee, sites[0])
    segment, caller, callee, macros = EVO_ADDS
    sites = bl_sites(symbols, binaries, segment, caller, target(callee))
    if len(sites) != len(macros):
        raise RuntimeError(f"{game}: {caller} -> {callee}: expected {len(macros)} BLs, found {[hex(s) for s in sites]}")
    for macro, site in zip(macros, sites):
        add(macro, segment, caller, callee, site)

    (out / "hooks.h").write_text("".join(f"#define {k} {v}\n" for k, v in hooks.items()))
    obj = out / "anim_streams.o"
    items.run(items.tool("arm-none-eabi-gcc"), *CFLAGS, "-I", out, *[a for p in INCLUDES for a in ("-I", p)], "-c",
              HERE / "src/anim_streams.c", "-o", obj)
    name = f"PokewebAnimStreams{game}"
    hook_segments = sorted({h.split("_0x")[0].rsplit("_", 1)[1] for h in hooks.values()},
                           key=lambda s: (s != "ARM9", int(s) if s.isdigit() else 0))
    dll, dump = items.link_dll(out, name, [obj], list(hooks.values()), symbols, SEGMENTS, game, version, hook_segments)
    manifest = items.describe(dll, dump, [], None)
    manifest["hooks"] = signatures
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", choices=["W2", "B2"], action="append")
    parser.add_argument("--test", action="store_true")
    args = parser.parse_args()
    cfg = json.loads((REPO / "runtime/item-expansion/games.json").read_text())
    out_root = HERE / "build"
    shipped = {"version": 1, "streamsPath": "w2anim/streams.bin", "games": {}}
    for game in args.game or list(cfg["games"]):
        manifest = build_game(game, cfg["games"][game], 1, out_root)
        shipped["games"][game] = manifest
        print(f"{game} {manifest['fileName']}: {manifest['size']} bytes, {len(manifest['targets'])} targets")
        if not args.test:
            (REPO / "src/assets/codeinjection" / manifest["fileName"]).write_bytes(
                (out_root / game / manifest["fileName"]).read_bytes())
    if not args.test:
        (REPO / "src/assets/codeinjection/animStreamsManifest.json").write_text(json.dumps(shipped, indent=2) + "\n")


if __name__ == "__main__":
    main()

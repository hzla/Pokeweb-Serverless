"""Build the Pokeweb animated sprite stream runtime (w2anim W2AS / MANI) for Black, White, Black 2 and White 2.

    python3 runtime/anim-streams/build.py [--game B|W|B2|W2 ...] [--test]

Black 2 / White 2 use the item expansion's inputs: pokebw2's symbol tables (POKEBW2_CONFIG) and extracted binaries
(POKEBW2_EXTRACT). Black / White use the aletheia decomp's function tables (ALETHEIA, default
<workspace>/aletheia) and a clean ROM of each game (BW1_ROM_B / BW1_ROM_W, default <workspace>/cleanblack.nds and
cleanwhite.nds; or BW1_EXTRACT_B / BW1_EXTRACT_W, see bw1.ExtractBinaries). Toolchain: ARM_TOOLCHAIN_BIN, RPM_TOOL_JAR (see runtime/item-expansion/build.py).

Every hook is a BL call site found by its caller and callee in the game's symbols and checked against that game's
retail binary. Outputs (src/assets/codeinjection unless --test): PokewebAnimStreams<game>.dll and
animStreamsManifest.json (per game: hook sites with their retail bytes, sizes, hashes; other games' entries kept).
"""
import argparse
import json
import os
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "runtime/item-expansion"))
sys.path.append(str(HERE))  # after the item expansion: its build.py is `build`
import build as items  # noqa: E402
import bw1  # noqa: E402

CFLAGS = ["-std=gnu99", "-mthumb", "-mcpu=arm946e-s", "-Os", "-ffreestanding", "-fno-builtin", "-fno-short-enums",
          "-ffunction-sections", "-fdata-sections", "-fno-jump-tables", "-fno-unwind-tables",
          "-fno-asynchronous-unwind-tables", "-Wall", "-Wextra", "-Wno-unused-parameter", "-Werror"]
INCLUDES = [items.VENDOR / "include", items.VENDOR / "lib/nitro/include"]
MANIFEST = REPO / "src/assets/codeinjection/animStreamsManifest.json"

# The runtime's neutral extern names (see the top of src/anim_streams.c) -> each family's symbol.
ALIASES = {
    "BW2": {"McssLoad": "LoadMCSSGraphicsData", "McssUpdate": "MCSSSys_Update", "McssFreeFiles": "MCSS_FreeFiles",
            "HeapAlloc": "GFL_HeapAllocate", "HeapFree": "GFL_HeapFree", "AddUploadTask": "GFL_VBlankTCBAdd",
            "RemoveUploadTask": "GFL_TCBRemove", "FsLength": "FS_GetFileLength",
            "McssAddPartyPkm": "MCSSSys_AddPartyPkm", "MorphUpdatePieces": "ShinkaDemoView_UpdatePieces",
            "MorphDrawPieces": "ShinkaDemoView_DrawPieces"},
    "BW1": {"McssLoad": "MCSS_LoadResource", "McssUpdate": "MCSS_Main", "McssFreeFiles": "MCSS_FreeResource",
            "HeapAlloc": "GFL_HEAP_Alloc", "HeapFree": "GFL_HEAP_Free", "AddUploadTask": "GFL_USE_AddMainTask",
            "RemoveUploadTask": "TCB_DeleteTask", "FsLength": "FS_GetLength"},
}

# (macro, segment, caller, callee): the BL in `caller` to `callee` that the hook replaces.
BW2_SITES = [
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
BW2_MULTI = [("284", "ShinkaDemoView_AddMcss", "MCSSSys_AddPartyPkm", ["HOOK_EVO_ADD_PAIR", "HOOK_EVO_ADD_AFTER"])]
BW2_SEGMENTS = ["ARM9", "168", "194", "207", "265", "284", "294", "298", "307"]

# Black / White (aletheia names): the same MCSS (struct layout and upload task identical to Black 2 / White 2's);
# MCSS_Del frees through MCSS_FreeResource; no morph hooks (the evolution grid is built from the static sheet).
BW1_SITES = [
    ("HOOK_LOAD_RELOAD", "ARM9", "MCSS_ReloadResource", "MCSS_LoadResource"),
    ("HOOK_LOAD_ADD", "ARM9", "MCSS_Add", "MCSS_LoadResource"),
    ("HOOK_LOAD_MOSAIC", "ARM9", "MCSS_SetMosaic", "MCSS_LoadResource"),
    ("HOOK_REMOVE", "ARM9", "MCSS_Del", "MCSS_FreeResource"),
    ("HOOK_UPDATE_BATTLE", "94", "BTLV_MCSS_Update", "MCSS_Main"),
    ("HOOK_UPDATE_TRADE", "119", "POKETRADE_PROC_Main", "MCSS_Main"),
    ("HOOK_UPDATE_SUMMARY", "131", "P_STATUS_MainSeq", "MCSS_Main"),
    ("HOOK_UPDATE_HALL_OF_FAME", "180", "HALL_OF_FAME_DrawMonSprite3d", "MCSS_Main"),
    ("HOOK_UPDATE_EVOLUTION", "195", "SHINKA_DEMO_VIEW_Main", "MCSS_Main"),
    ("HOOK_UPDATE_INTRO", "204", "INTRO_MCSS_Main", "MCSS_Main"),
    ("HOOK_UPDATE_ZUKAN", "208", "ZUKAN_DETAIL_FORM_Main", "MCSS_Main"),
    ("HOOK_UPDATE_EGG", "215", "EGG_DEMO_VIEW_Update", "MCSS_Main"),
]
BW1_SEGMENTS = ["ARM9", "94", "119", "131", "180", "195", "204", "208", "215"]


class AliasedSymbols:
    """The neutral extern names resolved through a family's alias table (link_dll's symbols interface)."""

    def __init__(self, symbols, aliases):
        self.symbols, self.aliases = symbols, aliases

    def resolve(self, name, segments):
        return self.symbols.resolve(self.aliases.get(name, name), segments)

    def size_at(self, segment, address):
        return self.symbols.size_at(segment, address)


def bl_sites(code, address, target):
    """Every BL in `code` (at `address`) to `target`, in address order."""
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


def game_inputs(game, cfg):
    """(family, symbols, binaries, function(segment, name) -> (address, size), sites, multi sites, segments)."""
    if game in ("B2", "W2"):
        symbols, binaries = items.Symbols(cfg["games"][game]["pokebw2"]), items.Binaries(cfg["games"][game])

        def function(segment, name):
            address, _, _, size = symbols.get(segment, name)
            return address & ~1, size
        return "BW2", symbols, binaries, function, BW2_SITES, BW2_MULTI, BW2_SEGMENTS
    workspace = REPO.parent
    symbols = bw1.Bw1Symbols(Path(os.environ.get("ALETHEIA", workspace / "aletheia")), game)
    extract = os.environ.get(f"BW1_EXTRACT_{game}")  # or an extract directory (bw1.ExtractBinaries)
    rom = os.environ.get(f"BW1_ROM_{game}", workspace / ("cleanblack.nds" if game == "B" else "cleanwhite.nds"))
    binaries = bw1.ExtractBinaries(extract) if extract else bw1.RomBinaries(rom)

    def function(segment, name):
        found, address, size, _ = symbols.get(name)
        if found != segment:
            raise RuntimeError(f"{game}: {name} is in {found}, expected {segment}")
        return address & ~1, size
    return "BW1", symbols, binaries, function, BW1_SITES, [], BW1_SEGMENTS


def build_game(game, cfg, version, out_root):
    family, symbols, binaries, function, sites, multi, segments = game_inputs(game, cfg)
    out = out_root / game
    out.mkdir(parents=True, exist_ok=True)

    def target(name):
        segment, entry = symbols.resolve(name, segments)
        if not entry:
            raise RuntimeError(f"{game}: no symbol {name}")
        return entry[0] & ~1

    hooks = {}
    signatures = []

    def find(segment, caller, callee):
        address, size = function(segment, caller)
        return bl_sites(binaries.read(segment, address, size), address, target(callee))

    def add(macro, segment, caller, callee, site):
        hooks[macro] = items.hook_name("THUMB_BRANCH_LINK", segment, site)
        # Pokeweb checks these bytes (the retail BL) in the ROM before it installs the runtime.
        signatures.append({"id": macro, "caller": caller, "callee": callee, "segment": segment,
                           "address": f"0x{site:08x}", "expectedHex": binaries.read(segment, site, 4).hex()})

    for macro, segment, caller, callee in sites:
        found = find(segment, caller, callee)
        if len(found) != 1:
            raise RuntimeError(f"{game}: {caller} -> {callee}: expected one BL, found {[hex(s) for s in found]}")
        add(macro, segment, caller, callee, found[0])
    for segment, caller, callee, macros in multi:
        found = find(segment, caller, callee)
        if len(found) != len(macros):
            raise RuntimeError(f"{game}: {caller} -> {callee}: expected {len(macros)} BLs, found {[hex(s) for s in found]}")
        for macro, site in zip(macros, found):
            add(macro, segment, caller, callee, site)

    defines = ["#define ANIM_STREAMS_MORPH 1\n"] if family == "BW2" else []
    (out / "hooks.h").write_text("".join(defines) + "".join(f"#define {k} {v}\n" for k, v in hooks.items()))
    obj = out / "anim_streams.o"
    items.run(items.tool("arm-none-eabi-gcc"), *CFLAGS, "-I", out, *[a for p in INCLUDES for a in ("-I", p)], "-c",
              HERE / "src/anim_streams.c", "-o", obj)
    name = f"PokewebAnimStreams{game}"
    hook_segments = sorted({h.split("_0x")[0].rsplit("_", 1)[1] for h in hooks.values()},
                           key=lambda s: (s != "ARM9", int(s) if s.isdigit() else 0))
    dll, dump = items.link_dll(out, name, [obj], list(hooks.values()), AliasedSymbols(symbols, ALIASES[family]),
                               segments, game, version, hook_segments)
    manifest = items.describe(dll, dump, [], None)
    manifest["hooks"] = signatures
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", choices=["B", "W", "B2", "W2"], action="append")
    parser.add_argument("--test", action="store_true")
    args = parser.parse_args()
    cfg = json.loads((REPO / "runtime/item-expansion/games.json").read_text())
    out_root = HERE / "build"
    shipped = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {"version": 1, "games": {}}
    shipped["streamsPath"] = "w2anim/streams.bin"
    for game in args.game or ["B", "W", "B2", "W2"]:
        manifest = build_game(game, cfg, 1, out_root)
        shipped["games"][game] = manifest
        print(f"{game} {manifest['fileName']}: {manifest['size']} bytes, {len(manifest['hooks'])} hooks")
        if not args.test:
            (REPO / "src/assets/codeinjection" / manifest["fileName"]).write_bytes(
                (out_root / game / manifest["fileName"]).read_bytes())
    if not args.test:
        shipped["games"] = {game: shipped["games"][game] for game in ["B", "W", "B2", "W2"] if game in shipped["games"]}
        MANIFEST.write_text(json.dumps(shipped, indent=2) + "\n")


if __name__ == "__main__":
    main()

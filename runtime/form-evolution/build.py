"""Build the form evolution runtime DLLs (Black 2 / White 2, Black / White): evolution by form.

    python3 runtime/form-evolution/build.py [--game W2|B2|B|W] [--test]

Two DLLs per game (src/form_evolution.c):
- FormEvolutionCore<game>.dll (ARM9, resident): the evolution check reads the evolution record of the Pokémon's
  form. Hooks: the check's first parameter read (is it an egg) and its record read.
- FormEvolution<game>.dll (the evolution scene's overlay: 284, Black / White 195): evolution targets that are a form's
  personal record. Hooks: the two calls that change the evolving Pokémon's species (the Pokémon, and the copy the
  scene shows); Shedinja's is left alone. It keeps the name, path and hooks of the earlier Black 2 / White 2-only
  runtime (form_evolution.cpp, build.sh), which it replaces.

Symbols and binaries as the Mega Evolution runtime's (runtime/mega-evolution/build.py: POKEBW2_CONFIG,
POKEBW2_EXTRACT, ALETHEIA, BW1_ROM_B / BW1_ROM_W, ARM_TOOLCHAIN_BIN, RPM_TOOL_JAR). Every hook is a BL found by its
caller and callee in the retail binary; the egg read is checked to pass parameter 0x4C. Outputs
(src/assets/codeinjection unless --test): the DLLs and formEvolutionManifest.json.
"""
import argparse
import json
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "runtime/item-expansion"))
import build as items  # noqa: E402

CFLAGS = ["-std=gnu99", "-mthumb", "-mcpu=arm946e-s", "-Os", "-ffreestanding", "-fno-builtin", "-fno-short-enums",
          "-ffunction-sections", "-fdata-sections", "-fno-jump-tables", "-fno-unwind-tables",
          "-fno-asynchronous-unwind-tables", "-Wall", "-Wextra", "-Wno-unused-parameter", "-Werror"]
VERSION = "2.0.0"  # 1.0.0 was the Black 2 / White 2 C++ runtime (target resolution only)
# Retail names, Black 2 / White 2 (pokebw2) and Black / White (aletheia).
NAMES = {
    "bw2": {"check": "CheckEvolveSpecies", "param": "PokeParty_GetParam", "read": "getEvolutionInfoFile",
            "change": "setChangedPkmSpecies", "demo": "284",
            "callers": {"HOOK_DEMO_MAIN": "ShinkaDemo_Main", "HOOK_DEMO_VIEW": "ShinkaDemoView_Create"}},
    "bw1": {"check": "SHINKA_CHECK_CheckEvolution", "param": "POKE_TOOL_GetPartyValue", "read": "SHINKA_CHECK_LoadData",
            "change": "POKE_TOOL_ChangeSpecies", "demo": "195",
            "callers": {"HOOK_DEMO_MAIN": "SHINKA_DEMO_Main", "HOOK_DEMO_VIEW": "SHINKA_DEMO_VIEW_Create"}},
}


def bl_sites(code, address, target):
    """Addresses of the BLs in `code` (at `address`) that call `target`, in order."""
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


def check_egg_read(code, address, site):
    """The first parameter read passes 0x4C (is it an egg): MOVS r1, #0x4C just before the BL."""
    before = code[site - address - 8:site - address]
    if struct.pack("<H", 0x214C) not in before:
        raise RuntimeError(f"0x{site:x}: the check's first parameter read is not the egg read")


def build(game, out_root):
    family = "bw1" if game in ("B", "W") else "bw2"
    names = NAMES[family]
    out = out_root / game
    out.mkdir(parents=True, exist_ok=True)
    if family == "bw2":
        cfg = json.loads((REPO / "runtime/item-expansion/games.json").read_text())["games"][game]
        symbols, binaries = items.Symbols(cfg["pokebw2"]), items.Binaries(cfg)

        def function(name, segment):
            address, _, _, size = symbols.get(segment, name)
            return segment, address & ~1, size, binaries.read(segment, address & ~1, size)

        def target(name):
            return symbols.get("ARM9", name)[0] & ~1
        link_symbols, segments = symbols, None
    else:
        import build_bw1 as bw1  # noqa: E402 (runtime/item-expansion)
        inputs = bw1.Inputs(game)

        def function(name, segment):
            seg, address, size, _ = inputs.function(name)
            if seg != segment:
                raise RuntimeError(f"{game} {name}: in {seg}, expected {segment}")
            return seg, address, size, inputs.binaries.read(seg, address, size)

        def target(name):
            return inputs.function(name)[1]
        link_symbols = bw1.Symbols(inputs, {})

    # Core: the check's egg read and its record read.
    seg, address, _, code = function(names["check"], "ARM9")
    params = bl_sites(code, address, target(names["param"]))
    reads = bl_sites(code, address, target(names["read"]))
    if not params or len(reads) != 1:
        raise RuntimeError(f"{game}: {names['check']} has {len(params)} parameter reads, {len(reads)} record reads")
    check_egg_read(code, address, params[0])
    core_hooks = {"HOOK_CHECK_FIRST_PARAM": items.hook_name("THUMB_BRANCH_LINK", "ARM9", params[0]),
                  "HOOK_CHECK_READ": items.hook_name("THUMB_BRANCH_LINK", "ARM9", reads[0])}
    # Demo: one species change in each caller.
    demo_hooks = {}
    for hook, caller in names["callers"].items():
        seg, address, _, code = function(caller, names["demo"])
        sites = bl_sites(code, address, target(names["change"]))
        if len(sites) != 1:
            raise RuntimeError(f"{game} {caller}: expected one species change, found {len(sites)}")
        demo_hooks[hook] = items.hook_name("THUMB_BRANCH_LINK", names["demo"], sites[0])

    manifest = {}
    for part, hooks, segment, define in (("Core", core_hooks, "ARM9", "PW_FORM_EVOLUTION_CORE"),
                                         ("Demo", demo_hooks, names["demo"], "PW_FORM_EVOLUTION_DEMO")):
        work = out / part
        work.mkdir(exist_ok=True)
        (work / "hooks.h").write_text("".join(f"#define {k} {v}\n" for k, v in hooks.items()))
        obj = work / "form_evolution.o"
        defines = [f"-D{define}"] + (["-DPW_BW1"] if family == "bw1" else [])
        items.run(items.tool("arm-none-eabi-gcc"), *CFLAGS, *defines, "-I", work, "-c", HERE / "src/form_evolution.c",
                  "-o", obj)
        name = f"FormEvolutionCore{game}" if part == "Core" else f"FormEvolution{game}"
        link_segments = ["ARM9"] if segment == "ARM9" else [segment, "ARM9"]
        dll, dump = items.link_dll(work, name, [obj], list(hooks.values()), link_symbols, link_segments, game, VERSION,
                                   [segment])
        manifest[part.lower()] = items.describe(dll, dump, [], None)
        manifest[part.lower()]["dll"] = dll
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", choices=["W2", "B2", "B", "W"], action="append")
    parser.add_argument("--test", action="store_true")
    args = parser.parse_args()
    out_root = HERE / "build"
    shipped = {"version": VERSION, "games": {}}
    for game in args.game or ["W2", "B2", "B", "W"]:
        manifest = build(game, out_root)
        for part in ("core", "demo"):
            dll = manifest[part].pop("dll")
            print(f"{game} {manifest[part]['fileName']}: {manifest[part]['size']} bytes, {len(manifest[part]['targets'])} targets")
            if not args.test:
                (REPO / "src/assets/codeinjection" / manifest[part]["fileName"]).write_bytes(dll.read_bytes())
        shipped["games"][game] = manifest
    if not args.test:
        path = REPO / "src/assets/codeinjection/formEvolutionManifest.json"
        previous = json.loads(path.read_text()) if path.exists() else {"games": {}}
        previous["version"] = VERSION
        previous.setdefault("games", {}).update(shipped["games"])
        path.write_text(json.dumps(previous, indent=2) + "\n")


if __name__ == "__main__":
    main()

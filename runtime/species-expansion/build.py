"""Build the species expansion runtime (Black 2 / White 2): species past Genesect.

    python3 runtime/species-expansion/build.py [--game W2|B2] [--test]

Three DLLs per game (src/species.c):
- SpeciesExpansion<game>.dll (ARM9, resident). Replaces GetPokemonDataIDBase, PokeParty_GetIconIndex,
  PokeIcon_GetPalette, getResIDFunc, getWaveInfoFunc and PML_PersonalLoadRegionalDexTable (THUMB_BRANCH at each
  entry). Holds the table Pokeweb writes ("PWSX", manifest `configOffset`).
- SpeciesExpansionSummary<game>.dll (overlay 207): the summary's Pokédex number (PStaInfo_PrintInfo's first
  WordSetNumber, checked to print three digits).
- SpeciesExpansionBox<game>.dll (overlay 255): the box's (PrintInfoDexNumber's WordSetNumber).

Symbols and binaries as runtime/item-expansion/build.py's (pokebw2's config and extracted retail binaries).
Outputs (src/assets/codeinjection unless --test): the DLLs and speciesExpansionManifest.json.
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
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location("form_evolution_build", REPO / "runtime/form-evolution/build.py")
fe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(fe)

VERSION = "1.0.0"
REPLACED = {"HOOK_POKEGRA_BASE": "GetPokemonDataIDBase", "HOOK_ICON_INDEX": "PokeParty_GetIconIndex",
            "HOOK_ICON_PALETTE": "PokeIcon_GetPalette", "HOOK_CRY_RES": "getResIDFunc",
            "HOOK_CRY_WAVE": "getWaveInfoFunc", "HOOK_REGIONAL_DEX": "PML_PersonalLoadRegionalDexTable",
            "HOOK_REGULATION_BIT": "Regulation_CheckParamBit",
            # The Pokédex (pokedex.c)
            "HOOK_DEX_INIT": "initPokedex", "HOOK_DEX_BAD_SPECIES": "PML_PkmIsBadMonsNo",
            "HOOK_DEX_IS_CAUGHT": "PokeDex_IsCaught", "HOOK_DEX_IS_SEEN": "PokeDex_IsSeen", "HOOK_DEX_ADD": "addToDex",
            "HOOK_DEX_SHOWN": "PokeDex_GetShownSexRareForm", "HOOK_DEX_HAS_SEEN_VARIANT": "PokeDex_HasSeenVariant",
            "HOOK_DEX_ADD_CAUGHT": "addPkmToDex", "HOOK_DEX_ADD_SEEN": "PokeDex_RegistPkm",
            "HOOK_DEX_HAS_LANGUAGE": "PokeDex_HasLanguage", "HOOK_DEX_CAUGHT_NATIONAL": "PokeDex_GetCaughtNoNational",
            "HOOK_DEX_SEEN_NATIONAL": "PokeDex_GetSeenNoNational", "HOOK_DEX_CAUGHT_PERMISSIVE": "PokeDex_GetCaughtNoPermissive",
            "HOOK_DEX_COMPLETE_NATIONAL": "PokeDex_IsCompleteNational", "HOOK_DEX_SET_LAST": "PokeDex_SetLastSpecies",
            "HOOK_DEX_GET_LAST": "PokeDex_GetLastSpecies"}
# Replaced functions with more than four arguments: GetPokemonDataIDBase (13), getWaveInfoFunc (8), addToDex (5),
# PokeDex_GetShownSexRareForm (6), PokeDex_HasSeenVariant (5).
STACK_ARGUMENTS = {"HOOK_POKEGRA_BASE", "HOOK_CRY_WAVE", "HOOK_DEX_ADD", "HOOK_DEX_SHOWN", "HOOK_DEX_HAS_SEEN_VARIANT",
                   "HOOK_LIST_PRINT", "HOOK_SEARCH_LOAD_ORDER"}


def bss(game, name):
    """The address of a bss symbol (items.Symbols reads only symbols with a kind detail)."""
    import re
    cfg = json.loads((REPO / "runtime/item-expansion/games.json").read_text())["games"][game]
    text = (items.CONFIG / cfg["pokebw2"] / "arm9/symbols.txt").read_text()
    match = re.search(rf"^{name} kind:bss addr:(0x[0-9a-f]+)$", text, re.M)
    if not match:
        raise RuntimeError(f"{game}: no {name}")
    return int(match.group(1), 16)


def build(game, out_root):
    cfg = json.loads((REPO / "runtime/item-expansion/games.json").read_text())["games"][game]
    symbols, binaries = items.Symbols(cfg["pokebw2"]), items.Binaries(cfg)

    def function(segment, name):
        address, _, _, size = symbols.get(segment, name)
        return address & ~1, size, binaries.read(segment, address & ~1, size)

    def target(segment, name):
        return symbols.get(segment, name)[0] & ~1

    # Core: whole functions, and the palette table's literal in PokeIcon_GetPalette.
    # A function with arguments on the stack takes the stack-preserving branch (libRPM's plain one moves the stack).
    core = {hook: items.hook_name("THUMB_BRANCH_SAFESTACK" if hook in STACK_ARGUMENTS else "THUMB_BRANCH", "ARM9",
                                  function("ARM9", name)[0]) for hook, name in REPLACED.items()}
    address, size, code = function("ARM9", "PokeIcon_GetPalette")
    table = struct.pack("<I", target("ARM9", "sPokeIconPalettes"))
    literals = [address + i for i in range(0, size - 3, 4) if code[i:i + 4] == table]
    if len(literals) != 1:
        raise RuntimeError(f"{game}: expected one sPokeIconPalettes literal in PokeIcon_GetPalette, found {len(literals)}")
    defines = {"PALETTE_TABLE_LITERAL": f"0x{literals[0]:08x}", "PERSONAL_ARC_HANDLES": f"0x{bss(game, 'g_PMLPersonalArcBW2'):08x}"}

    # The Pokédex numbers: the summary's first WordSetNumber (three digits) and the box's one.
    address, size, code = function("207", "PStaInfo_PrintInfo")
    sites = fe.bl_sites(code, address, target("ARM9", "WordSetNumber"))
    if not sites or struct.pack("<H", 0x2303) not in code[sites[0] - address - 10:sites[0] - address]:
        raise RuntimeError(f"{game}: PStaInfo_PrintInfo's first WordSetNumber does not print three digits")
    summary = {"HOOK_DEX_NUMBER": items.hook_name("THUMB_BRANCH_LINK", "207", sites[0])}
    address, size, code = function("255", "PrintInfoDexNumber")
    sites = fe.bl_sites(code, address, target("ARM9", "WordSetNumber"))
    if len(sites) != 1:
        raise RuntimeError(f"{game}: PrintInfoDexNumber has {len(sites)} WordSetNumber calls")
    box = {"HOOK_DEX_NUMBER": items.hook_name("THUMB_BRANCH_LINK", "255", sites[0])}

    # The Pokédex: its list (overlay 299, with the FrameList code of overlay 139), its lists' loading (302) and its
    # entry (296).
    def replace(segment, hook_names):
        return {hook: items.hook_name("THUMB_BRANCH_SAFESTACK" if hook in STACK_ARGUMENTS else "THUMB_BRANCH", segment,
                                      function(segment, name)[0]) for hook, name in hook_names.items()}

    def number_calls(segment, name, count):
        address, size, code = function(segment, name)
        sites = fe.bl_sites(code, address, target("ARM9", "WordSetNumber"))
        if len(sites) != count:
            raise RuntimeError(f"{game}: {name} has {len(sites)} WordSetNumber calls, expected {count}")
        return [items.hook_name("THUMB_BRANCH_LINK", segment, site) for site in sites]

    dex_list = replace("299", {"HOOK_LIST_INIT": "ZknListMain_InitList", "HOOK_LIST_EXIT": "ZknListMain_ExitList",
                               "HOOK_LIST_PRINT": "ZknListMain_ListPrint"})
    dex_list["HOOK_DEX_NUMBER"], = number_calls("299", "ZknListBmp_PrintItem", 1)
    dex_list["HOOK_DEX_COUNT_SEEN"], dex_list["HOOK_DEX_COUNT_CAUGHT"] = number_calls("299", "ZknListBmp_PutCounts", 2)
    dex_list["HOOK_DEX_COUNT_SEARCH"], = number_calls("299", "ZknListBmp_PutSearchCount", 1)
    dex_search = replace("302", {"HOOK_SEARCH_LOAD_LIST": "ZukanSearchEngine_LoadList",
                                 "HOOK_SEARCH_LOAD_ORDER": "ZukanSearchEngine_LoadOrder"})
    dex_info = {"HOOK_DEX_NUMBER": number_calls("296", "ZukanInfo_PrintEntry", 1)[0]}

    manifest = {}
    for part, hooks, segment, define, extra in (("core", core, "ARM9", "PW_SPECIES_CORE", []),
                                                ("summary", summary, "207", "PW_SPECIES_SUMMARY", []),
                                                ("box", box, "255", "PW_SPECIES_BOX", []),
                                                ("dexList", dex_list, "299", "PW_SPECIES_DEX_LIST", ["139"]),
                                                ("dexSearch", dex_search, "302", "PW_SPECIES_DEX_SEARCH", []),
                                                ("dexInfo", dex_info, "296", "PW_SPECIES_DEX_INFO", [])):
        work = out_root / game / part
        work.mkdir(parents=True, exist_ok=True)
        header = {**hooks, **(defines if part == "core" else {})}
        (work / "hooks.h").write_text("".join(f"#define {k} {v}\n" for k, v in header.items()))
        obj = work / "species.o"
        items.run(items.tool("arm-none-eabi-gcc"), *fe.CFLAGS, f"-D{define}", "-I", work, "-c", HERE / "src/species.c",
                  "-o", obj)
        name = {"core": "SpeciesExpansion", "summary": "SpeciesExpansionSummary", "box": "SpeciesExpansionBox",
                "dexList": "SpeciesExpansionDexList", "dexSearch": "SpeciesExpansionDexSearch",
                "dexInfo": "SpeciesExpansionDexInfo"}[part] + game
        link_segments = ["ARM9"] if segment == "ARM9" else [segment, *extra, "ARM9"]
        dll, dump = items.link_dll(work, name, [obj], list(hooks.values()), symbols, link_segments, game, VERSION,
                                   [segment])
        manifest[part] = items.describe(dll, dump, [], None)
        manifest[part]["dll"] = dll
        if part == "core":
            blob = dll.read_bytes()
            if blob.count(b"PWSX") != 1:
                raise RuntimeError(f"{name}: expected one PWSX table")
            manifest[part]["configOffset"] = blob.index(b"PWSX")
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", choices=["W2", "B2"], action="append")
    parser.add_argument("--test", action="store_true")
    args = parser.parse_args()
    shipped = {"version": VERSION, "games": {}}
    for game in args.game or ["W2", "B2"]:
        manifest = build(game, HERE / "build")
        for part, entry in manifest.items():
            dll = entry.pop("dll")
            print(f"{game} {entry['fileName']}: {entry['size']} bytes, {len(entry['targets'])} targets"
                  + (f", PWSX at 0x{entry['configOffset']:x}" if "configOffset" in entry else ""))
            if not args.test:
                (REPO / "src/assets/codeinjection" / entry["fileName"]).write_bytes(dll.read_bytes())
        shipped["games"][game] = manifest
    if not args.test:
        path = REPO / "src/assets/codeinjection/speciesExpansionManifest.json"
        path.write_text(json.dumps(shipped, indent=2) + "\n")


if __name__ == "__main__":
    main()

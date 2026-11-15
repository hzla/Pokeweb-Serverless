"""Build the optional Training Items runtime for US revision-0 ROMs."""
import argparse
import json
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXPANSION = HERE.parent
sys.path.insert(0, str(EXPANSION))
# The parent also has a build.py; put it first before importing its helpers.
from build import WORKSPACE, REPO, Symbols, compile_unit, describe, hook_name, link_dll
from build_bw1 import Inputs, bw1

# Shipped v1 artifacts accepted by the in-place updater.
LEGACY = {
    "B": {"size": 2128, "sha256": "1d1885de17d681b08263f94b26c2dfb4c3fdf87fb422109063fe50cd30ab51cb"},
    "W": {"size": 2128, "sha256": "b85fe26d1992bd3c52dcc2f50c15271ee6015da8179a654974a709db50f3c069"},
    "B2": {"size": 2128, "sha256": "4732284b3b8bc846425dc728cd9ec5f680550f5ec1b0d84c8fe0146ff8b3fb28"},
    "W2": {"size": 2128, "sha256": "449cad9c22957cab9bbe1b4f0633e06a289b75189633f49401a5700147966142"},
}

BW1_APIS = {
    "RetailSelect": "POKELIST_ApplySelection",
    "RetailAbility": "POKE_TOOL_UpdateAbilityForSpecies",
    "DecodeBox": "POKE_TOOL_DecodeBoxParam",
    "EncodeBox": "POKE_TOOL_EncodeBoxParam",
    "BoxBlock": "POKE_TOOL_GetBoxSubstruct",
    "BoxGet": "POKE_TOOL_GetBoxValue",
    "BoxSet": "POKE_TOOL_SetBoxValue",
    "GetParam": "POKE_TOOL_GetPartyValue",
    "SetParam": "POKE_TOOL_SetPartyValue",
    "SetNature": "POKE_TOOL_SetNature",
    "Recalc": "POKE_TOOL_RecalcParam",
    "Personal": "POKE_TOOL_GetPersonalParam",
    "RemoveItem": "MYITEM_SAVEDATA_RemoveItem",
    "ShowMessage": "POKELIST_ShowMessage",
    "ReturnToList": "POKELIST_CloseMessageToList",
    "ReturnAfterUse": "POKELIST_CloseMessageIfItemInBag",
    "CloseMessage": "PLIST_MESSAGE_CloseWindow",
    "OpenYesNo": "POKELIST_OpenMenuWithCallback",
    "RefreshPlate": "PLIST_PLATE_SetMon",
    "PlaySound": "GFL_USE_PlaySeDefaultVolume",
    "SetInputMode": "UI_SetInputMode",
    "ReadString": "MSGDATA_AllocString",
    "OpenTaskMenu": "APP_TASKMENU_OpenMenu",
}
BW2_APIS = {
    "RetailSelect": "PokeList_SelectPokemon",
    "RetailAbility": "setAbilityForForm",
    "DecodeBox": "PML_PkmDecrypt",
    "EncodeBox": "PML_PkmReEncrypt",
    "BoxBlock": "PML_PkmGetParamBlockCore",
    "BoxGet": "PML_PkmGetParam",
    "BoxSet": "PML_PkmSetParam",
    "GetParam": "PokeParty_GetParam",
    "SetParam": "PokeParty_SetParam",
    "SetNature": "PokeParty_SetNature",
    "Recalc": "PokeParty_RecalcStats",
    "Personal": "PML_PersonalGetParamSingle",
    "RemoveItem": "BagSave_SubItem",
    "ShowMessage": "PokeList_ShowMessage",
    "ReturnToList": "PokeList_MessageDoneSelect",
    "ReturnAfterUse": "PokeList_MessageDoneItem",
    "CloseMessage": "PokeListMessage_Close",
    "OpenYesNo": "PokeList_OpenSubMenu",
    "RefreshPlate": "PokeListPlate_SetPkm",
    "PlaySound": "GFL_SndSEPlay",
    "SetInputMode": "GCTX_HIDSetUsingTouch",
    "ReadString": "GFL_MsgDataLoadStrbufNew",
    "OpenTaskMenu": "AppTaskMenu_Create",
}
# Offsets of the shared fields in the retail party work and its request.
FIELDS = {
    "REQUEST": (0x280, 0x28c), "ITEM": (0x44, 0x54), "MODE": (0x34, 0x44),
    "CLOSE": (0x63, 0x73), "RESULT": (0x40, 0x50), "MON": (0x38, 0x3c),
    "SLOT": (0x2c, 0x30), "MESSAGE": (0x150, 0x154), "PLATES": (0x160, 0x164),
    "MENU": (0x154, 0x158), "BANK": (0x134, 0x138), "MENU_RES": (0x254, 0x25c),
    "CALLBACK": (0x14c, 0x150),
}


class LinkedSymbols:
    def __init__(self, aliases):
        self.aliases = aliases

    def resolve(self, name, segments):
        segment, entry = self.aliases[name]
        return segment, entry


def call_sites(data, base, target):
    for offset in range(0, len(data) - 3, 2):
        hi, lo = struct.unpack_from("<HH", data, offset)
        if hi & 0xf800 != 0xf000 or lo & 0xf800 != 0xf800:
            continue
        delta = ((hi & 0x7ff) << 12) | ((lo & 0x7ff) << 1)
        if delta & 0x400000:
            delta -= 0x800000
        if base + offset + 4 + delta == target:
            yield base + offset


def build(game, rom_path, output):
    first_gen = len(game) == 1
    inputs = Inputs(game) if first_gen else None
    native = inputs.symbols if inputs else Symbols(game.lower() + "_us")
    binaries = inputs.binaries if inputs and not rom_path else bw1.RomBinaries(
        rom_path or WORKSPACE / ("cleanblack2.nds" if game == "B2" else "cleanwhite2.nds"))
    overlay = "91" if first_gen else "165"
    aliases = {alias: native.resolve(name, (overlay, "ARM9")) for alias, name in
               (BW1_APIS if first_gen else BW2_APIS).items()}
    missing = [alias for alias, (_, entry) in aliases.items() if not entry]
    if missing:
        raise ValueError(f"{game}: missing native functions {missing}")
    base, data = binaries.overlays[int(overlay)]
    sites = list(call_sites(data, base, aliases["RetailSelect"][1][0]))
    if len(sites) != 1:
        raise ValueError(f"{game}: expected one party selection caller, found {sites}")
    hooks = {"TrainingSelect": (overlay, sites[0])}
    callers = ("POKE_TOOL_ChangeBoxSpecies", "POKE_TOOL_ChangeBoxForm") if first_gen else (
        "setNameChangedPkm", "PML_PkmChangeForme")
    for hook, name in zip(("TrainingEvolve", "TrainingChangeForm"), callers):
        _, entry = native.resolve(name, ("ARM9",))
        addr, _, _, size = entry
        sites = list(call_sites(binaries.read("ARM9", addr, size), addr, aliases["RetailAbility"][1][0]))
        if len(sites) != 1:
            raise ValueError(f"{game}: expected one ability refresh in {name}, found {sites}")
        hooks[hook] = ("ARM9", sites[0])
    symbols = {name: hook_name("THUMB_BRANCH_LINK", *site) for name, site in hooks.items()}
    work = output / game
    work.mkdir(parents=True, exist_ok=True)
    (work / "training_profile.h").write_text("".join(
        f"#define {key}_OFFSET {values[not first_gen]}\n" for key, values in FIELDS.items()))
    source = (HERE / "items.c").read_text()
    source = "".join(f"#define {name} {symbol}\n" for name, symbol in symbols.items()) + source
    obj = compile_unit(work, "training", source, [work], [])
    dll, dump = link_dll(work, f"PokewebTrainingItems{game}", [obj], list(symbols.values()), LinkedSymbols(aliases),
                         [overlay, "ARM9"], game, "2.0.0", [overlay, "ARM9"])
    result = describe(dll, dump, [], binaries.read)
    if len(result["targets"]) != len(hooks) or any(row["kind"] != "THUMB_BRANCH_LINK" for row in result["targets"]):
        raise ValueError(f"Unexpected relocations: {result['targets']}")
    result["checks"] = [
        *[{"segment": segment, "address": address, "bytes": binaries.read(segment, address, 4).hex()}
          for segment, address in hooks.values()],
        *[{"segment": segment, "address": addr, "bytes": binaries.read(segment, addr, min(8, size)).hex()}
          for segment, (addr, _, _, size) in aliases.values()],
    ]
    result["legacy"] = LEGACY[game]
    return result, dll


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", choices=["B", "W", "B2", "W2"], action="append")
    parser.add_argument("--rom", type=Path)
    args = parser.parse_args()
    output = EXPANSION / "build" / "training"
    assets = REPO / "src" / "assets" / "codeinjection"
    manifest = assets / "trainingItemsManifest.json"
    games = json.loads(manifest.read_text()) if manifest.exists() else {}
    for game in args.game or ["B", "W", "B2", "W2"]:
        games[game], dll = build(game, args.rom, output)
        (assets / dll.name).write_bytes(dll.read_bytes())
        print(f"{game}: {dll.stat().st_size} bytes")
    manifest.write_text(json.dumps(games, indent=2) + "\n")


if __name__ == "__main__":
    main()

"""Black / White builds of the item expansion (imported by build.py for --game B / W).

Retail symbols come from the aletheia decomp (runtime/anim-streams/bw1.py: function tables for Black and White);
binaries from clean ROMs (BW1_ROM_B / BW1_ROM_W, default ../cleanblack.nds and ../cleanwhite.nds) or extracts
(BW1_EXTRACT_B / BW1_EXTRACT_W). Data objects are found through the retail functions that reference them: a pool
word of a Black function names the object (aletheia's Black address), and the same pool slot of the same function
in White gives White's address.
"""
import os
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.append(str(HERE.parent / "anim-streams"))
import bw1  # noqa: E402

PAL_PAD_SIZE = 0x6FC
BAG_SIZE = 0x1000
RETAIL_BAG_SIZE = 0x9C0
RETAIL_TRADE_HISTORY_SIZE = 0xD54
ITEM_LAST = 0x272
CFLAGS = ["-std=gnu99", "-mthumb", "-mcpu=arm946e-s", "-Os", "-ffreestanding", "-fno-builtin", "-fno-short-enums",
          "-ffunction-sections", "-fdata-sections", "-fno-jump-tables", "-fno-unwind-tables",
          "-fno-asynchronous-unwind-tables", "-Wall", "-Werror", "-Wno-unused-function"]

# Pool replacements of the retail bag functions (THUMB_BRANCH at each entry).
POOL_HOOKS = {
    "HOOK_MYITEM_Init": "MYITEM_SAVEDATA_Init",
    "HOOK_MYITEM_CopyPocket": "MYITEM_SAVEDATA_CopyPocket",
    "HOOK_MYITEM_GetPocket": "MYITEM_SAVEDATA_GetPocket",
    "HOOK_MYITEM_GetPocketOfItem": "MYITEM_SAVEDATA_GetPocketOfItem",
    "HOOK_MYITEM_FindAddSlotForItem": "MYITEM_SAVEDATA_FindAddSlotForItem",
    "HOOK_MYITEM_CanAddItem": "MYITEM_SAVEDATA_CanAddItem",
    "HOOK_MYITEM_AddItem": "MYITEM_SAVEDATA_AddItem",
    "HOOK_MYITEM_FindItemSlot": "MYITEM_SAVEDATA_FindItemSlot",
    "HOOK_MYITEM_RemoveItem": "MYITEM_SAVEDATA_RemoveItem",
    "HOOK_MYITEM_HasItem": "MYITEM_SAVEDATA_HasItem",
    "HOOK_MYITEM_CountUsedSlotsInPocket": "MYITEM_SAVEDATA_CountUsedSlotsInPocket",
    "HOOK_MYITEM_GetItemQuantity": "MYITEM_SAVEDATA_GetItemQuantity",
    "HOOK_MYITEM_CompactAllPockets": "MYITEM_SAVEDATA_CompactAllPockets",
    "HOOK_MYITEM_GetSlot": "MYITEM_SAVEDATA_GetSlot",
}
CORE_HOOKS = {
    "HOOK_SAVE_CONTROL_ERASE": "SAVE_CONTROL_EraseMainSave",
    "HOOK_FILE_UTIL_GET": "FILE_UTIL_Get",
    "HOOK_FILE_UTIL_LOAD_ITEM_RECORD": "FILE_UTIL_LoadItemRecord",
}
# The retail item ID limit 626 (0x272) becomes 1023 in these readers: Pokémon held items, item data / text.
ITEM_LITERALS = ["POKE_TOOL_GetBoxValueRaw", "POKE_TOOL_SetBoxValueRaw", "FILE_UTIL_LoadArcMember",
                 "FILE_UTIL_ReadString", "FILE_UTIL_ReadStringAlt"]
# Data objects the runtime reads: (C name, Black address, a Black function whose pool names it).
DATA = [
    ("PW_ITEM_GFX_MEMBER", 0x0209EB6C, "FILE_UTIL_Get"),
    ("PW_ITEM_GFX_MEMBER_X", 0x0209E9E8, "FILE_UTIL_Get"),
]
MAIN_SAVE_DESC = (0x0209D938, "SAVE_CONTROL_Create")  # SaveDataParam of the main save; +0x14 is its magic
# The battle bag's pocket tables (u8[3] field pockets it scans, u8[4] battle pocket of each battle-pocket bit).
BBAG_TABLES = ((0x0220DB3C, 3, "PW_BBAG_FIELD_POCKETS"), (0x0220DB3F, 4, "PW_BBAG_BATTLE_POCKETS"))

# Field bag (overlay 70): replaced functions and redirected calls (C name -> retail name / (caller, callee)).
BAG_HOOKS = {
    "HOOK_ITEMMENU_GetSlot": "ITEMMENU_GetSlot",
    "HOOK_ITEMMENU_GetItemCount": "ITEMMENU_GetItemCount",
    "HOOK_ITEMMENU_SwapSlots": "ITEMMENU_SwapSlots",
    "HOOK_ITEMMENU_SortPocket": "ITEMMENU_SortPocket",
}
BAG_CALLS = {
    "HOOK_BAG_MOVE_CLEAR": [("ITEMMENU_TaskBagMain", "MI_CpuFill8", 1)],
    "HOOK_BAG_MOVE_COPY": [("ITEMMENU_TaskBagMain", "MYITEM_SAVEDATA_CopyPocket", 1),
                           ("ITEMMENU_TaskListInput", "MYITEM_SAVEDATA_CopyPocket", 2)],
    "HOOK_BAG_EXIT_FREE": [("ITEMMENU_Exit", "ITEMMENU_FreePalAnmSlots", 1)],
}
# Battle bag (overlay 197).
BBAG_HOOKS = {
    "HOOK_BBAG_BuildPocketLists": "B_BAG_MAIN_BuildPocketLists",
    "HOOK_BBAG_GetSlotItem": "B_BAG_MAIN_GetSlotItem",
    "HOOK_BBAG_SyncCursorToItem": "B_BAG_MAIN_SyncCursorToItem",
}
BBAG_CALLS = {
    "HOOK_BBAG_DRAW_NAME": [("B_BAG_MAIN_DrawSlot", "B_BAG_MAIN_DrawItemName", 1)],
    "HOOK_BBAG_DRAW_INFO": [("B_BAG_MAIN_DrawSlot", "B_BAG_MAIN_DrawItemInfo", 1),
                            ("B_BAG_MAIN_DrawOtherPage", "B_BAG_MAIN_DrawItemInfo", 1)],
    "HOOK_BBAG_DRAW_DESCRIPTION": [("B_BAG_MAIN_DrawOtherPage", "B_BAG_MAIN_DrawDescription", 1)],
    "HOOK_BBAG_DRAW_USAGE": [("B_BAG_MAIN_DrawOtherPage", "B_BAG_MAIN_DrawItemUsage", 1)],
    "HOOK_BBAG_EXIT_FREE": [("B_BAG_MAIN_StateExit", "GFL_HEAP_Free", 1)],
}


class Inputs:
    def __init__(self, game):
        workspace = HERE.parents[2]
        aletheia = Path(os.environ.get("ALETHEIA", workspace / "aletheia"))
        self.game = game
        self.symbols = bw1.Bw1Symbols(aletheia, game)
        extract = os.environ.get(f"BW1_EXTRACT_{game}")
        rom = os.environ.get(f"BW1_ROM_{game}", workspace / ("cleanblack.nds" if game == "B" else "cleanwhite.nds"))
        self.binaries = bw1.ExtractBinaries(extract) if extract else bw1.RomBinaries(rom)

    def function(self, name):
        segment, address, size, isa = self.symbols.get(name)
        return segment, address & ~1, size, isa

    def code(self, name):
        segment, address, size, _ = self.function(name)
        return segment, address, self.binaries.read(segment, address, size)

    def pool(self, name):
        """(offset, word) of every 4-aligned word in the function and the 64 bytes after it (its pool)."""
        segment, address, size, _ = self.function(name)
        data = self.binaries.read(segment, address, size + 64)
        start = (-address) % 4
        return [(i, struct.unpack_from("<I", data, i)[0]) for i in range(start, len(data) - 3, 4)]


class Symbols:
    """link_dll's symbols interface: aletheia functions plus the data objects found for this game."""

    def __init__(self, inputs, data):
        self.inputs, self.data = inputs, data

    def resolve(self, name, segments):
        if name in self.data:
            return "ARM9", (self.data[name], "object", "", 0)
        return self.inputs.symbols.resolve(name, segments)

    def size_at(self, segment, address):
        return self.inputs.symbols.size_at(segment, address)


def data_address(black, game, function, black_address):
    """The game's address of a data object, by the pool slot that holds it in `function`."""
    slots = [offset for offset, word in black.pool(function) if word == black_address]
    if len(slots) != 1:
        raise RuntimeError(f"{function}: expected one pool word 0x{black_address:08x}, found {len(slots)}")
    if game is black:
        return black_address
    if game.function(function)[2] != black.function(function)[2]:
        raise RuntimeError(f"{function}: Black and White sizes differ")
    return dict(game.pool(function))[slots[0]]


def find_literal(inputs, function, value):
    """The one pool word `value` of `function`, loaded by exactly one PC-relative load."""
    segment, address, code = inputs.code(function)
    pool = inputs.binaries.read(segment, address, len(code) + 64)
    hits = [address + i for i in range((-address) % 4, len(pool) - 3, 4) if struct.unpack_from("<I", pool, i)[0] == value]
    loads = {}
    for i in range(0, len(code) - 1, 2):
        insn = struct.unpack_from("<H", code, i)[0]
        if insn & 0xF800 == 0x4800:
            loads.setdefault(((address + i + 4) & ~3) + (insn & 0xFF) * 4, []).append(address + i)
    hits = [h for h in hits if len(loads.get(h, [])) == 1]
    if len(hits) != 1:
        raise RuntimeError(f"{inputs.game} {function}: expected one singly-loaded literal 0x{value:x}, found {len(hits)}")
    return segment, hits[0]


def find_bls(inputs, caller, callee, count=1):
    """The BL / BLX sites in `caller` that call `callee`; exactly `count` of them."""
    segment, address, code = inputs.code(caller)
    target = inputs.function(callee)[1]
    hits = []
    for i in range(0, len(code) - 3, 2):
        hi, lo = struct.unpack_from("<HH", code, i)
        if hi & 0xF800 == 0xF000 and lo & 0xE800 == 0xE800:
            offset = ((hi & 0x7FF) << 12) | ((lo & 0x7FF) << 1)
            if offset & 0x400000:
                offset -= 0x800000
            dest = address + i + 4 + offset
            if lo & 0x1000 == 0:  # BLX: ARM target, word aligned
                dest &= ~3
            if dest == target:
                hits.append(address + i)
    if len(hits) != count:
        raise RuntimeError(f"{inputs.game} {caller}: expected {count} BL to {callee}, found {len(hits)}")
    return [(segment, hit) for hit in hits]


def find_bl(inputs, caller, callee):
    return find_bls(inputs, caller, callee)[0]


def build_bw1_game(items, game, version, out_root):
    """The Black / White DLLs; `items` is build.py (its link_dll, describe, hook_name and tools)."""
    black = Inputs("B")
    inputs = black if game == "B" else Inputs("W")
    out = out_root / game
    out.mkdir(parents=True, exist_ok=True)
    data = {name: data_address(black, inputs, fn, addr) for name, addr, fn in DATA}
    bbag_data = ""
    for black_address, size, name in BBAG_TABLES:
        address = data_address(black, inputs, "B_BAG_MAIN_BuildPocketLists", black_address)
        values = inputs.binaries.read("197", address, size)
        bbag_data += f"static const u8 {name}[{size}] = {{ {', '.join(str(v) for v in values)} }};\n"
    desc = data_address(black, inputs, MAIN_SAVE_DESC[1], MAIN_SAVE_DESC[0])
    symbols = Symbols(inputs, data)
    manifest = {"dlls": {}}

    def word(segment, address):
        return struct.unpack("<I", inputs.binaries.read(segment, address, 4))[0]

    def compile_all(name, sources, header):
        (out / "bw1_addr.h").write_text(header)
        (out / "bbag_data.h").write_text(bbag_data)
        objs = []
        for src in sources:
            obj = out / f"{name}_{Path(src).stem}.o"
            items.run(items.tool("arm-none-eabi-gcc"), *CFLAGS, "-I", out, "-I", HERE / "bw1", "-c", HERE / src, "-o", obj)
            objs.append(obj)
        return objs

    def asm(name, text):
        path = out / f"{name}.s"
        path.write_text(text)
        obj = out / f"{name}.o"
        items.run(items.tool("arm-none-eabi-as"), "-mthumb", "-mcpu=arm946e-s", path, "-o", obj)
        return obj

    # ---- Core (ARM9, resident) ----
    hooks = {}
    for macro, function in {**POOL_HOOKS, **CORE_HOOKS}.items():
        segment, address, size, isa = inputs.function(function)
        if isa != "thumb" or size < 12:
            raise RuntimeError(f"{game} {function}: cannot take a THUMB_BRANCH ({isa}, {size} bytes)")
        hooks[macro] = items.hook_name("THUMB_BRANCH", segment, address)
    segment, site = find_bl(inputs, "GFL_USE_InitGameSystems", "SAVE_CONTROL_Create")
    hooks["HOOK_SAVE_CONTROL_CREATE_CALL"] = items.hook_name("THUMB_BRANCH_LINK", segment, site)
    header = "".join(f"#define {k} {v}\n" for k, v in hooks.items())

    edits = [(*find_literal(inputs, fn, ITEM_LAST), 0x3FF) for fn in ITEM_LITERALS]
    edits.append((*find_literal(inputs, "TRADE_HISTORY_GetSize", RETAIL_TRADE_HISTORY_SIZE), PAL_PAD_SIZE))
    if word("ARM9", desc + 0x14) != 0x31053527 or word("ARM9", desc + 0x10) != 0x24000:
        raise RuntimeError(f"{game}: main save descriptor not found at 0x{desc:08x}")
    edits.append(("ARM9", desc + 0x14, 0x32495750))
    # MYITEM_SAVEDATA_GetSize is `movs r0, #0x27; lsls r0, r0, #6; bx lr` (0x9c0): it becomes 0x1000.
    segment, address, code = inputs.code("MYITEM_SAVEDATA_GetSize")
    if code[:4] != bytes.fromhex("27208001") or address % 4:
        raise RuntimeError(f"{game}: MYITEM_SAVEDATA_GetSize is not the retail 0x9c0 form")
    edits.append(("ARM9", address, 0x03002001))  # movs r0, #1; lsls r0, r0, #12
    objs = compile_all("core", ["bw1/core.c", "bw1/pool.c", "bw1/catalog.c"], header)
    objs.append(asm("core_literals", items.literal_asm(edits)))
    roots = list(hooks.values()) + [f"FULL_COPY_{s}_0x{a:08x}" for s, a, _ in edits] + ["gPwItemCatalog", "gPwItemPockets"]
    dll, dump = items.link_dll(out, f"PokewebItemsCore{game}", objs, roots, symbols, ["ARM9"], game, version, ["ARM9"])
    manifest["dlls"]["core"] = items.describe(dll, dump, edits, original=lambda s, a: inputs.binaries.read(s, a, 4))

    def hooks_for(replaced, calls):
        found = {}
        for macro, function in replaced.items():
            segment, address, size, isa = inputs.function(function)
            if isa != "thumb" or size < 12:
                raise RuntimeError(f"{game} {function}: cannot take a THUMB_BRANCH ({isa}, {size} bytes)")
            found[macro] = [items.hook_name("THUMB_BRANCH", segment, address)]
        for macro, sites in calls.items():
            found[macro] = [items.hook_name("THUMB_BRANCH_LINK", segment, site)
                            for caller, callee, count in sites for segment, site in find_bls(inputs, caller, callee, count)]
        # A wrapper reached from several call sites: HOOK_X is the first site, HOOK_X_2, HOOK_X_3 ... the others
        # (the C source defines those as aliases of HOOK_X).
        header = "".join(f"#define {macro if i == 0 else f'{macro}_{i + 1}'} {name}\n"
                         for macro, names in found.items() for i, name in enumerate(names))
        return found, header

    def overlay_dll(part, name, segment, sources, replaced, calls, extra_roots=()):
        found, header = hooks_for(replaced, calls)
        objs = compile_all(name, sources, header)
        roots = [n for names in found.values() for n in names] + list(extra_roots)
        dll, dump = items.link_dll(out, name, objs, roots, symbols, [segment, "ARM9"], game, version, [segment])
        manifest["dlls"][part] = items.describe(dll, dump, [], None)

    # The overlay parts need no catalog: the pool (core) answers every item question.
    overlay_dll("bag", f"PokewebItemsBag{game}", "70", ["bw1/bag.c"], BAG_HOOKS, BAG_CALLS)
    overlay_dll("battleBag", f"PokewebItemsBattleBag{game}", "197", ["bw1/bbag.c"], BBAG_HOOKS, BBAG_CALLS)

    # ---- Field (overlay 21): wild Pokémon held items above 626; Battle (overlay 93): BattleMon keeps them ----
    for part, name, segment, function in (("field", f"PokewebItemsField{game}", "21", "FIELD_ENCOUNT_InitWildPokemon"),
                                          ("battle", f"PokewebItemsBattle{game}", "93", "BTL_POKEPARAM_Create")):
        part_edits = [(*find_literal(inputs, function, ITEM_LAST), 0x3FF)]
        obj = asm(f"{part}_literals", items.literal_asm(part_edits))
        roots = [f"FULL_COPY_{s}_0x{a:08x}" for s, a, _ in part_edits]
        dll, dump = items.link_dll(out, name, [obj], roots, symbols, [segment, "ARM9"], game, version, [segment])
        manifest["dlls"][part] = items.describe(dll, dump, part_edits, original=lambda s, a: inputs.binaries.read(s, a, 4))
    return manifest

"""Build the Pokeweb item expansion DLLs (1,024 item IDs, pokebw2's shared bag and its save format).

    python3 runtime/item-expansion/build.py [--game W2|B2|B|W] [--test]

Inputs:
  * runtime/item-expansion/pokebw2/   vendored pokebw2 sources and headers (see pokebw2/REVISION)
  * POKEBW2_CONFIG (default ../pokebw2/config relative to the workspace): pokebw2's symbol tables
  * games.json: per game, the retail binaries used to verify every in-place literal edit

Black / White (--game B / W) are built by build_bw1.py from the aletheia decomp's symbols and clean ROMs.

Outputs (src/assets/codeinjection unless --test): PokewebItems{Core,Bag,BattleBag,Field,Battle}<game>.dll and
itemExpansionManifest.json (hook targets, literal edits, table tags).
"""
import argparse
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORKSPACE = REPO.parent
sys.path.insert(0, str(HERE))
from generate import generate  # noqa: E402

TOOLS = Path(os.environ.get(
    "ARM_TOOLCHAIN_BIN", WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"))
JAR = Path(os.environ.get("RPM_TOOL_JAR", WORKSPACE / "pw2-build-work/ctrmap/CTRMap.jar"))
CONFIG = Path(os.environ.get("POKEBW2_CONFIG", WORKSPACE.parent / "pokebw2/config"))
VENDOR = HERE / "pokebw2"
INCLUDES = [HERE / "include", HERE / "src", None, VENDOR / "include", VENDOR / "lib/nitro/include",
            VENDOR / "lib/nnsys/include", VENDOR / "lib/twl/include"]
DEFINES = ["WHITE2", "W2U_EXPANDED_ITEMS"]
CFLAGS = ["-std=gnu99", "-mthumb", "-mcpu=arm946e-s", "-Os", "-ffreestanding", "-fno-builtin", "-fno-short-enums",
          "-ffunction-sections", "-fdata-sections", "-fno-jump-tables", "-fno-unwind-tables",
          "-fno-asynchronous-unwind-tables", "-D__thumb", "-Wall", "-Wno-unused-function", "-Wno-unused-variable",
          "-Wno-missing-braces", "-Wno-pointer-sign", "-Wno-unused-but-set-variable", "-Wno-parentheses",
          "-Wno-incompatible-pointer-types", "-Wno-int-conversion", "-Wno-unknown-pragmas",
          "-Werror=implicit-function-declaration"]

POOL_HOOKS = [
    "BagSave_Init", "BagSave_GetPocketItems", "BagSave_CheckAvailItemSpace",
    "BagSave_AddItem", "BagSave_AddItemAsFirst", "BagSave_CheckAmount", "BagSave_SubItem",
    "BagSave_IsItemFreeSpaceBit", "BagSave_IsItemInFreeSpace", "BagSave_MoveBetweenFreeSpace",
    "BagSave_GetExistingItemPocket", "BagSave_GetActualItemPocket", "BagSave_GetItemCountByID",
    "BagSave_GetExistingItemCount", "BagSave_GetItemHandle", "BagSave_GetItemIndexHandle",
    "BagSave_GetUniqueItemCount", "BagSave_GetPocketItemCountCore", "BagSave_GetPocketItemCount",
    "BagSave_ForceItemAsLast", "BagSave_CopyPocketRaw", "BagSave_CopyPocket", "sortItemBlocks",
    "BagSave_SwitchOwnedDNASplicers", "PML_ItemGetMaxStorageCount", "BagSave_GetOwnedItemFlags",
]
ITEM_MENU_HOOKS = [
    "ItemMenu_GetSlot", "ItemMenu_GetItemCount", "ItemMenu_SwapItems", "ItemMenu_StateMoveItem",
    "ItemMenu_StateList", "ItemMenu_SortByType", "ItemMenu_SortByName", "ItemMenu_SortByNumber",
    "ItemMenu_SortByUses", "ItemMenuProc_Init", "ItemMenuProc_Main", "ItemMenuProc_Exit",
]
ITEM_LITERALS = [  # (function, retail word, new word): the retail item ID limit 638 becomes 1023
    "PML_PkmGetParamCore", "PML_PkmSetParamCore", "PML_ItemArcHandleReadFile", "PML_ItemReadDataFile",
    "setItemNameToStrbuf", "setItemDescriptionTextToStrbuf",
]
PW_SAVE_MAGIC = 0x32495750
RETAIL_SAVE_MAGIC = 0x31053527
PAL_PAD_SIZE = 0x6FC


def tool(name):
    path = TOOLS / name
    return str(path) if path.exists() else name


def run(*args, **kw):
    return subprocess.run([str(a) for a in args], check=True, **kw)


class Symbols:
    """pokebw2 symbol tables for one game: name -> (segment, address, kind)."""

    def __init__(self, version):
        root = CONFIG / version / "arm9"
        self.by_segment = {"ARM9": self._read(root / "symbols.txt")}
        for sub in ("itcm", "dtcm", "ltd_autoload_0", "autoload_3"):
            if (root / sub / "symbols.txt").exists():
                self.by_segment["ARM9"].update(self._read(root / sub / "symbols.txt"))
        for ov in sorted((root / "overlays").iterdir()):
            self.by_segment[str(int(ov.name[2:]))] = self._read(ov / "symbols.txt")

    @staticmethod
    def _read(path):
        out = {}
        for line in path.read_text().splitlines():
            m = re.match(r"(\S+) kind:(\w+)\(([^)]*)\) addr:(0x[0-9a-f]+)", line)
            if m:
                size = re.search(r"size=(0x[0-9a-f]+)", m.group(3))
                out[m.group(1)] = (int(m.group(4), 16), m.group(2), m.group(3), int(size.group(1), 16) if size else 0)
        return out

    def addresses(self, segment):
        return {name: v[0] for name, v in self.by_segment[segment].items()}

    def get(self, segment, name):
        return self.by_segment[segment][name]

    def size_at(self, segment, address):
        for addr, kind, _, size in self.by_segment[segment].values():
            if addr == address and kind == "function":
                return size
        return None

    def resolve(self, name, segments):
        for segment in segments:
            entry = self.by_segment.get(segment, {}).get(name)
            if entry:
                return segment, entry
        return None, None


class Binaries:
    def __init__(self, game_cfg):
        os.environ.setdefault("POKEBW2_EXTRACT", str(WORKSPACE.parent / "pokebw2/extract"))
        self.root = Path(os.path.expandvars(game_cfg["binaries"])).expanduser()
        self.overlays = {o["id"]: o["base_address"] for o in self._overlay_table()}

    def _overlay_table(self):
        import yaml
        table = yaml.safe_load((self.root / "arm9_overlays/overlays.yaml").read_text())
        return table["overlays"] if isinstance(table, dict) else table

    def read(self, segment, address, size):
        if segment == "ARM9":
            data, base = (self.root / "arm9/arm9.bin").read_bytes(), 0x02004000
        else:
            data = (self.root / f"arm9_overlays/ov{int(segment):03d}.bin").read_bytes()
            base = self.overlays[int(segment)]
        return data[address - base:address - base + size]


def find_literal(symbols, binaries, segment, function, value):
    address, _, _, size = symbols.get(segment, function)
    code = binaries.read(segment, address, size)
    hits = [address + i for i in range(-(address & 3) % 4, len(code) - 3, 4)
            if struct.unpack_from("<I", code, i)[0] == value]
    if len(hits) != 1:
        raise RuntimeError(f"{function}: expected one literal 0x{value:x}, found {[hex(h) for h in hits]}")
    # Exactly one PC-relative load of it, so the edit cannot change another use of the same pool word.
    loads = 0
    for i in range(0, len(code) - 1, 2):
        insn = struct.unpack_from("<H", code, i)[0]
        if insn & 0xF800 == 0x4800 and ((address + i + 4) & ~3) + (insn & 0xFF) * 4 == hits[0]:
            loads += 1
    if loads != 1:
        raise RuntimeError(f"{function}: literal at 0x{hits[0]:x} has {loads} loads")
    return hits[0]


def literal_asm(edits):
    lines = [".section .rodata.pw_literals", ".align 2"]
    for segment, address, value in edits:
        name = f"FULL_COPY_{segment}_0x{address:08x}"
        lines += [f".global {name}", f"{name}:", f".word 0x{value:08x}", f".size {name}, 4"]
    return "\n".join(lines) + "\n"


def compile_unit(out, name, source_text, includes, game_defines):
    path = out / f"{name}.c"
    path.write_text(source_text)
    obj = out / f"{name}.o"
    args = [tool("arm-none-eabi-gcc"), *CFLAGS, *[f"-D{d}" for d in DEFINES + game_defines]]
    for inc in includes:
        args += ["-I", str(inc)]
    run(*args, "-c", path, "-o", obj)
    return obj


EABI_ALIASES = {"__aeabi_idiv": "_s32_div_f", "__aeabi_idivmod": "_s32_div_f",
                "__aeabi_uidiv": "_u32_div_f", "__aeabi_uidivmod": "_u32_div_f"}


def undefined_symbols(elf):
    out = subprocess.check_output([tool("arm-none-eabi-nm"), "-u", str(elf)]).decode().split()
    return sorted({u for u in out if u != "U"})


def absolute_symbols(names, symbols, segments, out, stem):
    """Retail symbols as absolute values, so the DLL's only extern modules are the segments it hooks.

    PMC keeps a DLL that names ARM9 resident, and loads a DLL whenever any overlay it names is loaded. Retail code
    and data never move (overlays always load at their fixed base), so calls and data references are resolved to
    absolute addresses; RPMTool keeps them as global symbols of the DLL itself.
    """
    lines = []
    missing = []
    for name in names:
        # GCC's EABI division helpers: the retail MWCC routines return the quotient in r0 and the remainder in r1,
        # which is the __aeabi_(u)idivmod contract (and a superset of __aeabi_(u)idiv's).
        target = EABI_ALIASES.get(name, name)
        if target.endswith("__retail"):  # the retail address of a replaced function (see generate.py)
            target = target[: -len("__retail")]
        segment, entry = symbols.resolve(target, segments)
        if not entry:
            missing.append(name)
            continue
        address, kind, detail, _ = entry
        lines.append(f".global {name}")
        if kind == "function":
            lines.append(f".type {name}, %function")
            if detail.startswith("thumb"):
                address |= 1
        lines.append(f".set {name}, 0x{address:08x}")
    if missing:
        raise RuntimeError(f"{stem}: no retail symbol for {missing}")
    path = out / f"{stem}.abs.s"
    path.write_text("\n".join(lines) + "\n")
    obj = out / f"{stem}.abs.o"
    run(tool("arm-none-eabi-as"), path, "-o", obj)
    return obj


def libgcc():
    return subprocess.check_output([tool("arm-none-eabi-gcc"), "-mthumb", "-mcpu=arm946e-s",
                                    "-print-libgcc-file-name"]).decode().strip()


def link_dll(out, name, objects, roots, symbols, segments, game, version, hook_segments):
    stage = out / f"{name}.gc.elf"
    run(tool("arm-none-eabi-ld"), "-r", "--gc-sections", *[f"--undefined={r}" for r in roots], *objects, "-o", stage)
    elf = out / f"{name}.elf"
    absolute = absolute_symbols(undefined_symbols(stage), symbols, segments, out, name)
    run(tool("arm-none-eabi-ld"), "-r", stage, absolute, "-o", elf)
    if undefined_symbols(elf):
        raise RuntimeError(f"{name}: unresolved {undefined_symbols(elf)}")
    esdb = out / f"{name}.esdb.yml"
    rows = ["Segments:"]
    for index, segment in enumerate(hook_segments):
        rows += [f"  - ID: {index}", "    Name: ARM9" if segment == "ARM9" else f'    Name: "{segment}"',
                 "    Type: EXECUTABLE" if segment == "ARM9" else "    Type: OVERLAY"]
    esdb.write_text("\n".join(rows) + "\nSymbols: []\n")
    meta = out / f"{name}.meta.yml"
    meta.write_text(f"PMCGameID: {game}\nPMCModulePriority: 4\nPMCVersion: {version}\n")
    dll = out / f"{name}.dll"
    dll.unlink(missing_ok=True)
    run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", elf, "--fourcc", "DLXF", "-o", dll, "--esdb", esdb, "--meta",
        meta, "--generate-relocations", "--strip", stdout=subprocess.DEVNULL)
    dump = subprocess.check_output(["java", "-cp", str(JAR), "rpm.cli.RPMDump", "--fourcc", "DLXF", "-i",
                                    str(dll)], stderr=subprocess.DEVNULL).decode()
    (out / f"{name}.dump.txt").write_text(dump)
    if "Import symbol" in dump:
        raise RuntimeError(f"{name}: unresolved imports remain")
    for kind, segment, address in re.findall(r"Target: (THUMB_BRANCH(?:_SAFESTACK)?) @ (\S+) :: (\S+)", dump):
        need = 16 if kind.endswith("SAFESTACK") else 12  # libRPM's patch sizes, as Pokeweb budgets them
        size = symbols.size_at(segment, int(address, 16))
        if size is None or size < need:
            raise RuntimeError(f"{name}: {kind} at {address} needs {need} bytes, function has {size}")
    modules = set(re.findall(r"Target: \S+ @ (\S+) ::", dump)) - {"base"}
    if modules - set(hook_segments):
        raise RuntimeError(f"{name}: unexpected extern modules {modules}")
    return dll, dump


def hook_name(kind, segment, address):
    return f"{kind}_{segment}_0x{address & ~1:08x}"


def build_game(game, cfg, version, out_root):
    symbols = Symbols(cfg["pokebw2"])
    binaries = Binaries(cfg)
    out = out_root / game
    out.mkdir(parents=True, exist_ok=True)
    includes = [p if p is not None else out for p in INCLUDES]
    gdef = cfg.get("defines", [])
    manifest = {"dlls": {}}

    def addr(segment, name):
        return symbols.get(segment, name)[0]

    def unit(name, source, segment, hooks, keep=()):
        text, renames = generate({"source": VENDOR / source, "segment": segment, "hooks": hooks, "keep": keep},
                                 includes, DEFINES + gdef, symbols.addresses(segment), tool("arm-none-eabi-gcc"))
        return compile_unit(out, name, text, includes, gdef), renames

    def own(name, sources):
        objs = []
        for src in sources:
            obj = out / f"{name}_{Path(src).stem}.o"
            args = [tool("arm-none-eabi-gcc"), *CFLAGS, *[f"-D{d}" for d in DEFINES + gdef]]
            for inc in includes:
                args += ["-I", str(inc)]
            run(*args, "-c", HERE / src, "-o", obj)
            objs.append(obj)
        return objs

    def asm(name, text):
        path = out / f"{name}.s"
        path.write_text(text)
        obj = out / f"{name}.o"
        run(tool("arm-none-eabi-as"), "-mthumb", "-mcpu=arm946e-s", path, "-o", obj)
        return obj

    # Layout of the override headers against the retail offsets.
    run(tool("arm-none-eabi-gcc"), *CFLAGS, *[f"-D{d}" for d in DEFINES + gdef],
        *sum((["-I", str(i)] for i in includes), []), "-fsyntax-only", HERE / "layout_check.c")

    # ---- Core (ARM9, resident) ----
    create_call = find_bl(symbols, binaries, "ARM9", "GameInit", addr("ARM9", "SaveControl_Create"))
    core_hooks = {
        "HOOK_SAVE_CONTROL_CREATE_CALL": hook_name("THUMB_BRANCH_LINK", "ARM9", create_call),
        "HOOK_SAVE_CONTROL_ERASE": hook_name("THUMB_BRANCH", "ARM9", addr("ARM9", "SaveControl_Erase")),
        "HOOK_GET_ITEM_GRAPHICS_DAT_ID": hook_name("THUMB_BRANCH", "ARM9", addr("ARM9", "GetItemGraphicsDatID")),
        "HOOK_ITEM_IS_UNHOLDABLE": hook_name("THUMB_BRANCH", "ARM9", addr("ARM9", "PML_ItemIsUnholdable")),
        "HOOK_ITEM_IS_DUMMY": hook_name("THUMB_BRANCH", "ARM9", addr("ARM9", "PML_ItemIsDummy")),
    }
    (out / "core_addr.h").write_text("".join(f"#define {k} {v}\n" for k, v in core_hooks.items()))
    edits = [("ARM9", find_literal(symbols, binaries, "ARM9", fn, 0x27E), 0x3FF) for fn in ITEM_LITERALS]
    edits.append(("ARM9", find_literal(symbols, binaries, "ARM9", "PalPadFriendList_GetSize", 0xD54), PAL_PAD_SIZE))
    magic_at = addr("ARM9", "save_block_data") + 0x14
    if struct.unpack("<I", binaries.read("ARM9", magic_at, 4))[0] != RETAIL_SAVE_MAGIC:
        raise RuntimeError("save_block_data: retail magic not found")
    edits.append(("ARM9", magic_at, PW_SAVE_MAGIC))
    # BagSave_GetBlockSize is 8 bytes (a literal load): its literal becomes 0x1080. BagSave_MoveBetweenFreeSpace is
    # an 8-byte tail call; the static helper it calls, with the same arguments, is patched instead.
    edits.append(("ARM9", find_literal(symbols, binaries, "ARM9", "BagSave_GetBlockSize", 0x9EC), 0x1080))
    pool_hooks = {n: "THUMB_BRANCH" for n in POOL_HOOKS}
    pool_hooks["BagSave_MoveBetweenFreeSpace"] = ("THUMB_BRANCH", "BagSave_MoveBetweenFreeSpace_")
    pool, pool_renames = unit("myitem_savedata", "src/system/myitem_savedata.c", "ARM9", pool_hooks,
                              keep=["BagSave_GetBlockSize"])
    objs = own("core", ["src/core.c", "src/catalog.c"]) + [pool, asm("core_literals", literal_asm(edits))]
    roots = list(core_hooks.values()) + list(pool_renames.values()) + [
        f"FULL_COPY_{s}_0x{a:08x}" for s, a, _ in edits] + ["gPwItemCatalog"]
    dll, dump = link_dll(out, f"PokewebItemsCore{game}", objs, roots, symbols, ["ARM9"], game, version, ["ARM9"])
    manifest["dlls"]["core"] = describe(dll, dump, edits, original=lambda s, a: binaries.read(s, a, 4))

    # ---- Field bag (overlay 142) ----
    # BagItemList_Exit is a 2-byte bx lr in retail; its callers (ItemMenuProc_Init/Exit) are replaced and call the
    # DLL's own copy, so its entry is not patched.
    bag, bag_renames = unit("bag_item", "src/ov142/bag_item.c", "142",
                            {n: "THUMB_BRANCH" for n in native_functions(VENDOR / "src/ov142/bag_item.c",
                                                                           symbols.addresses("142"))
                             if n != "BagItemList_Exit"}, keep=["BagItemList_Exit"])
    menu, menu_renames = unit("itemmenu", "src/ov142/itemmenu.c", "142", {n: "THUMB_BRANCH" for n in ITEM_MENU_HOOKS})
    objs = own("bag", ["src/catalog.c", "src/sortrank.c", "src/heap_shim.c"]) + [bag, menu]
    roots = list(bag_renames.values()) + list(menu_renames.values()) + ["gPwItemCatalog", "gPwItemRanks"]
    dll, dump = link_dll(out, f"PokewebItemsBag{game}", objs, roots, symbols, ["142", "ARM9"], game, version, ["142"])
    manifest["dlls"]["bag"] = describe(dll, dump, [], None)

    # ---- Battle bag (overlay 286) ----
    bbag, bbag_r = unit("b_bag_item", "src/ov286/b_bag_item.c", "286",
                        {n: "THUMB_BRANCH" for n in native_functions(VENDOR / "src/ov286/b_bag_item.c",
                                                                       symbols.addresses("286"))})
    bmp, bmp_r = unit("b_bag_bmp", "src/ov286/b_bag_bmp.c", "286", {
        "BBagBmp_PrintSlotName": "THUMB_BRANCH_SAFESTACK", "BBagBmp_PrintSlotCount": "THUMB_BRANCH_SAFESTACK",
        "BBagBmp_PrintPageNumber": "THUMB_BRANCH", "BBagBmp_PrintChosenName": "THUMB_BRANCH",
        "BBagBmp_PrintDescription": "THUMB_BRANCH"})
    bmain, bmain_r = unit("b_bag_main", "src/ov286/b_bag_main.c", "286", {
        "BBagMain_Start": "THUMB_BRANCH", "BBagMain_StateStepPage": "THUMB_BRANCH", "BBagMain_Exit": "THUMB_BRANCH"})
    objs = own("bbag", ["src/catalog.c", "src/heap_shim.c"]) + [bbag, bmp, bmain]
    roots = list(bbag_r.values()) + list(bmp_r.values()) + list(bmain_r.values()) + ["gPwItemCatalog"]
    dll, dump = link_dll(out, f"PokewebItemsBattleBag{game}", objs, roots, symbols, ["286", "285", "168", "167", "ARM9"], game, version, ["286"])
    manifest["dlls"]["battleBag"] = describe(dll, dump, [], None)

    # ---- Field (overlay 36): shop icon/description, wild held items ----
    shop, shop_r = unit("scrcmd_shop", "src/ov036/scrcmd_shop.c", "36", {
        "ShopUI_LoadItemSprite": "THUMB_BRANCH", "ShopUI_PrintDescription": "THUMB_BRANCH"})
    field_edits = [("36", find_literal(symbols, binaries, "36", "FieldEncount_CreateWildPkm", 0x27E), 0x3FF)]
    objs = own("field", ["src/catalog.c"]) + [shop, asm("field_literals", literal_asm(field_edits))]
    roots = list(shop_r.values()) + [f"FULL_COPY_{s}_0x{a:08x}" for s, a, _ in field_edits] + ["gPwItemCatalog"]
    dll, dump = link_dll(out, f"PokewebItemsField{game}", objs, roots, symbols, ["36", "ARM9"], game, version, ["36"])
    manifest["dlls"]["field"] = describe(dll, dump, field_edits, original=lambda s, a: binaries.read(s, a, 4))

    # ---- Battle (overlay 167): held items above 638 survive BattleMon_Create ----
    battle_edits = [("167", find_literal(symbols, binaries, "167", "BattleMon_Create", 0x27E), 0x3FF)]
    objs = [asm("battle_literals", literal_asm(battle_edits))]
    roots = [f"FULL_COPY_{s}_0x{a:08x}" for s, a, _ in battle_edits]
    dll, dump = link_dll(out, f"PokewebItemsBattle{game}", objs, roots, symbols, ["167", "ARM9"], game, version, ["167"])
    manifest["dlls"]["battle"] = describe(dll, dump, battle_edits, original=lambda s, a: binaries.read(s, a, 4))
    return manifest


def find_bl(symbols, binaries, segment, function, target):
    address, _, _, size = symbols.get(segment, function)
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
    if len(hits) != 1:
        raise RuntimeError(f"{function}: expected one BL to 0x{target:x}, found {[hex(h) for h in hits]}")
    return hits[0]


def native_functions(source, addresses):
    from generate import functions, preprocess, _strip_comments
    includes = [HERE / "include", HERE / "src", VENDOR / "include", VENDOR / "lib/nitro/include",
                VENDOR / "lib/nnsys/include", VENDOR / "lib/twl/include"]
    text = _strip_comments(preprocess(source, includes, DEFINES, tool("arm-none-eabi-gcc")))
    names = []
    for name, quals, *_ in functions(text):
        if name in addresses and "inline" not in quals:
            names.append(name)
    return names


def describe(dll, dump, edits, original):
    blob = dll.read_bytes()
    targets = sorted(set(re.findall(r"Target: (\S+) @ (\S+) :: (\S+)", dump)))
    return {
        "fileName": dll.name,
        "size": len(blob),
        "sha256": hashlib.sha256(blob).hexdigest(),
        "targets": [{"kind": k, "segment": s, "address": a} for k, s, a in targets if s != "base"],
        "literals": [{"segment": s, "address": f"0x{a:08x}", "retail": f"0x{struct.unpack('<I', original(s, a))[0]:08x}",
                      "value": f"0x{v:08x}"} for s, a, v in edits],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", choices=["W2", "B2", "B", "W"], action="append")
    parser.add_argument("--test", action="store_true")
    args = parser.parse_args()
    cfg = json.loads((HERE / "games.json").read_text())
    out_root = HERE / "build"
    shipped = {"version": cfg["version"], "saveMagic": f"0x{PW_SAVE_MAGIC:08x}", "palPadBlockSize": PAL_PAD_SIZE,
               "bagBlockSize": 0x1080, "games": {}}
    for game in args.game or [*cfg["games"], "B", "W"]:
        if game in ("B", "W"):  # Black / White: aletheia symbols (build_bw1.py)
            import build_bw1
            manifest = build_bw1.build_bw1_game(sys.modules[__name__], game, cfg["version"], out_root)
        else:
            manifest = build_game(game, cfg["games"][game], cfg["version"], out_root)
        shipped["games"][game] = manifest
        for part in manifest["dlls"].values():
            print(f"{game} {part['fileName']}: {part['size']} bytes, {len(part['targets'])} targets")
            if not args.test:
                (REPO / "src/assets/codeinjection" / part["fileName"]).write_bytes(
                    (out_root / game / part["fileName"]).read_bytes())
    if not args.test:
        path = REPO / "src/assets/codeinjection/itemExpansionManifest.json"
        previous = json.loads(path.read_text()) if path.exists() else {"games": {}}
        previous.update({k: v for k, v in shipped.items() if k != "games"})
        previous.setdefault("games", {}).update(shipped["games"])
        path.write_text(json.dumps(previous, indent=2) + "\n")


if __name__ == "__main__":
    main()

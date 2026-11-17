"""Extract checked BW2 power and form services. BW1 uses its existing signatures."""
import json
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "item-expansion"))
from build import Symbols, WORKSPACE
from build_bw1 import bw1

signatures = {}
for game, file in (("B2", "cleanblack2.nds"), ("W2", "cleanwhite2.nds")):
    native = Symbols(game.lower() + "_us")
    rom = bw1.RomBinaries(WORKSPACE / file)
    names = ["ServerEvent_GetMovePower", "PML_PersonalGetParamSingle", "PokeParty_GetParam",
             "PokeParty_SetParam", "BattleEventVar_SetMulValue"]
    # A moved copied routine can still be recognized by the services it calls.
    dispatch_names = ["GetMonID", "BattleEventVar_Push", "BattleEventVar_Pop", "BattleEventVar_SetConstValue",
                      "BattleEventVar_SetRewriteOnceValue", "BattleEvent_CallHandlers",
                      "BattleEventVar_GetValue", "PML_MoveGetBasePower", "fixed_round"]
    reverse = {native.resolve(name, ("167", "ARM9"))[1][0]: name for name in names + dispatch_names}
    for name in names:
        module, (addr, _, _, size) = native.resolve(name, ("167", "ARM9"))
        data = rom.read(module, addr, size)
        mask = bytearray(b"\xff" * len(data))
        calls = []
        if name == "ServerEvent_GetMovePower":
            for off in range(0, len(data) - 3, 2):
                hi, lo = struct.unpack_from("<HH", data, off)
                if hi & 0xf800 != 0xf000 or lo & 0xf800 != 0xf800:
                    continue
                delta = (hi & 2047) << 12 | (lo & 2047) << 1
                if delta & 0x400000:
                    delta -= 0x800000
                callee = reverse[addr + off + 4 + delta]
                calls.append({"offset": off, "target": callee})
                mask[off:off + 4] = b"\0" * 4
        pattern = {"hex": data.hex(), "mask": mask.hex()}
        if name not in signatures:
            signatures[name] = {**pattern, "module": module, "calls": calls}
            continue
        previous = signatures[name]
        assert previous["module"] == module and previous["calls"] == calls
        if any((old ^ new) & keep for old, new, keep in zip(bytes.fromhex(previous["hex"]), data, mask, strict=True)):
            previous["variants"] = [pattern]
(HERE.parents[1] / "src/assets/data/abilityFormConversionBindings.json").write_text(json.dumps(signatures, separators=(",", ":")) + "\n")

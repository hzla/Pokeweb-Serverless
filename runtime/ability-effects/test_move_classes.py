"""Check the compiled classification lookup without native battle services."""
import ctypes
import json
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
stock = json.loads((ROOT / "src/assets/data/abilityMoveClasses.json").read_text())
defaults = {}
for bit, key in enumerate(["bite", "pulse", "ball", "slicing", "powder", "wind", "healing"]):
    for move in stock["classes"][key]:
        defaults[move] = defaults.get(move, 0) | (1 << bit)
with tempfile.TemporaryDirectory() as directory:
    library = Path(directory) / "classes.so"
    subprocess.run(["cc", "-shared", "-fPIC", "-O2", *["-D" + flag for flag in [
        "ABILITY_PRIORITY", "ABILITY_LIBRARY", "ABILITY_FILTER_EVENTS",
        "ABILITY_POPUP_GROUPS", "ABILITY_MOVE_CLASSES", "ABILITY_POWER_RATIO",
        "ABILITY_STAT_POPUPS", "ABILITY_CUSTOM_FLAGS"]], str(HERE / "rules.c"), "-o", str(library)], check=True)
    dll = ctypes.CDLL(str(library))
    lookup = dll.AbilityMoveClassBits
    lookup.argtypes = [ctypes.c_uint32]
    lookup.restype = ctypes.c_uint32
    pointer = ctypes.c_void_p.in_dll(dll, "AbilityMoveClassData")
    empty = ctypes.create_string_buffer(b"\x00\x00")
    pointer.value = ctypes.addressof(empty)
    for move in range(1001):
        assert lookup(move) == defaults.get(move, 0), move
    overrides = {16: 0, 33: 34, 352: 0, **{3000 + mask: mask for mask in range(128)}, 65535: 127}
    encoded = len(overrides).to_bytes(2, "little") + b"".join(
        move.to_bytes(2, "little") + mask.to_bytes(2, "little")
        for move, mask in sorted(overrides.items()))
    data = ctypes.create_string_buffer(encoded)
    pointer.value = ctypes.addressof(data)
    for move in [*range(1001), *range(3000, 3128), 65535]:
        assert lookup(move) == overrides.get(move, defaults.get(move, 0)), move
    custom = dll.AbilityMoveHasCustomFlag
    custom.argtypes = [ctypes.c_uint32,ctypes.c_uint32]
    custom.restype = ctypes.c_uint32
    custom_pointer = ctypes.c_void_p.in_dll(dll,"AbilityCustomMoveFlagData")
    pairs = [(0,1),(24,1),(24,242),(999,5),(65535,242)]
    encoded = len(pairs).to_bytes(2,"little") + b"".join(move.to_bytes(2,"little")+flag.to_bytes(2,"little") for move,flag in pairs)
    custom_data = ctypes.create_string_buffer(encoded);custom_pointer.value=ctypes.addressof(custom_data)
    for move in [*range(1001),65535]:
        for flag in [0,1,2,5,241,242,243]:assert bool(custom(move,flag))==((move,flag)in pairs),(move,flag)
print("Custom lookup: independent tags, overlapping assignments, boundary IDs and absent tags passed.")
print("Compiled lookup: stock defaults, every 7-bit mask, explicit clears and expanded IDs passed.")

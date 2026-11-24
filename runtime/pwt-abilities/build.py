"""Compile the Thumb code used by the PWT Ability Selection PMC installer."""
import json
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
PREFIX = os.environ.get("ARM_TOOLCHAIN_PREFIX", "arm-none-eabi-")
BINDINGS = {
    "B2": (0x021627B0, 0x02162648, 0x0201EF1C, 0x0201DA94),
    "W2": (0x021627F0, 0x02162688, 0x0201EF48, 0x0201DAC0),
}
DEFINES = ("READ_SET", "MAKE_PARTY_POKEMON", "GET_PERSONAL_PARAM", "SET_HIDDEN_ABILITY")
ENTRY_NAMES = ("PwtReadSetHook", "PwtMakePartyPokemon")


def run(tool, *args):
    return subprocess.check_output([PREFIX + tool, *map(str, args)], text=True)


def build(work, bindings):
    elf = work / "runtime.elf"
    binary = work / "runtime.bin"
    run("gcc", "-mthumb", "-mcpu=arm946e-s", "-Os", "-ffreestanding", "-fno-builtin",
        "-Wall", "-Wextra", "-Werror", "-nostdlib", "-Wl,-Ttext=0,-e,PwtReadSetHook",
        *(f"-D{name}={address:#x}" for name, address in zip(DEFINES, bindings)),
        HERE / "runtime.c", "-o", elf)
    run("objcopy", "-O", "binary", "-j", ".text", elf, binary)
    symbols = {}
    for line in run("nm", "--defined-only", elf).splitlines():
        address, _, name = line.split()
        if name in ENTRY_NAMES:
            symbols[name] = int(address, 16)
    return {"codeHex": binary.read_bytes().hex(), "entries": [symbols[name] for name in ENTRY_NAMES]}


with tempfile.TemporaryDirectory(prefix="pwt-abilities-") as tmp:
    runtimes = {game: build(Path(tmp), bindings) for game, bindings in BINDINGS.items()}
HERE.joinpath("runtimes.json").write_text(json.dumps(runtimes, indent=2) + "\n")

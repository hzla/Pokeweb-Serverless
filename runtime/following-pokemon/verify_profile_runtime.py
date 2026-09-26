"""Run shared packaged CPU regressions with Black 2 or Italian White 2 bindings."""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from black2_port import HERE as BLACK2_HERE, port_source as port_black2
from italy_port import HERE as ITALY_HERE, port_source as port_italy

assert BLACK2_HERE == ITALY_HERE
HERE = BLACK2_HERE
CASES = ("verify_interactions", "verify_conversation_return", "verify_surf",
         "verify_scenes", "verify_land_input", "verify_land_draw", "verify_transition",
         "verify_cycle", "verify_positioning", "verify_ambient", "verify_render")
RUN_CASES = ("verify_surf", "verify_scenes", "verify_land_input",
             "verify_land_draw", "verify_transition", "verify_cycle", "verify_positioning",
             "verify_ambient", "verify_render")

# The localized Bag-full assertion belongs to the Italian packaged interaction harness.
ITALIAN_BAG_TEST = r'''
call('fwt_unload');bag_adds.clear();setup(0,151,427);fail='bag-full';assert begin()==EVENT
wanted=tuple(map(ord,'La Borsa è piena!'))+(0xffff,)
seen=False
for frame in range(2000):
 if stage()==6:held=pressed=1 if frame%3==0 else 0
 else:held=pressed=0
 done=tick()
 if struct.unpack('<18H',uc.mem_read(STRING,36))==wanted:seen=True
 if done:break
else:raise AssertionError('Italian Bag-full response stuck')
assert seen and not bag_adds and not (struct.unpack('<H',uc.mem_read(BLOCK_C+0x1e,2))[0]&1)
balanced()
print('Italian Bag-full text and rollback passed; no game emulator run.')
'''


def verify(profile: str, rom: Path, only: tuple[str, ...] = ()) -> None:
    if profile not in ("black2", "white2italy"):
        raise ValueError(f"Unsupported profile: {profile}")
    italy = profile == "white2italy"
    suffix = "W2I" if italy else "B2"
    label = "Italian White 2" if italy else "Black 2"
    tag = "italy" if italy else "black2"
    port_source = port_italy if italy else port_black2
    build = Path(os.environ.get("FOLLOWING_BUILD_DIR", HERE / "build" / profile)).resolve()
    build.mkdir(parents=True, exist_ok=True)
    for name in CASES:
        source = port_source((HERE / f"{name}.py").read_text())
        for stem in ("Field", "FollowingEvents"):
            source = source.replace(f"{stem}W2.dll", f"{stem}{suffix}.dll")
            source = source.replace(f"{stem}W2.elf", f"{stem}{suffix}.elf")
        source = source.replace("verify_interactions as h", f"verify_interactions_{tag} as h")
        source = source.replace("verify_conversation_return as r", f"verify_conversation_return_{tag} as r")
        source = source.replace("verify_scenes as s", f"verify_scenes_{tag} as s")
        source = source.replace("'contract.json'", f"'{tag}-contract.json'")
        if name == "verify_surf":
            source = "import sys\n" + source.replace(
                'str(ASSETS.parents[3] / "cleanwhite2.nds")', 'str(Path(sys.argv[1]))')
            source = "\n".join(line for line in source.splitlines()
                               if not line.startswith("assert overlay.data[")) + "\n"
        if italy and name == "verify_interactions":
            source = source.replace("src/assets/following/interactions.bin",
                                    "src/assets/following/white2italy/interactions.bin")
            source = source.replace(
                '"rom:/following/contextual-items.narc":gift_archive()}',
                '"rom:/following/contextual-items.narc":gift_archive(),'
                '"rom:/following/language.bin":(HERE.parents[1]/'
                "'src/assets/following/white2italy/language.bin').read_bytes()}")
            source += ITALIAN_BAG_TEST
        (build / f"{name}_{tag}.py").write_text(source)
    environment = {**os.environ, "FOLLOWING_BUILD_DIR": str(build),
                   "FOLLOWING_MODULE_SUFFIX": suffix,
                   "FOLLOWING_TEST_CYCLES": os.environ.get("FOLLOWING_TEST_CYCLES", "100"),
                   "PYTHONPATH": os.pathsep.join((str(build), str(HERE)))}
    output = []
    for name in (only or RUN_CASES):
        result = subprocess.run([sys.executable, str(build / f"{name}_{tag}.py"),
                                 str(rom.resolve())], cwd=HERE.parents[1],
                                env=environment, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT)
        output.append(result.stdout)
        if result.returncode:
            (build / "runtime-test.log").write_text("".join(output))
            raise RuntimeError(f"{label} {name} failed:\n{result.stdout}")
        print(result.stdout, end="")
    (build / "runtime-test.log").write_text("".join(output))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("profile", choices=("black2", "white2italy"))
    parser.add_argument("rom", type=Path)
    parser.add_argument("--only", action="append", choices=RUN_CASES, default=[])
    args = parser.parse_args()
    verify(args.profile, args.rom, tuple(args.only))

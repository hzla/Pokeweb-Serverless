"""Run the packaged W2I interaction and scene harnesses against Italian native code."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from italy_port import HERE, port_source

LOCALE_TEST = r'''
# Exercise the Italian data-driven Bag-full message and claim rollback.
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


def verify(rom: Path):
    build = Path(os.environ.get("FOLLOWING_BUILD_DIR", HERE / "build/white2italy")).resolve()
    build.mkdir(parents=True, exist_ok=True)
    for name in ("verify_interactions", "verify_conversation_return", "verify_surf", "verify_scenes", "verify_land_input", "verify_land_draw", "verify_transition"):
        text = port_source((HERE / (name + ".py")).read_text())
        text = text.replace("FieldW2.dll", "FieldW2I.dll").replace("FieldW2.elf", "FieldW2I.elf")
        text = text.replace("FollowingEventsW2.dll", "FollowingEventsW2I.dll").replace("FollowingEventsW2.elf", "FollowingEventsW2I.elf")
        text = text.replace("verify_interactions as h", "verify_interactions_italy as h")
        text = text.replace("verify_conversation_return as r", "verify_conversation_return_italy as r")
        text = text.replace("'contract.json'", "'italy-contract.json'")
        if name == "verify_surf":
            text = "import sys\n" + text.replace('str(ASSETS.parents[3] / "cleanwhite2.nds")', 'str(Path(sys.argv[1]))')
            text = "\n".join(line for line in text.splitlines() if not line.startswith("assert overlay.data[")) + "\n"
        if name == "verify_interactions":
            text = text.replace("src/assets/following/interactions.bin", "src/assets/following/white2italy/interactions.bin")
            text = text.replace('"rom:/following/contextual-items.narc":gift_archive()}',
                '"rom:/following/contextual-items.narc":gift_archive(),"rom:/following/language.bin":(HERE.parents[1]/\'src/assets/following/white2italy/language.bin\').read_bytes()}')
            text += LOCALE_TEST
        (build / (name + "_italy.py")).write_text(text)
    environment = {**os.environ, "FOLLOWING_BUILD_DIR": str(build), "FOLLOWING_MODULE_SUFFIX": "W2I",
                   "FOLLOWING_TEST_CYCLES": os.environ.get("FOLLOWING_TEST_CYCLES", "100"),
                   "PYTHONPATH": os.pathsep.join((str(build), str(HERE)))}
    output = []
    for name in ("verify_surf", "verify_scenes", "verify_land_input", "verify_land_draw", "verify_transition"):
        result = subprocess.run([sys.executable, str(build / (name + "_italy.py")), str(rom.resolve())],
                                cwd=HERE.parents[1], env=environment, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        output.append(result.stdout)
        if result.returncode:
            (build / "runtime-test.log").write_text("".join(output))
            raise RuntimeError(f"Italian {name} failed:\n{result.stdout}")
        print(result.stdout, end="")
    (build / "runtime-test.log").write_text("".join(output))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Expected clean Italian White 2 ROM")
    verify(Path(sys.argv[1]))

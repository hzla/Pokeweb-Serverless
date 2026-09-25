"""Run the packaged IREO scene, land-input, and Surf-transition regressions."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from black2_port import HERE, port_source


def verify(rom: Path):
    build = Path(os.environ.get("FOLLOWING_BUILD_DIR", HERE / "build/black2")).resolve()
    build.mkdir(parents=True, exist_ok=True)
    names = ("verify_interactions", "verify_conversation_return", "verify_surf", "verify_scenes", "verify_land_input", "verify_land_draw", "verify_transition")
    for name in names:
        source = port_source((HERE / (name + ".py")).read_text())
        source = source.replace("FieldW2.dll", "FieldB2.dll").replace("FieldW2.elf", "FieldB2.elf")
        source = source.replace("FollowingEventsW2.dll", "FollowingEventsB2.dll").replace("FollowingEventsW2.elf", "FollowingEventsB2.elf")
        source = source.replace("verify_interactions as h", "verify_interactions_black2 as h")
        source = source.replace("verify_conversation_return as r", "verify_conversation_return_black2 as r")
        source = source.replace("'contract.json'", "'black2-contract.json'")
        if name == "verify_surf":
            source = "import sys\n" + source.replace('str(ASSETS.parents[3] / "cleanwhite2.nds")', 'str(Path(sys.argv[1]))')
            source = "\n".join(line for line in source.splitlines() if not line.startswith("assert overlay.data[")) + "\n"
        (build / (name + "_black2.py")).write_text(source)
    environment = {**os.environ, "FOLLOWING_BUILD_DIR": str(build), "FOLLOWING_MODULE_SUFFIX": "B2",
                   "FOLLOWING_TEST_CYCLES": os.environ.get("FOLLOWING_TEST_CYCLES", "100"),
                   "PYTHONPATH": os.pathsep.join((str(build), str(HERE)))}
    output = []
    for name in ("verify_surf", "verify_scenes", "verify_land_input", "verify_land_draw", "verify_transition"):
        result = subprocess.run([sys.executable, str(build / (name + "_black2.py")), str(rom.resolve())],
                                cwd=HERE.parents[1], env=environment, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        output.append(result.stdout)
        if result.returncode:
            (build / "runtime-test.log").write_text("".join(output))
            raise RuntimeError(f"Black 2 {name} failed:\n{result.stdout}")
        print(result.stdout, end="")
    (build / "runtime-test.log").write_text("".join(output))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Expected clean Black 2 ROM")
    verify(Path(sys.argv[1]))

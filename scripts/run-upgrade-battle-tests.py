"""Compatibility CLI only; all move/ability scenarios and assertions live in W2U."""
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
upgrade = Path(os.environ.get("W2U_TEST_ROOT", ROOT.parents[1] / "White2Upgrade-Original-pokeweb"))
entrypoint = upgrade / "tools/test_battle.py"
if not entrypoint.is_file():
    raise SystemExit("Battle tests now live in White2Upgrade-Original-pokeweb; set W2U_TEST_ROOT")
environment = {**os.environ, "POKEWEB_ROOT": str(ROOT)}
raise SystemExit(subprocess.run([sys.executable, str(entrypoint), *sys.argv[1:]], env=environment).returncode)

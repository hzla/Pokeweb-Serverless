"""Build BW1 candidates from the canonical party-menu runtime checkout."""
import os
from pathlib import Path
import subprocess
HERE=Path(__file__).resolve().parent
SOURCE=Path(os.environ.get('W2U_RUNTIME_ROOT',HERE.parents[3]/'White2Upgrade-Original-pokeweb'))
subprocess.run(['python3',str(SOURCE/'tools/build_bw1_menu_evolution.py')],cwd=SOURCE,check=True)

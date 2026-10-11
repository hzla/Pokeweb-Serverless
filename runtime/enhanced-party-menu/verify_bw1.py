"""Run isolated compiled BW1 verification; gameplay acceptance is separate."""
import os
from pathlib import Path
import subprocess
HERE=Path(__file__).resolve().parent
SOURCE=Path(os.environ.get('W2U_RUNTIME_ROOT',HERE.parents[3]/'White2Upgrade-Original-pokeweb'))
subprocess.run(['python3',str(SOURCE/'tools/verify_bw1_party_menu.py')],cwd=SOURCE,check=True)

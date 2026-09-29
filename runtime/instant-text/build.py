"""Build only the independent Instant Fast Text DLL."""
from pathlib import Path
import subprocess
import sys

subprocess.run([sys.executable, str(Path(__file__).resolve().parent.parent / 'debug-helpers/build.py'), '--only', 'instant-fast-text'], check=True)

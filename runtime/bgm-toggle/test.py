"""Compile and run host-only buffer tests; never launches a DS emulator."""
import os
from pathlib import Path
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix="pokeweb-stream-buffer-") as directory:
    for test in ("test_stream_buffer", "test_mapping"):
        output = Path(directory) / test
        subprocess.run([
            os.environ.get("CC", "cc"), "-std=c11", "-Wall", "-Wextra", "-Werror",
            "-fsanitize=address,undefined", str(HERE / f"{test}.c"), "-o", str(output),
        ], check=True)
        subprocess.run([str(output)], check=True)

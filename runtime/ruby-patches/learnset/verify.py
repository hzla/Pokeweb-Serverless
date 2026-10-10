"""Run the established Learnset checks against Ruby-generated native artifacts."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from build import BUILD, GENERATED, HERE, ORIGINAL, REPO, input_hashes


def main():
    result = BUILD / "verification.json"
    extended_only = "--extended-only" in sys.argv
    prior = json.loads(result.read_text()) if extended_only else None
    result.unlink(missing_ok=True)
    receipt = json.loads((BUILD / "build-report.json").read_text())
    assert receipt["inputs"] == input_hashes(), "Ruby inputs changed: rebuild required"
    for name, output in receipt["outputs"].items():
        assert hashlib.sha256((BUILD / "candidates" / name).read_bytes()).hexdigest() == output["sha256"], name
    for name, digest in receipt["native"].items():
        assert hashlib.sha256((BUILD / "native" / name).read_bytes()).hexdigest() == digest, name
    if prior:
        assert prior["passed"] and prior["inputs"] == receipt["inputs"] and prior["outputs"] == receipt["outputs"], "Base verification is stale"
    checks = prior["checks"] if prior else []
    for stem in (() if extended_only else ("logic", "info")):
        # Exercise the same boundary/cycle/malformed-data tests using the Ruby
        # generated algorithms, rather than the original implementation headers.
        source = (ORIGINAL / f"test_{stem}.cpp").read_text()
        for header in ("logic", "info_logic"):
            source = source.replace(f'"{header}.h"', f'"{header}.generated.h"')
        test = BUILD / f"test_{stem}.cpp"
        test.write_text(source)
        binary = BUILD / f"test_{stem}"
        subprocess.run([os.environ.get("CXX", "clang++"), "-std=c++17", "-Wall", "-Wextra", "-Werror",
                        "-I", str(GENERATED), str(test), "-o", str(binary)], check=True)
        subprocess.run([str(binary)], check=True)
        checks.append(f"host_{stem}")
        print(f"Ruby-generated {stem}: host tests passed", flush=True)
    env = dict(os.environ, LEARNSET_BUILD_DIR=str(BUILD / "native"))
    for name in (() if extended_only else ("verify_runtime.py", "verify_graphics.py", "verify_info.py")):
        subprocess.run([sys.executable, str(ORIGINAL / name)], check=True, env=env)
        checks.append(name)
    for mode in ("--navigation-only", "--cache-only", "--custom-ui-only"):
        subprocess.run([sys.executable, str(ORIGINAL / "verify_info.py"), mode], check=True, env=env)
        checks.append(f"verify_info.py {mode}")
    if not extended_only:
        subprocess.run(["npx", "vite-node", str(HERE / "verify_install.ts")], check=True, cwd=REPO)
        checks.append("DLL import/configuration")
    # Bind successful verification to these exact compiler/source/module inputs.
    assert receipt["inputs"] == input_hashes(), "Inputs changed while verifying"
    result.write_text(json.dumps({"inputs": receipt["inputs"], "outputs": receipt["outputs"],
                                 "checks": checks, "passed": True, "liveGameTest": False}, indent=2) + "\n")


if __name__ == "__main__":
    main()

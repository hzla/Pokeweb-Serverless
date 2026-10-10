"""Build experimental Ruby PMC candidates and native references, without publishing."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
WORKSPACE = REPO.parent
NATIVE = HERE.parent / "form-evolution"
TOOLS = Path(os.environ.get("ARM_TOOLCHAIN_BIN", WORKSPACE / "toolchains/arm-gnu-toolchain-14.2.rel1-darwin-arm64-arm-none-eabi/bin"))
JAR = Path(os.environ.get("RPM_TOOL_JAR", WORKSPACE / "White2Upgrade/CTRMap.jar"))
W2_ESDB = Path(os.environ.get("BW2_W2_ESDB", WORKSPACE / "White2Upgrade/pmc/ESDB.yml"))
BUILD = HERE / "build"
PROFILE = json.loads((HERE / "form_evolution.json").read_text())
sys.path.insert(0, str(HERE.parent / "battle-type-hud"))
from rpm_read import read_rpm

# Independently recorded in the existing installer tests; addresses include the
# Thumb bit here, whereas RPM symbols store the aligned function address.
IMPORTS = {
    "B2": {"PML_PersonalGetParamSingle": 0x0201ef1d,
           "setChangedPkmSpecies": 0x0201c7b5, "PokeParty_ChangeForme": 0x0201c865},
    "W2": {"PML_PersonalGetParamSingle": 0x0201ef49,
           "setChangedPkmSpecies": 0x0201c7e1, "PokeParty_ChangeForme": 0x0201c891},
}


def run(*args):
    result = subprocess.run([str(arg) for arg in args], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(result.stdout or f"command failed with exit {result.returncode}")
    return result.stdout


def audit(path, game):
    rpm = read_rpm(path.read_bytes())
    expected_hooks = {("284", int(site, 0), "THUMB_BRANCH_LINK") for site in PROFILE["games"][game]["hooks"]}
    actual_hooks = {(item["module"], item["address"], item["type"]) for item in rpm["relocations"] if item["module"] != "base"}
    if actual_hooks != expected_hooks:
        raise RuntimeError(f"{game}: hook targets differ from the native patch")
    if any(symbol["attributes"] & 2 for symbol in rpm["symbols"]):
        raise RuntimeError(f"{game}: unresolved native imports")
    actual_imports = {symbol["name"]: symbol["address"] | 1 for symbol in rpm["symbols"] if symbol["attributes"] & 4}
    if actual_imports != IMPORTS[game]:
        raise RuntimeError(f"{game}: native imports differ from the existing bindings")
    expected_meta = {"PMCGameID": game, "PMCModulePriority": PROFILE["priority"], "PMCVersion": PROFILE["version"]}
    if rpm["metadata"] != expected_meta or rpm["bss"] != 0:
        raise RuntimeError(f"{game}: unexpected metadata or persistent state")
    return {"file": path.relative_to(REPO).as_posix(), "bytes": path.stat().st_size,
            "codeBytes": len(rpm["code"]), "bssBytes": rpm["bss"],
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "hooks": sorted(f"{module}:{address:08x}:{kind}" for module, address, kind in actual_hooks)}


def build_one(game, kind):
    output_dir = BUILD / kind
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = PROFILE["module"] + game
    if kind == "ruby":
        source = output_dir / f"{stem}.c"
        run(os.environ.get("RUBY", "ruby"), HERE / "compiler.rb", "--source", HERE / "form_evolution.rb",
            "--profile", HERE / "form_evolution.json", "--game", game, "--output", source)
        compiler, extra = "gcc", ["-std=c11"]
    else:
        source = NATIVE / "form_evolution.cpp"
        compiler, extra = "g++", ["-fno-exceptions", "-fno-rtti", f"-DPOKEWEB_GAME_{game}=1"]
    obj, elf = output_dir / f"{stem}.o", output_dir / f"{stem}.elf"
    run(TOOLS / f"arm-none-eabi-{compiler}", "-mthumb", "-mno-thumb-interwork", "-march=armv5t",
        "-mno-long-calls", "-Os", "-Wall", "-Wextra", "-Werror", "-fno-unwind-tables",
        "-fno-asynchronous-unwind-tables", "-ffreestanding", *extra, "-c", source, "-o", obj)
    run(TOOLS / "arm-none-eabi-ld", "-r", obj, "-o", elf)
    output = output_dir / f"{stem}.dll"
    esdb = NATIVE / "symbols_b2.yml" if game == "B2" else W2_ESDB
    run("java", "-cp", JAR, "rpm.cli.RPMTool", "-i", elf, "--fourcc", "DLXF", "-o", output,
        "--esdb", esdb, "--meta", NATIVE / f"metadata_{game.lower()}.yml", "--generate-relocations")
    (output_dir / f"{stem}.dump.txt").write_text(run("java", "-cp", JAR, "rpm.cli.RPMDump", "--fourcc", "DLXF", "-i", output))
    result = audit(output, game)
    print(f"{game} {kind}: {result['codeBytes']} bytes native code, {result['bssBytes']} bytes BSS; {result['file']}")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--game", choices=["B2", "W2", "both"], default="both")
    args = parser.parse_args()
    BUILD.mkdir(parents=True, exist_ok=True)
    for filename in ("build-report.json", "verification.json", "import-verification.json"):
        (BUILD / filename).unlink(missing_ok=True)
    results = {}
    for game in ([args.game] if args.game != "both" else ["B2", "W2"]):
        results[game] = {kind: build_one(game, kind) for kind in ("ruby", "reference")}
        results[game]["shipped"] = audit(REPO / "src/assets/codeinjection" / f"FormEvolution{game}.dll", game)
    inputs = [HERE / name for name in ("form_evolution.rb", "form_evolution.json", "compiler.rb", "build.py")]
    inputs += [NATIVE / name for name in ("form_evolution.cpp", "symbols_b2.yml", "metadata_b2.yml", "metadata_w2.yml")]
    inputs.append(W2_ESDB)
    input_hashes = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs}
    report = {"source": "form_evolution.rb", "inputSha256": input_hashes,
              "games": results, "published": False}
    (BUILD / "build-report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()

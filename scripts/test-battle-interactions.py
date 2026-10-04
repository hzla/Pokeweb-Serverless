"""Run real battle interaction regressions unattended in headless melonDS."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
# US White 2 rev 0 native battle ABI. These are observation points, not handler
# addresses: dynamic children can relocate anywhere without changing the test.
CALC_DAMAGE = 0x021A5958
BATTLE_RANDOM = 0x021BD100
ABILITY_ADD = 0x021BDCEC
COMMAND = 0x021CEF18
CALC_CRITICAL = 0x021A599C
CALC_PRE_MODIFIER = 0x021A5AE0
CALC_RATIO = 0x021A5B04
CALC_RESULT = 0x021A5B26
MUL_VALUE = 0x021BCF58
FLUFFY_CASES = [("contact", 33, 2048), ("noncontact", 129, 4096),
                ("fire", 53, 8192), ("fire-contact", 7, 4096)]


@contextmanager
def native_log(path):
    """Capture both Python and native C stdout/stderr, not just Python prints."""
    sys.stdout.flush()
    sys.stderr.flush()
    saved = [os.dup(fd) for fd in (1, 2)]
    try:
        with path.open("w") as stream:
            os.dup2(stream.fileno(), 1)
            os.dup2(stream.fileno(), 2)
            yield
    finally:
        sys.stdout.flush()
        sys.stderr.flush()
        # Native stdio may buffer logging until destruction; flush it before
        # restoring the terminal descriptors.
        import ctypes
        ctypes.CDLL(None).fflush(None)
        for fd, original in zip((1, 2), saved):
            os.dup2(original, fd)
            os.close(original)


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def digest(path):
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def validate_fixture_save(path):
    save = path.read_bytes()
    check(len(save) == 0x80000, "Interaction fixture must be a raw 512 KiB BW2 save")
    for half in (0, 0x26000):
        check(save[half + 0x19400] & 0x80,
              "Fixture has Battle Scene On; regenerate without --fixtures to disable battle animations")


def create_output_directory(path):
    path.mkdir(parents=True, exist_ok=False)
    # A scoped ignore file protects custom --out locations as well as work/.
    # It ignores itself too, so no generated output needs a Git add exception.
    (path / ".gitignore").write_text("*\n")


def cleanup_fixture_rom(directory):
    """Remove only this run's exported ROM, retaining its save and metadata."""
    check(not directory.is_symlink(), "Refusing fixture cleanup through a directory symlink")
    path = directory / "battle.nds"
    try:
        path.unlink()
    except FileNotFoundError:
        return []
    return [path.name]


def configure_melon(args, preflight=True):
    python = args.melon_python or os.environ.get("MELONDS_PYTHON_PATH")
    if not python:
        candidate = ROOT.parent / "work/scan-button/emulator-ref/python"
        if candidate.is_dir():
            python = str(candidate)
    if python:
        sys.path.insert(0, str(Path(python).resolve()))
    try:
        from melonds import MelonDS
    except ImportError as error:
        raise RuntimeError("Install the melonDS headless Python API or supply --melon-python / MELONDS_PYTHON_PATH") from error
    library = args.melon_lib or os.environ.get("MELONDS_HEADLESS_LIB")
    if not library:
        for name in ("libmelonds_headless.dylib", "libmelonds_headless.so", "melonds_headless.dll"):
            candidate = ROOT.parent / "work/scan-button/emulator-build/src/headless" / name
            if candidate.is_file():
                library = str(candidate)
                break
    # Check the C API before building large fixture ROMs.
    if preflight:
        emulator = MelonDS(library)
        emulator.destroy()
    return MelonDS, library


def clone(source, destination):
    if sys.platform == "darwin" and subprocess.run(["cp", "-c", str(source), str(destination)], stderr=subprocess.DEVNULL).returncode == 0:
        return
    shutil.copyfile(source, destination)


def read_mon(emu, address):
    memory = emu.memory
    check(0x02000000 <= address <= 0x023FFE00, "Invalid native BattleMon pointer")
    return {
        "species": memory.read_short(address + 12),
        "maxHp": memory.read_short(address + 14),
        "hp": memory.read_short(address + 16),
        "item": memory.read_short(address + 18),
        "ability": memory.read_short(address + 22),
        "level": memory.read_byte(address + 24),
        "slot": memory.read_byte(address + 25),
        "stats": [memory.read_short(address + at) for at in (0xEE, 0xF0, 0xF2, 0xF4, 0xF6)],
        "types": [memory.read_byte(address + 0xF8), memory.read_byte(address + 0xF9)],
    }


def patch_variant_rom(path, patches):
    """Change only validated trainer slot bytes in a parent-owned ROM copy."""
    with path.open("r+b") as stream:
        size = path.stat().st_size
        seen = set()
        for patch in patches:
            offset, expected, value = patch["offset"], patch["expected"], patch["value"]
            check(isinstance(offset, int) and 0 <= offset < size and offset not in seen, "Invalid or duplicate fixture patch offset")
            check(all(isinstance(n, int) and 0 <= n <= 255 for n in (expected, value)), "Invalid fixture patch byte")
            check((expected & 15) == (value & 15), "Variant patch must preserve trainer gender bits")
            stream.seek(offset)
            check(stream.read(1) == bytes([expected]), "Temporary ROM does not match expected trainer slot byte")
            stream.seek(offset)
            stream.write(bytes([value]))
            seen.add(offset)


class BattleObserver:
    """Hooks persist across restore; every piece of host trial state is reset."""
    def __init__(self, emu, variant):
        self.emu, self.variant = emu, variant
        self.phase = "boot"
        self.command_frame = None
        self.pointers, self.registered = {}, {}
        self.return_hooks, self.hooks = {}, []
        self.reset_trial(None)

    def reset_trial(self, case):
        self.case = case
        self.pending = None
        self.errors = []
        self.rng_calls, self.rng_pending = [], {}
        self.injected_faults = 0
        self.phase = "trial" if case else "boot"

    def checked(self, callback):
        def invoke(*values):
            if self.errors:
                return
            try:
                callback(*values)
            except Exception as error:
                self.errors.append(error)
        return invoke

    def raise_errors(self):
        if self.errors:
            raise self.errors[0]

    def install(self):
        for address, callback in (
            (COMMAND, self.command), (ABILITY_ADD, self.ability),
            (CALC_DAMAGE, self.calc), (CALC_CRITICAL, self.critical),
            (CALC_PRE_MODIFIER, self.pre_modifier), (CALC_RATIO, self.ratio),
            (CALC_RESULT, self.calculated), (MUL_VALUE, self.inject_fault),
            (BATTLE_RANDOM, self.random),
        ):
            self.hooks.append(self.emu.memory.register_exec(address, self.checked(callback)))

    def command(self, cpu, address):
        if self.phase == "boot" and self.emu.memory.read_long(self.emu.memory.register_arm9.r1) == 0:
            self.command_frame = self.emu.frame_count

    def ability(self, cpu, address):
        if self.phase != "boot":
            return
        pointer = self.emu.memory.register_arm9.r0
        mon = read_mon(self.emu, pointer)
        if mon["species"] == 151 and mon["slot"] < 6:
            check(mon["ability"] == 28, "Player attacker did not register Synchronize")
            self.pointers["attacker"], self.registered["attacker"] = pointer, mon
        elif mon["species"] == 143 and mon["slot"] >= 6:
            check(mon["ability"] == self.variant["abilityId"], "Trainer Personal slot did not register the requested ability")
            self.pointers["defender"], self.registered["defender"] = pointer, mon

    def random(self, cpu, address):
        if self.phase != "trial":
            return
        registers = self.emu.memory.register_arm9
        bound, ret = registers.r0, registers.lr & ~1
        check(0 < bound <= 0x100000, "Invalid BattleRandom bound")
        self.rng_pending.setdefault(ret, []).append(bound)
        if ret not in self.return_hooks:
            def returned(cpu, address):
                stack = self.rng_pending.get(address, [])
                if self.phase == "trial" and stack:
                    bound = stack.pop()
                    native = self.emu.memory.register_arm9.r0
                    check(native < bound, "Native RNG result exceeds its bound")
                    self.emu.memory.register_arm9.r0 = bound - 1
                    self.rng_calls.append({"bound": bound, "native": native, "controlled": bound - 1})
            self.return_hooks[ret] = self.emu.memory.register_exec(ret, self.checked(returned))

    def calc(self, cpu, address):
        if self.phase != "trial":
            return
        registers = self.emu.memory.register_arm9
        attacker, defender = read_mon(self.emu, registers.r1), read_mon(self.emu, registers.r2)
        if attacker["species"] != 151 or defender["species"] != 143:
            return
        check(attacker["slot"] < 6 and defender["slot"] >= 6, "Damage must come from the player against the AI")
        memory = self.emu.memory
        move = memory.read_short(registers.r3)
        check(move == self.case["moveId"], f"Player selected unexpected move {move}; expected {self.case['moveId']}")
        check(defender["ability"] == self.variant["abilityId"], "Wrong enemy ability during damage calculation")
        check(attacker["item"] == defender["item"] == 0, "Fixture unexpectedly holds an item")
        check(attacker["level"] == defender["level"] == 50, "Fixture level mismatch")
        check(registers.r1 == self.pointers["attacker"] and registers.r2 == self.pointers["defender"], "Snapshot battler pointers changed")
        self.pending = {"moveId": move, "moveType": memory.read_byte(registers.r3 + 6),
                        "category": memory.read_long(registers.r3 + 8),
                        "attacker": attacker, "defender": defender,
                        "calculationFrame": self.emu.frame_count}

    def critical(self, cpu, address):
        if self.pending:
            self.pending["critical"] = self.emu.memory.register_arm9.r6
            check(self.pending["critical"] == 0, "Unexpected critical hit; controlled RNG did not apply")

    def pre_modifier(self, cpu, address):
        if self.pending:
            self.pending["preModifierDamage"] = self.emu.memory.register_arm9.r4

    def ratio(self, cpu, address):
        if self.pending:
            self.pending["damageRatio"] = self.emu.memory.register_arm9.r0

    def calculated(self, cpu, address):
        if self.pending:
            self.pending["calculatedDamage"] = self.emu.memory.register_arm9.r0

    def inject_fault(self, cpu, address):
        registers = self.emu.memory.register_arm9
        if self.case and self.case.get("neutralize") and self.pending and registers.r0 == 0x35 and registers.r1 == 2048:
            check(self.variant["abilityId"] == 218, "Fault injection is only valid for Fluffy")
            registers.r1 = 4096
            self.injected_faults += 1

    def close(self):
        self.phase = "closed"
        for hook in [*self.return_hooks.values(), *self.hooks]:
            hook.remove()
        self.return_hooks.clear()
        self.hooks.clear()
        self.reset_trial(None)
        self.phase = "closed"


def restore_checkpoint(emu, observer, snapshot, frame, baseline, case):
    emu.restore_snapshot(snapshot)
    # The headless wrapper's input latch and Python callbacks live outside the
    # emulator savestate. Reset these separately, including pending RNG returns.
    emu.input.keypad_update(0)
    emu.input.touch_release()
    observer.reset_trial(case)
    check(emu.frame_count == frame, "Snapshot did not restore the emulated frame counter")
    for side, raw in baseline.items():
        pointer = observer.pointers[side]
        check(bytes(emu.memory.unsigned[pointer:pointer + len(raw)]) == raw,
              f"Snapshot did not restore {side} BattleMon state")


def execute_case(emu, observer, case, variant, maximum, artifacts, checkpoint_frame):
    result = {"case": case["id"], "variant": variant["name"], "expectedAbility": variant["abilityId"],
              "snapshotRestored": True, "checkpointFrame": checkpoint_frame,
              "rngPolicy": "native RNG executes; battle draws use upper bound minus one (no critical hits, 85% damage roll)"}
    try:
        for step in range(maximum):
            # A single native Fight input, then the requested move's touch cell.
            # Do not repeatedly press A: that would auto-select the first move.
            emu.input.keypad_update(1 if 24 <= step < 27 else 0)
            if step >= 60 and step % 12 < 3:
                slot = case["moveSlot"]
                emu.input.touch_set_pos(64 if slot % 2 == 0 else 192, 50 if slot < 2 else 110)
            else:
                emu.input.touch_release()
            emu.cycle()
            observer.raise_errors()
            pending = observer.pending
            if pending and "calculatedDamage" in pending:
                hp = emu.memory.read_short(observer.pointers["defender"] + 16)
                if hp < pending["defender"]["hp"]:
                    pending.update(hpAfter=hp, hpLoss=pending["defender"]["hp"] - hp, appliedFrame=emu.frame_count)
                    check(pending["hpLoss"] == pending["calculatedDamage"], "Applied HP loss differs from native damage")
                    check(hp > 0, "Damage capped by fainting")
                    result.update(pending)
                    result["verified"] = True
                    break
        check(result.get("verified"), f"No complete damage observation within {maximum} frames")
    except Exception as error:
        result.update(verified=False, error=str(error))
        if observer.pending:
            result["pending"] = observer.pending
        raise
    finally:
        result.update(finalFrame=emu.frame_count, rngDraws=observer.rng_calls, injectedFaults=observer.injected_faults)
        name = f"{case['id']}-{variant['name']}"
        (artifacts / f"{name}.json").write_text(json.dumps(result, indent=2) + "\n")
        emu.screenshot().save(artifacts / f"{name}.png")
    return result


def run_batch(MelonDS, library, directory, manifest, variant, maximum, artifacts, workspace,
              verify_detector=False, reverse=False):
    batch = {"variant": variant["name"], "verified": False, "coldBoots": 0, "snapshotRestores": 0, "trials": {}}
    snapshot = None
    emu = observer = None
    try:
        rom = Path(workspace) / "battle.nds"
        clone(directory / manifest["rom"]["file"], rom)
        patch_variant_rom(rom, variant["romPatches"])
        shutil.copyfile(directory / manifest["save"]["file"], rom.with_suffix(".sav"))
        emu = MelonDS(library)
        observer = BattleObserver(emu, variant)
        observer.install()
        emu.open(rom)
        batch["coldBoots"] = 1
        for _ in range(maximum):
            emu.cycle()
            observer.raise_errors()
            if observer.command_frame is not None:
                break
        check(observer.command_frame is not None, f"No command menu within {maximum} boot frames")
        check(set(observer.registered) == {"attacker", "defender"}, "Did not observe both native ability registrations")
        emu.input.keypad_update(0)
        emu.input.touch_release()
        frame = emu.frame_count
        baseline = {side: bytes(emu.memory.unsigned[pointer:pointer + 0x200]) for side, pointer in observer.pointers.items()}
        snapshot = emu.save_snapshot()
        batch.update(checkpointFrame=frame, snapshotBytes=len(snapshot),
                     snapshotSha256=hashlib.sha256(snapshot).hexdigest(), registered=observer.registered)
        cases = list(reversed(manifest["cases"])) if reverse else list(manifest["cases"])
        if verify_detector and variant["name"] == "fluffy":
            cases.append({**manifest["cases"][0], "id": "disabled-contact", "neutralize": True})
        batch["runOrder"] = [case["id"] for case in cases]
        for case in cases:
            restore_checkpoint(emu, observer, snapshot, frame, baseline, case)
            batch["snapshotRestores"] += 1
            batch["trials"][case["id"]] = execute_case(emu, observer, case, variant, maximum, artifacts, frame)
        batch["verified"] = True
    except Exception as error:
        batch["error"] = str(error)
        if emu:
            emu.screenshot().save(artifacts / f"{variant['name']}-failure.png")
        raise
    finally:
        # Snapshots are never written to disk. Drop the only reference on every
        # success/failure path; parent-owned scratch is also removed after kill.
        snapshot = None
        batch["snapshotReleased"] = True
        try:
            if observer:
                observer.close()
        finally:
            if emu:
                emu.destroy()
            (artifacts / f"{variant['name']}-batch.json").write_text(json.dumps(batch, indent=2) + "\n")
    return batch


def compare(case, control, fluffy):
    for trial in (control, fluffy):
        check(trial.get("verified"), "Trial did not observe a complete native hit")
        check(trial["calculatedDamage"] == trial["hpLoss"], "Calculated damage does not equal applied HP loss")
        check(trial["moveId"] == case["moveId"], "Wrong move observed")
    check(control["defender"]["ability"] == 50 and fluffy["defender"]["ability"] == 218, "Paired abilities must be Run Away and Fluffy")
    for key in ("moveId", "moveType", "category", "preModifierDamage", "critical"):
        check(control[key] == fluffy[key], f"{case['id']}: mismatched {key}")
    for side in ("attacker", "defender"):
        left, right = dict(control[side]), dict(fluffy[side])
        if side == "defender":
            left.pop("ability")
            right.pop("ability")
        check(left == right, f"{case['id']}: paired {side} differs in more than ability")
    check(control["calculatedDamage"] > 3, "Control damage is too small for a useful ratio test")
    check(control["damageRatio"] == 4096, "Control unexpectedly has a final damage modifier")
    check(fluffy["damageRatio"] == case["ratio"], f"{case['name']}: incorrect Fluffy handler ratio {fluffy['damageRatio']}/4096")
    # Retail fixed-point damage rounds exact halves down, after all earlier
    # integer damage steps. Compare the measured HP loss, not a float ratio.
    expected = (control["hpLoss"] * case["ratio"] + 2047) // 4096
    check(fluffy["hpLoss"] == expected,
          f"{case['name']}: control={control['hpLoss']} HP; Fluffy={fluffy['hpLoss']} HP; expected={expected} HP ({case['ratio']}/4096)")
    return {"case": case["id"], "move": case["name"], "controlDamage": control["hpLoss"], "fluffyDamage": fluffy["hpLoss"], "expectedDamage": expected, "multiplier": case["ratio"] / 4096, "passed": True}


def isolated_batch(args, output, directory, manifest, variant):
    """A batch process deadline catches native hangs; its parent owns scratch."""
    artifacts = output / "trials"
    name = variant["name"]
    specification = artifacts / f"{name}-batch.input.json"
    command = [sys.executable, str(Path(__file__).resolve()), "--worker-spec", str(specification)]
    for option, value in (("--melon-python", args.melon_python), ("--melon-lib", args.melon_lib)):
        if value:
            command += [option, str(value.resolve())]
    with tempfile.TemporaryDirectory(prefix="pokeweb-battle-interaction-") as workspace:
        specification.write_text(json.dumps({"directory": str(directory), "manifest": manifest,
                                            "variant": variant, "maximum": args.max_frames,
                                            "artifacts": str(artifacts), "workspace": workspace,
                                            "verifyDetector": args.verify_detector,
                                            "reverse": args.reverse_cases}, indent=2) + "\n")
        try:
            completed = subprocess.run(command, timeout=args.trial_timeout, check=False)
        except subprocess.TimeoutExpired as error:
            raise RuntimeError(f"{name}: headless batch exceeded {args.trial_timeout:g}s; see {artifacts / (name + '-batch.log')}") from error
    path = artifacts / f"{name}-batch.json"
    check(path.is_file(), f"{name}: worker exited {completed.returncode} without a result; inspect its log")
    result = json.loads(path.read_text())
    check(completed.returncode == 0 and result.get("verified"), f"{name}: {result.get('error', 'headless worker failed')}")
    check(result.get("snapshotReleased"), "Batch retained its snapshot")
    return result


def worker(args):
    spec = json.loads(args.worker_spec.read_text())
    artifacts = Path(spec["artifacts"])
    with native_log(artifacts / f"{spec['variant']['name']}-batch.log"):
        try:
            MelonDS, library = configure_melon(args, preflight=False)
            run_batch(MelonDS, library, Path(spec["directory"]), spec["manifest"], spec["variant"],
                      spec["maximum"], artifacts, spec["workspace"], spec["verifyDetector"], spec["reverse"])
            return 0
        except Exception as error:
            print(f"Worker failed: {error}", file=sys.stderr)
            return 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", choices=["fluffy"], default="fluffy")
    parser.add_argument("--rom", type=Path, default=ROOT.parent.parent / "White2Upgrade.nds")
    parser.add_argument("--save", type=Path, default=ROOT / "src/assets/testbattle/test.sav")
    parser.add_argument("--fixtures", type=Path, help="Reuse fixtures previously produced by this runner")
    parser.add_argument("--keep-fixtures", action="store_true", help="Keep the newly exported fixture ROM for later --fixtures reuse; saves and supplied fixtures are always preserved")
    parser.add_argument("--out", type=Path, help="New output directory (default: timestamped directory under work/battle-interactions)")
    parser.add_argument("--melon-python", type=Path)
    parser.add_argument("--melon-lib", type=Path)
    parser.add_argument("--max-frames", type=int, default=2400, help="Frame limit for boot and each restored move case")
    parser.add_argument("--trial-timeout", type=float, default=90, help="Hard wall-clock deadline per ability-variant batch process, seconds")
    parser.add_argument("--verify-detector", action="store_true", help="Also require the suite to reject an intentionally neutralized Fluffy contact handler")
    parser.add_argument("--reverse-cases", action="store_true", help="Run moves in reverse order to verify snapshot isolation")
    parser.add_argument("--worker-spec", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.worker_spec:
        return worker(args)
    check(args.max_frames > 0 and args.trial_timeout > 0, "Frame and process limits must be positive")
    output = (args.out or ROOT / "work/battle-interactions" / (time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6])).resolve()
    create_output_directory(output)
    report = {"format": "pokeweb-battle-interaction-result-2", "suite": args.suite, "passed": False, "cases": []}
    generated_fixtures = None
    report["fixtureCleanup"] = {"policy": "preserve-supplied" if args.fixtures else
                                "keep-generated" if args.keep_fixtures else "delete-generated-rom",
                                "removedFiles": []}
    started = time.monotonic()
    try:
        with native_log(output / "preflight.log"):
            configure_melon(args)
        if args.fixtures:
            directory = args.fixtures.resolve()
        else:
            directory = output / "fixtures"
            # Set ownership before starting the builder so partial failed exports
            # are cleaned too. Never derive deletion targets from a manifest.
            generated_fixtures = directory
            subprocess.run([str(ROOT / "node_modules/.bin/vite-node"), str(ROOT / "scripts/build-battle-interaction-fixtures.ts"), "--rom", str(args.rom.resolve()), "--save", str(args.save.resolve()), "--out", str(directory)], cwd=ROOT, check=True)
        manifest = json.loads((directory / "suite.json").read_text())
        check(manifest["format"] == "pokeweb-battle-interactions-2" and manifest["suite"] == args.suite,
              "Fixtures predate snapshot batching; regenerate without --fixtures")
        check(manifest.get("battleAnimationsEnabled") is False, "Fixtures require Battle Scene Off")
        check([(c["id"], c["moveId"], c["ratio"]) for c in manifest["cases"]] == FLUFFY_CASES, "Fixture cases differ from the Fluffy contract")
        check([c["moveSlot"] for c in manifest["cases"]] == [0, 1, 2, 3], "Fixture move slots must map the four player attacks")
        check([(v["name"], v["abilityId"], v["abilitySlot"]) for v in manifest["variants"]] == [("control", 50, 1), ("fluffy", 218, 2)], "Fixture trainer abilities differ from the suite contract")
        check(manifest["variants"][0]["romPatches"] == [] and len(manifest["variants"][1]["romPatches"]) == 1, "Variants must differ by just one trainer slot byte")
        for key in ("inputRomSha256", "inputSaveSha256", "harnessSha256", "harnessCpuChecks", "battleAnimationsEnabled"):
            report[key] = manifest[key]
        for key in ("rom", "save"):
            check(digest(directory / manifest[key]["file"]) == manifest[key]["sha256"], f"Prepared {key} hash mismatch")
        validate_fixture_save(directory / manifest["save"]["file"])
        artifacts = output / "trials"
        artifacts.mkdir()
        batches = {}
        for variant in manifest["variants"]:
            print(f"Running {variant['name']}: one cold boot, four snapshot-restored attacks...", flush=True)
            batches[variant["name"]] = isolated_batch(args, output, directory, manifest, variant)
        for case in manifest["cases"]:
            result = compare(case, batches["control"]["trials"][case["id"]], batches["fluffy"]["trials"][case["id"]])
            report["cases"].append(result)
            print(f"PASS {case['name']}: {result['controlDamage']} -> {result['fluffyDamage']} HP (x{result['multiplier']:g})", flush=True)
        if args.verify_detector:
            faulty = batches["fluffy"]["trials"]["disabled-contact"]
            check(faulty.get("injectedFaults") == 1, "Negative-control fault was not injected exactly once")
            try:
                compare(manifest["cases"][0], batches["control"]["trials"]["contact"], faulty)
            except AssertionError as error:
                report["detectorVerification"] = {"passed": True, "rejection": str(error), "disabledDamage": faulty["hpLoss"]}
                print("PASS detector check: neutralized Fluffy was rejected", flush=True)
            else:
                raise AssertionError("False positive: disabled Fluffy passed the suite")
        report.update(coldBoots=sum(b["coldBoots"] for b in batches.values()),
                      snapshotRestores=sum(b["snapshotRestores"] for b in batches.values()),
                      snapshotFilesWritten=0, snapshotReleased=all(b["snapshotReleased"] for b in batches.values()),
                      fixtureRomCount=1, fixtureSaveCount=1)
        check(report["coldBoots"] == 2 and len(report["cases"]) == 4, "Batch coverage is incomplete")
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
        print(f"FAIL: {error}", file=sys.stderr)
    finally:
        if generated_fixtures is not None and not args.keep_fixtures:
            try:
                report["fixtureCleanup"]["removedFiles"] = cleanup_fixture_rom(generated_fixtures)
                report["fixtureCleanup"]["completed"] = True
            except Exception as error:
                report["passed"] = False
                report["fixtureCleanup"].update(completed=False, error=str(error))
                print(f"FAIL fixture cleanup: {error}", file=sys.stderr)
        report["wallSeconds"] = round(time.monotonic() - started, 2)
        (output / "result.json").write_text(json.dumps(report, indent=2) + "\n")
        print(f"Report: {output / 'result.json'}", flush=True)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)

"""Fast checks for the unattended battle runner's damage oracle and deadline."""
import argparse
from contextlib import nullcontext, redirect_stderr, redirect_stdout
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location(
    "battle_interactions", Path(__file__).resolve().parents[2] / "scripts/test-battle-interactions.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def pair(ratio=2048, damage=42):
    case = {"id": "contact", "name": "Tackle", "moveId": 33, "ratio": ratio}
    mon = {"species": 143, "maxHp": 235, "hp": 235, "item": 0, "ability": 50,
           "level": 50, "slot": 0, "stats": [130, 85, 85, 130, 50], "types": [0, 0]}
    control = {"verified": True, "moveId": 33, "moveType": 0, "category": 1,
               "preModifierDamage": damage, "critical": 0, "damageRatio": 4096,
               "calculatedDamage": damage, "hpLoss": damage,
               "attacker": {**mon, "species": 151, "ability": 28}, "defender": mon}
    fluffy = deepcopy(control)
    fluffy["defender"]["ability"] = 218
    fluffy["damageRatio"] = ratio
    fluffy["calculatedDamage"] = fluffy["hpLoss"] = (damage * ratio + 2047) // 4096
    return case, control, fluffy


class InteractionOracleTests(unittest.TestCase):
    def test_custom_output_directory_ignores_every_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "custom-results"
            runner.create_output_directory(output)
            self.assertEqual((output / ".gitignore").read_text(), "*\n")
            with self.assertRaises(FileExistsError):
                runner.create_output_directory(output)

    def test_fixture_requires_battle_scene_off_in_both_halves(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.sav"
            save = bytearray(0x80000)
            offsets = [half + 0x19400 for half in (0, 0x26000)]
            for offset in offsets:
                save[offset] = 0x81
            path.write_bytes(save)
            runner.validate_fixture_save(path)
            for offset in offsets:
                enabled = bytearray(save)
                enabled[offset] &= ~0x80
                path.write_bytes(enabled)
                with self.subTest(offset=offset), self.assertRaisesRegex(AssertionError, "Battle Scene On"):
                    runner.validate_fixture_save(path)

    def test_fixture_rejects_wrong_save_size(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.sav"
            path.write_bytes(b"\x81")
            with self.assertRaisesRegex(AssertionError, "512 KiB"):
                runner.validate_fixture_save(path)

    def test_four_damage_multipliers(self):
        for ratio in (2048, 4096, 8192):
            with self.subTest(ratio=ratio):
                self.assertTrue(runner.compare(*pair(ratio))["passed"])

    def test_odd_damage_halves_round_down(self):
        self.assertEqual(runner.compare(*pair(damage=43))["fluffyDamage"], 21)

    def test_disabled_handler_is_rejected(self):
        case, control, fluffy = pair()
        fluffy.update(damageRatio=4096, calculatedDamage=42, hpLoss=42)
        with self.assertRaisesRegex(AssertionError, "incorrect Fluffy handler ratio"):
            runner.compare(case, control, fluffy)

    def test_correct_ratio_with_wrong_hp_loss_is_rejected(self):
        case, control, fluffy = pair()
        fluffy.update(calculatedDamage=42, hpLoss=42)
        with self.assertRaisesRegex(AssertionError, "expected=21"):
            runner.compare(case, control, fluffy)

    def test_matching_hp_loss_with_wrong_ratio_is_rejected(self):
        case, control, fluffy = pair()
        fluffy["damageRatio"] = 4096
        with self.assertRaisesRegex(AssertionError, "incorrect Fluffy handler ratio"):
            runner.compare(case, control, fluffy)

    def test_capped_or_unapplied_damage_is_rejected(self):
        case, control, fluffy = pair()
        fluffy["hpLoss"] = 10
        with self.assertRaisesRegex(AssertionError, "applied HP loss"):
            runner.compare(case, control, fluffy)

    def test_incomplete_hit_is_rejected(self):
        case, control, fluffy = pair()
        fluffy["verified"] = False
        with self.assertRaisesRegex(AssertionError, "complete native hit"):
            runner.compare(case, control, fluffy)

    def test_confounders_are_rejected(self):
        for key in ("moveType", "category", "preModifierDamage", "critical"):
            case, control, fluffy = pair()
            fluffy[key] += 1
            with self.subTest(key=key), self.assertRaisesRegex(AssertionError, "mismatched"):
                runner.compare(case, control, fluffy)
        for side in ("attacker", "defender"):
            case, control, fluffy = pair()
            fluffy[side]["stats"][0] += 1
            with self.subTest(side=side), self.assertRaisesRegex(AssertionError, "differs in more than ability"):
                runner.compare(case, control, fluffy)

    def test_wrong_registered_ability_is_rejected(self):
        case, control, fluffy = pair()
        fluffy["defender"]["ability"] = 50
        with self.assertRaisesRegex(AssertionError, "Run Away and Fluffy"):
            runner.compare(case, control, fluffy)

    def test_control_modifier_is_rejected(self):
        case, control, fluffy = pair()
        control["damageRatio"] = 2048
        with self.assertRaisesRegex(AssertionError, "Control unexpectedly"):
            runner.compare(case, control, fluffy)

    def test_worker_native_hang_has_a_hard_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "trials").mkdir()
            args = argparse.Namespace(max_frames=1, trial_timeout=0.1, melon_python=None, melon_lib=None,
                                      verify_detector=False, reverse_cases=False)
            with patch.object(runner.subprocess, "run", side_effect=subprocess.TimeoutExpired("worker", 0.1)) as run:
                with self.assertRaisesRegex(RuntimeError, "exceeded 0.1s"):
                    runner.isolated_batch(args, output, output, {}, {"name": "control"})
                self.assertEqual(run.call_args.kwargs["timeout"], 0.1)
            import json
            workspace = json.loads((output / "trials/control-batch.input.json").read_text())["workspace"]
            self.assertFalse(Path(workspace).exists())

    def test_restore_resets_host_rng_errors_pending_and_input(self):
        emu = MagicMock()
        observer = runner.BattleObserver(emu, {"abilityId": 218})
        observer.pointers = {"attacker": 0x02010000, "defender": 0x02011000}
        observer.pending = {"calculatedDamage": 42}
        observer.errors = [AssertionError("previous case")]
        observer.rng_pending = {123: [100]}
        observer.rng_calls = [{"bound": 100}]
        observer.injected_faults = 1
        emu.frame_count = 509
        emu.memory.unsigned.__getitem__.return_value = b"unchanged"
        case = {"id": "next"}
        runner.restore_checkpoint(emu, observer, b"snapshot", 509,
                                  {"attacker": b"unchanged", "defender": b"unchanged"}, case)
        emu.restore_snapshot.assert_called_once_with(b"snapshot")
        emu.input.keypad_update.assert_called_once_with(0)
        emu.input.touch_release.assert_called_once()
        self.assertIs(observer.case, case)
        self.assertIsNone(observer.pending)
        self.assertEqual((observer.errors, observer.rng_calls, observer.rng_pending, observer.injected_faults), ([], [], {}, 0))

    def test_incomplete_memory_rollback_is_rejected(self):
        emu = MagicMock()
        emu.frame_count = 509
        emu.memory.unsigned.__getitem__.return_value = b"old-damage"
        observer = runner.BattleObserver(emu, {"abilityId": 218})
        observer.pointers = {"defender": 0x02011000}
        with self.assertRaisesRegex(AssertionError, "restore defender"):
            runner.restore_checkpoint(emu, observer, b"snapshot", 509, {"defender": b"full-health"}, {})

    def test_trainer_patch_changes_only_selector_and_checks_expected_byte(self):
        with tempfile.TemporaryDirectory() as directory:
            rom = Path(directory) / "tiny.nds"
            rom.write_bytes(b"\x00\x11\x22")
            runner.patch_variant_rom(rom, [{"offset": 1, "expected": 0x11, "value": 0x21}])
            self.assertEqual(rom.read_bytes(), b"\x00\x21\x22")
            with self.assertRaisesRegex(AssertionError, "expected trainer"):
                runner.patch_variant_rom(rom, [{"offset": 1, "expected": 0x11, "value": 0x21}])
            with self.assertRaisesRegex(AssertionError, "gender"):
                runner.patch_variant_rom(rom, [{"offset": 1, "expected": 0x21, "value": 0x22}])

    def test_batch_failure_releases_snapshot_and_never_writes_savestate(self):
        with tempfile.TemporaryDirectory() as directory:
            artifacts = Path(directory)
            emu = MagicMock()
            emu.frame_count = 509
            observer = MagicMock()
            observer.command_frame = 508
            observer.registered = {"attacker": {}, "defender": {}}
            observer.pointers = {"attacker": 0x02010000, "defender": 0x02011000}
            emu.memory.unsigned.__getitem__.return_value = b"baseline"
            emu.save_snapshot.return_value = b"owned-snapshot"
            with patch.object(runner, "clone"), patch.object(runner, "patch_variant_rom"), \
                 patch.object(runner.shutil, "copyfile"), patch.object(runner, "BattleObserver", return_value=observer), \
                 patch.object(runner, "restore_checkpoint", side_effect=AssertionError("restore failed")):
                with self.assertRaisesRegex(AssertionError, "restore failed"):
                    runner.run_batch(lambda library: emu, None, artifacts,
                                     {"rom": {"file": "battle.nds"}, "save": {"file": "battle.sav"}, "cases": [{"id": "contact"}]},
                                     {"name": "control", "romPatches": []}, 1, artifacts, directory)
            import json
            batch = json.loads((artifacts / "control-batch.json").read_text())
            self.assertTrue(batch["snapshotReleased"])
            self.assertFalse(batch["verified"])
            self.assertEqual([p.name for p in artifacts.iterdir()], ["control-batch.json"])
            observer.close.assert_called_once()
            emu.destroy.assert_called_once()


class FixtureCleanupTests(unittest.TestCase):
    def write_fixture(self, directory):
        runner.create_output_directory(directory)
        (directory / "battle.nds").write_bytes(b"test fixture ROM")
        save = bytearray(0x80000)
        for half in (0, 0x26000):
            save[half + 0x19400] = 0x80
        (directory / "battle.sav").write_bytes(save)
        manifest = {
            "format": "pokeweb-battle-interactions-2", "suite": "fluffy",
            "battleAnimationsEnabled": False, "inputRomSha256": "input-rom",
            "inputSaveSha256": "input-save", "harnessSha256": "harness", "harnessCpuChecks": 1400,
            "cases": [{"id": name, "moveId": move, "ratio": ratio, "moveSlot": slot, "name": name}
                      for slot, (name, move, ratio) in enumerate(runner.FLUFFY_CASES)],
            "variants": [{"name": "control", "abilityId": 50, "abilitySlot": 1, "romPatches": []},
                         {"name": "fluffy", "abilityId": 218, "abilitySlot": 2, "romPatches": [{}]}],
            "rom": {"file": "battle.nds", "sha256": runner.digest(directory / "battle.nds")},
            "save": {"file": "battle.sav", "sha256": runner.digest(directory / "battle.sav")},
        }
        (directory / "suite.json").write_text(json.dumps(manifest))
        return manifest

    def invoke(self, output, options=(), build_failure=False, worker_failure=False):
        def build(command, **kwargs):
            directory = Path(command[command.index("--out") + 1])
            self.write_fixture(directory)
            if build_failure:
                raise subprocess.CalledProcessError(1, command)

        batch = {"coldBoots": 1, "snapshotRestores": 4, "snapshotReleased": True,
                 "trials": {name: {} for name, _, _ in runner.FLUFFY_CASES}}
        with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()), \
             patch.object(runner, "native_log", side_effect=lambda path: nullcontext()), \
             patch.object(runner, "configure_melon"), patch.object(runner.subprocess, "run", side_effect=build), \
             patch.object(runner, "isolated_batch", return_value=batch,
                          side_effect=RuntimeError("worker deadline") if worker_failure else None), \
             patch.object(runner, "compare", return_value={"passed": True, "controlDamage": 42,
                                                           "fluffyDamage": 21, "multiplier": 0.5}):
            result = runner.main(["--out", str(output), *options])
        return result, json.loads((output / "result.json").read_text())

    def test_default_deletes_rom_but_keeps_save_manifest_and_results(self):
        with tempfile.TemporaryDirectory() as root:
            output = Path(root) / "run"
            status, report = self.invoke(output)
            self.assertEqual(status, 0)
            self.assertFalse((output / "fixtures/battle.nds").exists())
            self.assertTrue((output / "fixtures/battle.sav").is_file())
            self.assertTrue((output / "fixtures/suite.json").is_file())
            self.assertEqual(report["fixtureCleanup"], {"policy": "delete-generated-rom",
                                                       "removedFiles": ["battle.nds"], "completed": True})

    def test_build_and_worker_failures_also_delete_only_rom(self):
        for failure in ("build_failure", "worker_failure"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as root:
                output = Path(root) / "run"
                status, report = self.invoke(output, **{failure: True})
                self.assertEqual(status, 1)
                self.assertFalse((output / "fixtures/battle.nds").exists())
                self.assertTrue((output / "fixtures/battle.sav").is_file())
                self.assertTrue(report["fixtureCleanup"]["completed"])

    def test_keep_fixtures_preserves_rom_even_after_failure(self):
        for failed in (False, True):
            with self.subTest(failed=failed), tempfile.TemporaryDirectory() as root:
                output = Path(root) / "run"
                status, report = self.invoke(output, ["--keep-fixtures"], worker_failure=failed)
                self.assertEqual(status, int(failed))
                self.assertTrue((output / "fixtures/battle.nds").is_file())
                self.assertTrue((output / "fixtures/battle.sav").is_file())
                self.assertEqual(report["fixtureCleanup"]["policy"], "keep-generated")

    def test_supplied_fixtures_are_never_deleted(self):
        for failed in (False, True):
            with self.subTest(failed=failed), tempfile.TemporaryDirectory() as root:
                directory = Path(root) / "supplied"
                self.write_fixture(directory)
                before = {p.name: p.read_bytes() for p in directory.iterdir()}
                status, report = self.invoke(Path(root) / "run", ["--fixtures", str(directory)], worker_failure=failed)
                self.assertEqual(status, int(failed))
                self.assertEqual({p.name: p.read_bytes() for p in directory.iterdir()}, before)
                self.assertEqual(report["fixtureCleanup"]["policy"], "preserve-supplied")

    def test_cleanup_error_fails_the_run_and_is_reported(self):
        with tempfile.TemporaryDirectory() as root, \
             patch.object(runner, "cleanup_fixture_rom", side_effect=PermissionError("cannot remove ROM")):
            status, report = self.invoke(Path(root) / "run")
            self.assertEqual(status, 1)
            self.assertFalse(report["passed"])
            self.assertFalse(report["fixtureCleanup"]["completed"])
            self.assertIn("cannot remove ROM", report["fixtureCleanup"]["error"])

    def test_cleanup_handles_missing_rom_without_touching_save(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "fixtures"
            self.write_fixture(directory)
            (directory / "battle.nds").unlink()
            self.assertEqual(runner.cleanup_fixture_rom(directory), [])
            self.assertTrue((directory / "battle.sav").is_file())

    def test_cleanup_refuses_directory_symlink(self):
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root) / "supplied"
            self.write_fixture(directory)
            link = Path(root) / "link"
            link.symlink_to(directory, target_is_directory=True)
            with self.assertRaisesRegex(AssertionError, "symlink"):
                runner.cleanup_fixture_rom(link)
            self.assertTrue((directory / "battle.nds").is_file())


if __name__ == "__main__":
    unittest.main()

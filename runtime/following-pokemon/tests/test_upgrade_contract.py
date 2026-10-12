"""Profile refresh must preserve trusted adapters and refuse changed natives."""
from copy import deepcopy
import json
from pathlib import Path
import struct
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import ndspy.narc

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import generate_upgrade_contract as generator


def narc(files):
    archive = ndspy.narc.NARC()
    archive.files = files
    return archive.save()


def fixture():
    site = dict(id="extra-adapter", segment="36", address=0x02100000, expectedHex="aabb", abi="unchanged", purpose="preserve")
    hook = dict(id="hook", segment="ARM9", address=0x02004000, expectedHex="01020304", patchBytes=4, instructionSizes=[2, 2])
    baseline = dict(schemaVersion=1, profile="white2upgrade", gameCode="IRDO", revision=0,
                    speciesMax=1023, maxRows=6144, sourceRomSha256="0" * 64,
                    requiredModules=[dict(path=path, sha256="0" * 64) for path in generator.MODULE_PATHS],
                    nativeAdapters=[site], notes=["preserve"], customMetadata={"keep": True})
    shared = dict(hooks=[hook], nativeAdapters=[], registry=dict(path="rows", stockRows=1, stride=28), resources=dict(path="resources", stockMembers=1))
    files = {"rows": narc([struct.pack("<I", 1) + bytes(28)]), "resources": narc([b"art"]),
             "a/0/1/6": narc([bytes(76)] * 1024), **{path: b"DLXF" + bytes(32) for path in generator.MODULE_PATHS}}
    rom = SimpleNamespace(arm9RamAddress=0x02004000, arm9=b"\x01\x02\x03\x04", getFileByName=files.__getitem__,
                          loadArm9Overlays=lambda ids: {36: SimpleNamespace(ramAddress=0x02100000, data=b"\xaa\xbb")})
    data = bytearray(32)
    data[12:16] = b"IRDO"
    return baseline, shared, rom, bytes(data), files


class UpgradeContractTests(unittest.TestCase):
    def refresh(self, baseline, shared, rom, data):
        with patch.object(generator.ndspy.rom, "NintendoDSRom", return_value=rom):
            return generator.refresh(data, baseline, shared)

    def test_preserves_every_adapter_metadata_and_original(self):
        baseline, shared, rom, data, _ = fixture()
        original = deepcopy(baseline)
        value = self.refresh(baseline, shared, rom, data)
        self.assertEqual(baseline, original)
        self.assertEqual(value["nativeAdapters"], baseline["nativeAdapters"])
        self.assertEqual(value["customMetadata"], baseline["customMetadata"])
        self.assertEqual(value["previousSourceRomSha256"], [baseline["sourceRomSha256"]])
        self.assertEqual(self.refresh(value, shared, rom, data), value)

    def test_refuses_changed_shared_hook(self):
        baseline, shared, rom, data, _ = fixture()
        rom.arm9 = b"\xff\x02\x03\x04"
        with self.assertRaisesRegex(ValueError, "hook"):
            self.refresh(baseline, shared, rom, data)

    def test_refuses_changed_upgrade_adapter(self):
        baseline, shared, rom, data, _ = fixture()
        rom.loadArm9Overlays = lambda ids: {36: SimpleNamespace(ramAddress=0x02100000, data=b"\xaa\x00")}
        with self.assertRaisesRegex(ValueError, "extra-adapter"):
            self.refresh(baseline, shared, rom, data)

    def test_refuses_empty_or_out_of_range_adapter(self):
        for updates in ({"expectedHex": ""}, {"address": 0x020fffff}, {"expectedHex": "aabbcc"}):
            baseline, shared, rom, data, _ = fixture()
            baseline["nativeAdapters"][0].update(updates)
            with self.assertRaises(ValueError):
                self.refresh(baseline, shared, rom, data)

    def test_refuses_partial_instructions_and_wrong_revision(self):
        baseline, shared, rom, data, _ = fixture()
        shared["hooks"][0]["instructionSizes"] = [2]
        with self.assertRaisesRegex(ValueError, "Partial instruction"):
            self.refresh(baseline, shared, rom, data)
        with self.assertRaisesRegex(ValueError, "revision"):
            self.refresh(baseline, shared, rom, data[:30] + b"\x01\x00")

    def test_refuses_missing_module_or_bad_archives(self):
        for path in (generator.MODULE_PATHS[0], "rows", "resources", "a/0/1/6"):
            baseline, shared, rom, data, files = fixture()
            del files[path]
            with self.assertRaises(KeyError):
                self.refresh(baseline, shared, rom, data)
        baseline, shared, rom, data, files = fixture()
        files["a/0/1/6"] = narc([bytes(76)] * 710)
        with self.assertRaisesRegex(ValueError, "expanded"):
            self.refresh(baseline, shared, rom, data)

    def test_failed_generation_does_not_replace_output(self):
        baseline, shared, rom, data, _ = fixture()
        rom.arm9 = b"bad!"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline_path = root / "baseline.json"
            baseline_path.write_text(json.dumps(baseline))
            output = root / "contract.json"
            output.write_text("untouched")
            source = root / "input.nds"
            source.write_bytes(data)
            with patch.object(generator, "HERE", root), patch.object(generator.ndspy.rom, "NintendoDSRom", return_value=rom):
                (root / "contract.json").write_text(json.dumps(shared))
                # Use a distinct output so the trusted shared contract stays intact.
                output = root / "output.json"
                output.write_text("untouched")
                with self.assertRaises(ValueError):
                    generator.generate(source, output, baseline_path)
                self.assertEqual(output.read_text(), "untouched")


if __name__ == "__main__":
    unittest.main()

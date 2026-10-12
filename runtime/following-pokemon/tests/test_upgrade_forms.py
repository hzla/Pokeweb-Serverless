"""Explicit Mega substitutes must not become a catch-all unknown-form fallback."""
from copy import deepcopy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from import_upgrade_assets import extend_expansion_forms, EXPANSION_MEGA_BASE_FORMS, MEGA_PLACEHOLDER


def fixture():
    personal = [bytearray(76) for _ in range(1024)]
    entries = []
    for species in range(650, 1024):
        personal[species][18] = 255
        for form in [0, *sorted(set(EXPANSION_MEGA_BASE_FORMS.get(species, {}).values()) - {0})]:
            personal[species][32] = max(personal[species][32], form + 1)
            for shiny in (False, True):
                entries.append(dict(species=species, form=form, gender=2, shiny=shiny, member=form,
                                    placeholder=False, placeholderReason=None, size=32, profile="pokemon-asymmetric"))
    return personal, dict(appearances=entries, resources=[{}, {}], archiveSha256="unchanged")


class UpgradeFormsTests(unittest.TestCase):
    def test_explicit_sources_and_idempotence_without_resource_changes(self):
        personal, manifest = fixture()
        original = deepcopy(manifest)
        for species, forms in EXPANSION_MEGA_BASE_FORMS.items():
            personal[species][32] = max(forms) + 1
        value = extend_expansion_forms(personal, manifest)
        self.assertEqual(manifest, original)
        self.assertEqual(value["resources"], original["resources"])
        self.assertEqual(value["archiveSha256"], original["archiveSha256"])
        for species, forms in EXPANSION_MEGA_BASE_FORMS.items():
            for form, source in forms.items():
                for shiny in (False, True):
                    entry = next(e for e in value["appearances"] if (e["species"], e["form"], e["shiny"]) == (species, form, shiny))
                    self.assertEqual(entry["member"], source)
                    self.assertTrue(entry["placeholder"])
                    self.assertIn(MEGA_PLACEHOLDER, entry["placeholderReason"])
        self.assertEqual(extend_expansion_forms(personal, value), value)

    def test_unknown_form_missing_source_and_duplicates_rejected(self):
        for mode in ("unknown", "missing", "duplicate", "bad-resource"):
            personal, manifest = fixture()
            if mode == "unknown": personal[650][32] = 2
            elif mode == "duplicate": manifest["appearances"].append(manifest["appearances"][0])
            else:
                personal[809][32] = 2
                if mode == "missing": manifest["appearances"] = [e for e in manifest["appearances"] if e["species"] != 809]
                else:
                    for entry in manifest["appearances"]:
                        if entry["species"] == 809: entry["member"] = 99
            with self.assertRaises(ValueError): extend_expansion_forms(personal, manifest)


if __name__ == "__main__": unittest.main()

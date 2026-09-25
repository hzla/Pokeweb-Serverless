"""Generate the stock Surf package note from the source and asset manifest."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
manifest = json.loads((HERE.parents[1] / "src/assets/following/surf-mounts.json").read_text())
small = sum(entry['frameSize'] == 32 for entry in manifest['entries'])
large = sum(entry['frameSize'] == 64 for entry in manifest['entries'])
note = f"""# Surf mounts — stock White 2 0.6.49 alpha

A custom Surf mount is chosen from the currently selected follower when it knows move 57 (Surf). Otherwise, the first non-Egg party Pokémon that knows Surf supplies the mount. A fainted Pokémon qualifies, and move PP does not affect the artwork selection. Native Surf eligibility still governs whether Surf can begin. If no party member qualifies, or the selected custom art cannot load, the retail mount is used. Party and move edits are checked on each field update so the mount can change without a new save. The land follower resumes after Surf.

The importer reads the four `followersprites` Swimming/Levitates normal and shiny folders and generates `following/surf-registry.bin` plus `following/surf-mounts.narc`. Each sorted version-2 registry record is eight bytes: species, form, gender, shiny state, frame size and NARC member index. It contains {len(manifest['entries'])} stock-supported appearances and {manifest['members']} texture members; the archive is {manifest['bytes']:,} bytes and the index is {manifest['registryBytes']:,} bytes. Each appearance has sixteen textures: four frames for each of up, down, left, and right. The source sheets are doubled pixel art and are downsampled by two: {small} appearances use 32-pixel textures and {large} use 64-pixel textures. Intermediate 70/80-pixel source cells are downsampled, then centered and bottom-aligned in a 64-pixel texture without stretching. Only the chosen mount's sixteen resources are loaded into RAM. Source hashes and conversion results are recorded in `surf-mounts.json`; sheets with over fifteen visible RGB555 colors use deterministic, no-dither palette reduction.

All 649 native species have normal and shiny base art. Native forms and female artwork are used only where matching sheets exist. A missing shiny form falls back to the normal-color sheet of that same form before considering any base-form sheet. The importer explicitly excludes later-only forms, including numbered Galarian Darmanitan sheets. Gen 6+ species are excluded. The registry cap is 2,048 entries and the NARC member cap is 65,535.

The two pinned mount-draw hooks cover ordinary Surf and the ground-to-water hop. They suppress the retail 3D mount only when the selected artwork resolves; texture loading follows on the next field update. Native ripple and rider are retained. The seated rider is lifted ten world pixels only while the custom mount has a fresh drawable transform; the lift is restored immediately, leaving collision and shadow state unchanged. During the shore hop back to land, the native Surf mode can outlast the mount, so the player returns to the native jump height as soon as the mount disappears. The north-facing mount draws behind the rider, while the south-facing mount draws in front with a four-world-pixel depth margin so bobbing cannot quantize their order into a tie. Both hooks, cached jump-frame drawing, stale-transform rejection, resource teardown, conversion and installation are covered by packaged or installer checks. Visual acceptance is pending human cold-boot emulator testing; no emulator was run for this release.
"""
(HERE / "SURF-ALPHA.md").write_text(note)
print("Generated Surf technical note; emulator acceptance remains pending.")

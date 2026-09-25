# Following Pokémon runtime

Pokeweb's dedicated Following Pokémon page installs three PMC modules for each supported profile. Current bundled versions are stock White 2 **0.6.64-alpha**, stock Black 2 **0.6.38-alpha**, Italian White 2 **0.6.39-alpha**, and White2Upgrade **0.7.33-alpha**. Stock games support species 1–649; White2Upgrade supports through 1023. Each profile has its own pinned binary contract, runtime fingerprint, and save family. Italian White 2 uses Italian generic dialogue; authored dialogue and gifts remain editable in Pokeweb.

The field module owns a temporary follower actor, a 64-record movement trail, identity validation, effects, conversations, land riding, and custom Surf. The resident core extends object-code lookup without changing stock results; the events module handles safe-scene policy. No follower actor is saved. Menus, unchanged PC storage, signs, and safe stationary conversations retain the visible follower; unsafe scenes, battles, doors, and genuine actor conflicts recall it. Seamless map crossings should retain it. L/R cycles the visible party follower without reordering the party. A+B mounts a visible eligible follower; ordinary Surf prefers a Surf-capable selected follower, then the first non-Egg Surf knower in party order. The selected land follower returns after Surf. Repel continuation retains a follower or mount for either answer.

Walking and mounted artwork use a draw-only depth correction to clear their native ground shadow. On south-facing steps a trailing follower remains behind the player after that correction; north, side, and stair policies are separate. Drawn quads are restored after synchronous submission, leaving world position, collision, shadow anchors, saves, and the movement trail unchanged. The current fixes passed isolated packaged-code checks, but visual acceptance of each current profile is pending. A saved emulator state contains its old loaded code: cold boot a new export with the matching ordinary save.

## Assets and authoring

The editor's asset workspace stores validated appearance data under `following/`. Species, form, gender, and shiny variants are independently replaceable. Imported PNG sheets have two columns (idle and step) and four rows (up, down, left, right): 64×128 pixels for 32-pixel poses or 128×256 for 64-pixel poses. Each pose has transparency and at most 15 opaque BGR555 colors. Explicit source mapping is required; the importer does not guess numbered forms. Gen 5 artwork and optional Gen 6–9 artwork, Surf mounts, and land-rider art are separate bundled resources.

Conditional dialogue and one-time gifts live in follower-owned NARCs and can be edited without recompiling PMC code. Gifts have ten stable per-Pokémon claim slots; any number of ordered rules may reuse those slots within archive capacity. The installer accepts modified revision-0 ROMs when their audited code sites and follower archive layout still match; a whole-ROM clean SHA is not required. It owns its files by fingerprint, supports recognized alpha updates and enable/disable, and leaves authored data in place when disabled. Removal writes inert modules at the owned file IDs; shared PMC and imported assets remain.

## Build and checks

From the Pokeweb repository root, supply an exact pinned clean ROM:

```sh
npm run following:build -- /path/to/cleanwhite2.nds
npm run following:build-black2 -- /path/to/cleanblack2.nds
npm run following:build-italy -- /path/to/cleanwhite2-italy.nds
npm run following:build-upgrade -- /path/to/White2Upgrade.nds
npm run following:test
npm run build
```

Add `--publish` to a profile build to replace its bundled DLLs and receipt only after binary and packaged-code checks pass. `following:build-rom` installs the bundled runtime into a test ROM without launching an emulator, then copies the versioned alpha ROM to `Repos/` and preserves existing saves. Manual test output defaults outside this source tree. Python tooling uses `ndspy`, Pillow, Unicorn, Capstone, and `pyelftools`; the existing ignored `build/python` dependency directories remain supported. Set `ARM_TOOLCHAIN_BIN`, `RPM_TOOL_JAR`, or `FOLLOWING_BUILD_DIR` when using nondefault local tools or output paths.

[VALIDATION.md](VALIDATION.md) records current automated evidence and its limits. [EMULATOR-CHECKLIST.md](EMULATOR-CHECKLIST.md) and the [Black 2](BLACK2-CHECKLIST.md), [Italian](ITALY-CHECKLIST.md), and [White2Upgrade](WHITE2UPGRADE-CHECKLIST.md) checklists are human cold-boot cases, not automated passes. [MEMORY-AUDIT.md](MEMORY-AUDIT.md) distinguishes fixed PMC payload from native graphics, stack, and VRAM use. The [test map](TEST-MAP.md) identifies build gates and manual diagnostics. Past alpha narratives remain in Git history.

## Limits

Human timing, sound, terrain, stair, occlusion, crowded-map allocation, and long-session checks remain necessary. Unsupported binary signatures are rejected. Stock ROMs cannot use later-generation species or art. Imported resources do not imply that every form has unique artwork. Retail content and unrelated PMC patches require their own compatibility checks. No current-profile full game-emulator acceptance is claimed by the packaged ARM tests.

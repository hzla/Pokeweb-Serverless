# White2Upgrade Following Pokémon — 0.7.15-alpha

This is a separate expansion profile of the follower accepted by the user in
stock White 2 0.6.10. Movement, dialogue, menu/PC handling, scene guards, ball
animations, and final actor draw correction use the same implementation. The
stock package is 0.6.24 and is not replaced by the expansion DLLs.

Version 0.7.15 retains the paused-actor correction and admits the pinned
interaction-progress broadcast used by ordinary sign and furniture scripts.
Version 0.7.14 first ignored projected routes from native movement-paused actors during
NPC, sign, and static-furniture conversations. Real position writes and routes
after unpause remain guarded. The same corrections ship in stock 0.6.24.

Version 0.7.13 fixes follower-gift Party and Bag access, shared with stock 0.6.22.
The interaction snapshot reads the live field zone at the verified `Field+0xE0`
offset instead of the player actor's zone field, which may be zero. Authored
dialogue and gift archives remain data files and survive runtime upgrades.

Version 0.7.3 adds selective wandering-NPC collision handling shared with stock
0.6.12. It leaves player passage and trainer sight unchanged, retains scripted
recall, and prevents follower movement into native NPC reservations. The resident
event bridge is ABI 4 in the current release. See [AMBIENT.md](AMBIENT.md) and human case U15.

Version 0.7.5 corrects remaining seamless-zone NPC placement and setup-command
recalls, shared with stock 0.6.14. The user confirmed the preceding menu and PC
storage fixes. Seamless crossing acceptance for this release remains pending. See [CONTINUITY.md](CONTINUITY.md), X01–X07 and U07a.
New game-emulator acceptance remains pending.

Version 0.7.6 adds width-dependent side spacing, shared with stock 0.6.15.
Each displayed appearance uses its widest opaque left/right walk frame. Extra
spacing is capped at six native world units and stored in existing registry
bits and a sidecar padding byte, without another heap buffer. See [SPACING.md](SPACING.md)
and human case U16. New emulator acceptance remains pending.

Version 0.7.8 restores native directional idle animation for a visible stationary
follower, shared with stock 0.6.17. External retained events and ball effects
freeze the current pose; returning to ordinary following resumes the loop without
moving the actor. It adds no asset, registry or heap buffer. See [IDLE.md](IDLE.md)
and human case U17. New emulator acceptance remains pending.

## Compatibility and ownership

The installer recognizes US IRDO revision 0 with the four audited White2Upgrade
runtime fingerprints in `upgrade-contract.json`. It checks every shared hook
and native adapter, the expansion allocation/free adapters, and overlapping
relocations from other installed patches before staging changes. A different
Upgrade runtime or conflicting patch is rejected; arbitrary Upgrade releases
are not claimed compatible. Personal data changes are accepted only when the
bundled appearance mappings and bounded registry can represent them.

The inspected input ROM is SHA-256
`6888096bd87bd3303a994f3f32bc5902fe21ad5c2eca50c11abea6b8c54a1e19`.
Expansion sources and input ROMs remain read-only. Installation uses three new
PMC modules and follower-owned data, plus appended overworld descriptors and
resources. No Upgrade module, story-partner state, or Pokémon save field is
rewritten by the installer. The ordinary exporter may normalize malformed NARC
containers; the batch test build preserves their member payloads and avoids
unrelated editor form-name repairs.

## Species and artwork

The profile supports species 1–1023, including every Gen 6–9 base species that
this White2Upgrade build implements. Species 1024/1025 are reserved Egg IDs in
that build; Terapagos and Pecharunt cannot be added by a follower graphics patch.
Gen 1–5 keep the existing stock/Gen 5 artwork policy.

The supplied `followersprites` pack provides normal and shiny base artwork for
all 374 later-generation species. Its ordinary `Followers` and `Followers shiny`
sheets are used; the swimming/levitating directories do not enable new traversal
modes. Of 1,658 later-generation appearance keys, 120 still use explicit alternate
form substitutions. Four HG-engine resources retain available alternate-form art
where the corresponding PNG is absent. See [coverage](UPGRADE-ASSET-COVERAGE.json)
for exact keys/reasons; filenames are never treated as species numbers.

PNG conversion crops the 4×4 sheet into cells and downsamples the doubled pixel
art by two with nearest-neighbor sampling. Source rows down/left/right/up become
native up/down/left/right; opposing step columns 0/2 supply the native two-frame
walk cycle. Transparent alpha becomes palette index zero regardless of the
transparent pixel's RGB. Nonstandard 35/40-pixel cells are centered and bottom
aligned on a 64-pixel canvas without cropping visible pixels. Native 64-pixel
billboards retain mirrored right-side animation; 32-pixel resources preserve
independent left/right frames. No runtime animation controller was changed.

All palettes are separate normal/shiny resources. Of 904 PNG resources, 177 need
reduction to 15 visible DS colors. Deterministic palette selection retains actual
source colors rounded to RGB555, without dithering. Conversion metadata records
source hashes, crop layout, palette counts and error; transparent background colors
never consume a visible palette slot. The remaining four resources come from
HG-engine. A spelling alias resolves `POLTHCAGEIST` to Poltchageist.

## Memory and lifecycle

The user reported no follower in 0.7.0. Their captured state showed startup
configuration failure, zero actor creations, and only 100,332 free bytes on
application heap 1. The 113,264-byte registry plus the 32,768-byte reserve could
not fit. Earlier allocation tests used a mocked, larger heap and missed this.

Version 0.7.1 stores the same complete catalog in FWDB v2: each appearance is
12 bytes instead of 24. A 32-bit packed appearance key is followed by 16-bit
descriptor/resource references, packed placeholder/size/animation flags and
three signed offsets. Headers, checksums and zone records retain their existing
bounds. The editable project registry and stock runtime still use v1. Migration
preserves every appearance, offset, zone diagnostic, descriptor and resource.

Version 0.7.2 keeps the complete registry in ROM. A 2,050-byte species index
and 1,024-byte page cache replace the full application-heap allocation. The
stock 0.6.11 build uses the same implementation with a 1,302-byte index. Startup
streams header/record/zone validation and both checksums before publishing
lookup bounds; later identity changes read only the matching species pages.
File handles close before returning, and no registry I/O runs in movement or
render callbacks. Missing/short/invalid data suppresses following safely.
Core bridge ABI 2 uses a synchronous reader and retains no field callback.
Unload revokes extension bounds and invalidates the cache.

Bounded FWCG v2 diagnostics contain stage, registry length, cache capacity and
read count. Stage 7 is ready; stage 8 is a selection-time read failure. Both
profiles reserve 8,192 bytes for the 3,852-byte conversation data. Upgrade
reaction selection now accepts species 1–1023, excluding reserved Egg IDs.

An isolated CPU regression using the original captured heap code and metadata
passes three setup/cache/unload cycles, retaining 100,332 free bytes throughout
and making zero registry heap allocations. Filesystem responses use exported
ROM data. This does not execute actor creation, GPU rendering or a DS emulator.

| Package | Fixed code/data/BSS plus separate registry |
|---|---:|
| Stock 0.6.10 | 143,964 B (140.6 KiB) |
| Stock 0.6.11 | 41,080 B (40.1 KiB) |
| Upgrade 0.7.1 | 102,612 B (100.2 KiB) |
| Upgrade 0.7.2 | 42,008 B (41.0 KiB) |
| Stock 0.6.12 | 42,408 B (41.4 KiB) |
| Upgrade 0.7.3 | 43,336 B (42.3 KiB) |
| Stock 0.6.14 | 42,960 B (42.0 KiB) |
| Upgrade 0.7.5 | 43,888 B (42.9 KiB) |
| Stock 0.6.15 | 43,152 B (42.1 KiB) |
| Upgrade 0.7.6 | 44,132 B (43.1 KiB) |
| Stock 0.6.17 | 43,212 B (42.2 KiB) |
| Upgrade 0.7.8 | 44,192 B (43.2 KiB) |
| Stock 0.6.21 | 51,460 B (50.3 KiB) |
| Upgrade 0.7.12 | 52,444 B (51.2 KiB) |
| Stock 0.6.24 | 51,624 B (50.4 KiB) |
| Upgrade 0.7.15 | 52,608 B (51.4 KiB) |

These figures exclude loader metadata, allocator overhead, stack, variable
native actor/effect/message resources and VRAM. They are not whole-game peaks.
The new modules make no separate registry allocation. See the reproducible
[measurement audit](MEMORY-AUDIT.md) and [validation record](VALIDATION.md).

The object-code extension is bounded to 6,144 rows for this profile; stock uses
4,096. The current catalog has 4,718 entries and 5,726 total descriptor rows.
Descriptor arithmetic remains 32-bit. The resident module stores only validated
bounds, never a borrowed registry pointer. Native fixed-size rendering caches
are not enlarged. Expanded cries continue through the base game's native sound
calls; this patch does not add later-generation cry assets.

## Reproduce

From Pokeweb-Serverless, with local paths substituted as needed:

```sh
npm run following:import-upgrade -- /path/to/White2Upgrade.nds /path/to/hg-engine /path/to/text_Species_en.txt --png-root /path/to/followersprites
npm run following:verify-fan-assets -- /path/to/followersprites
npm run following:build-upgrade -- /path/to/cleanwhite2.nds --publish
npm run following:build-rom -- /path/to/White2Upgrade.nds runtime/following-pokemon/build/white2upgrade-test /path/to/previous.sav
npm run following:verify-upgrade -- /path/to/White2Upgrade.nds /path/to/White2Upgrade-Following-0.7.15-alpha.nds
FOLLOWING_PROFILE=white2upgrade FOLLOWING_BUILD_DIR="$PWD/runtime/following-pokemon/build/white2upgrade" python3 runtime/following-pokemon/verify_upgrade.py /path/to/White2Upgrade-Following-0.7.15-alpha.nds
FOLLOWING_BUILD_DIR="$PWD/runtime/following-pokemon/build/white2upgrade" python3 runtime/following-pokemon/verify_upgrade_snapshot.py /path/to/nofollowers.mln /path/to/White2Upgrade-Following-0.7.15-alpha.nds
python3 runtime/following-pokemon/generate_upgrade_docs.py
```

Build verification uses the clean binary contract because the injected call sites
and ABI are unchanged; installation separately checks the actual Upgrade ROM.
The contract generator is for capturing an independently audited baseline, not
for bypassing an unsupported-runtime rejection. Reimporting art does not require
recompiling the modules.

The batch builder delivers `White2Upgrade-Following-0.7.3-alpha.nds` to `Repos/`.
An explicit prior `.sav` can seed a new version; an existing destination save is
preserved. Later expansion builds inherit the latest earlier expansion save.
The 0.7.3 delivery copies the user's preceding 0.7.2 save for continuity. Keep an
original copy before playing the expansion; expanded-species saves belong with
White2Upgrade, not stock White 2.

## Acceptance

[WHITE2UPGRADE-CHECKLIST.md](WHITE2UPGRADE-CHECKLIST.md) covers cold boot,
representative Gen 6–9 and shiny leads, forms, palettes, stairs/buildings,
conversations, PC/menus, battles, transitions and 100 mixed cycles. All emulator
and hardware rows remain pending. Automated CPU/asset/install evidence is recorded
in [VALIDATION.md](VALIDATION.md), separately from user-reported stock results.

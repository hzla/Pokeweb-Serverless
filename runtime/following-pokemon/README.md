# Following Pokémon for White 2 — development package

White2Upgrade has a separate **0.7.15-alpha** profile with species 1–1023,
available Gen 6–9 artwork and explicit missing-art/form placeholders. See
[White2Upgrade compatibility, build and limitations](WHITE2UPGRADE.md) and its
[human checklist](WHITE2UPGRADE-CHECKLIST.md). Stock White 2 uses 0.6.24-alpha.
The user accepted stock 0.6.10 as good enough; expansion emulator acceptance is
still pending.

The current release stops dormant random-movement routes from causing recalls
during NPC conversations, sign reading, and static-furniture interactions. It
uses the native per-actor movement-pause bit and retains synchronous position
guards for real scripted movement. The HGSS ball-effect paths have no dedicated
send-out or recall sound call, so the corresponding White 2 effects remain
silent rather than using a guessed sound.

The preceding release fixes contextual location matching. Conversation snapshots
now read `Field::ZoneID` from the audited field object at offset `0xE0`; the
player actor's zone field can remain zero during ordinary exploration. The
reported Aspertia City state contained the valid zone-427/Mew rule but selected
the wildcard fallback because the preceding runtime used that actor field.

This release restores the normal directional idle loop for a visible stationary
follower. It freezes during follower/NPC interaction, retained menus and scenes,
and send-out/recall effects, then resumes without moving the actor or changing
the trail. See [stationary animation behavior](IDLE.md) and I01–I05/U17 in the
human checklists. Emulator acceptance remains pending.

This release adds width-dependent sideways spacing, derived from opaque side
artwork at installation/import. Narrow sprites keep the existing distance;
wider sprites receive up to six extra native world units. No registry-size or
heap-buffer growth is needed. See [spacing design](SPACING.md) and human cases
W01–W05. The rendering correction remains unchanged.

The user confirmed menu closure and PC storage are fixed. The preceding release corrected
two remaining seamless-zone recall triggers: initial NPC placement was treated
as movement from a zeroed origin, and the zone NPC setup command was unsupported.
PC presentation remains visible, and storage returns restore an unchanged
selected Pokémon without a ball effect. A changed selected Pokémon uses normal
replacement after walking. See [continuity corrections](CONTINUITY.md) and
checklist X07 at Floccesy Town / Route 20, followed by X01, X04 and X05
regressions. New emulator acceptance remains pending.

The user reported the preceding wandering-NPC fix worked. Wandering NPCs now consider the visible follower during their native collision
checks. The player, trainer sight and non-movement queries retain retail behavior;
scripted conflicts still recall. Follower movement also checks NPC reservations
before committing a trail sample. See [ambient collision design](AMBIENT.md)
and N01–N08 in the human checklist. Game-emulator acceptance remains pending.

Both profiles now keep their appearance registry in ROM, with a 1 KiB page
cache and a small species index. Conversation capacity is 8 KiB. Upgrade
conversations accept species through 1023. Fixed code/buffer payloads are
reported in MEMORY-AUDIT.md; native graphics/UI and loader costs remain
separate. See [memory measurements](MEMORY-AUDIT.md). Both new releases require
human cold-boot acceptance; the historical rendering implementation is unchanged.

Version 0.6.9 regressed stair and overlap behavior: the correction was attached
to the secondary billboard pass, whose scene does not own the player/follower.
Its ownership check skipped the correction after the old update-time handling
had been removed. Version 0.6.10 adds a verified main actor pass hook at overlay
36 `0x0218119A`. The existing secondary pass remains responsible for ball effects.
The new regression executes retail argument-loading instructions with distinct
scene pointers captured from three supplied states. It rejects the 0.6.9 DLL.

The **0.6.10-alpha manual-test build** corrects depth immediately before native
billboard drawing, using final animation positions and the actual camera. Both
32px and 64px followers are covered. Flat sideways overlap uses a 1/8-world-unit
separation plus fixed-point rounding allowance, replacing the broad actor offsets.
Perspective translation and quad scale are adjusted together to preserve screen
placement. The native quad is restored after each draw; actor/world/trail state
is unchanged. Independent large-sprite stair policies remain separate.

The user reported alternating overlap and building clipping in both 0.6.7 and
0.6.8. Sigilyph is 32px and was skipped by those versions. Their earlier offset
checks did not verify final submission or establish visual correctness. This
build has automated submission/projection coverage; emulator acceptance remains
pending with the user.

The Gen 5 import now rejects visible sentinel-magenta palette entries. Seventeen
shiny resources contained 39 used `255/0/255` or `255/8/255` entries, including
both Landorus forms. Those entries deterministically use the corresponding
normal-palette color while the rest of each shiny palette remains intact. The
generated verifier decodes every direction and animation frame for all 624 Gen
5 appearances and fails if visible sentinel magenta remains.
An upper behind/side follower retains native map depth. Large lower-side and
foreground stair cases retain their separate policies, now computed from the
actual camera at final submission. No shared palette or polygon priority is
changed, and native world occlusion stays enabled. See [validation](VALIDATION.md)
and the [human checklist](EMULATOR-CHECKLIST.md) for limitations and test cases.

The bottom-screen X menu now pauses the existing follower without recalling it.
The Pokémon Center PC presentation does the same. Entering the Box still tears
down and reconstructs the field in the retail game, so the resident event module
retains one validated follower pose and reconstructs the current selected party
member there when the same field returns. This path has no recall or send-out
effect. Other full-screen applications retain conservative recall behavior.

All 624 valid Gen 5 species/form/gender/shiny appearance keys resolve to imported
artwork. NPC/sign conversations and supported stationary scenes keep the
follower visible and paused. Forced player movement, actor conflicts,
transitions and unsupported operations recall before the native action executes.
[Event policy and diagnostics](EVENTS.md) describe the supported subset.

Install from the dedicated **Following Pokémon** editor page → **Install follower alpha**,
export, and cold boot with an ordinary save. Walk at least one tile to seed the
follower. Generic HGSS A-button conversations remain available and change no
Pokémon stats or save data. The 0.4.1 completion-frame correction is retained.
The user confirmed **0.3.1 fixed the melonDS overworld freeze**, reported the
0.5.0 event behavior working, confirmed the 0.6.3 mid-step player-priority issue
is gone, and reported 0.6.4 much improved with one lower-side stair clipping
case remaining. The user reported 0.6.5 almost correct, with only a few railing
pixels still covering Zekrom's head. The user subsequently reported 0.6.7 and 0.6.8 still failing flat-ground rendering.
The user reported 0.6.9 regressed the previous fixes. The 0.6.10 routing
correction is pending human emulator acceptance; no DS game was run during
this build.

Gen 5 followers use bundled normal/shiny resources generated from the indexed
source sheets, including valid form and gender mappings. Earlier generations
continue to use the existing stock/fallback catalog. The editable artwork
catalog is separate; arbitrary replacements are not yet used by the runtime.
Exhaustive movement/activity coverage remains unfinished. Input ROMs and source
artwork are read-only.

`following:build-rom` exports a normal ROM under ignored `build/manual-test/`,
together with copies of the bundled test save, without launching an emulator.
It also copies the versioned `.nds` to the workspace's parent directory
(`Repos/` in this checkout). For a new alpha, the most recent earlier alpha's
`.sav` is copied there with the new ROM basename; an existing save for the
current version is preserved. Sample saves remain in the build directory. Use
the normal ROM with a matching `.sav` or `.dsv` basename in your emulator.
[Human emulator checklist](EMULATOR-CHECKLIST.md) covers the alpha smoke test and
all planned edge-case groups. [Validation](VALIDATION.md) distinguishes executed
checks from untested release requirements.

## Implemented

- `PokewebFollowingFieldW2.dll`, loaded with overlay 36, plus the resident
  `PokewebFollowingEventsW2.dll` and `PokewebFollowingCoreW2.dll`, linked through
  versioned bridge ABIs. Own native
  actor, bounded recorded-position trail, copied party identity, nonblocking
  flags, save exclusion, pre-unload destruction, event-aware pause/recall and menu/mode/partner guards,
  and extended appearance selection. No story-companion setup is called.
- Transactional Pokeweb installation plus enable/disable; imported assets remain
  intact. Installation verifies the clean baseline and hook/native-call bytes.
  Repeated install is idempotent; owned module/config/effects fingerprints protect
  toggles. Recognized earlier alphas can update while retaining their setting,
  authored contextual data, and owned appearance assets.
- Original HGSS ball/flash models and texture animation in an owned effects NARC.
  Send-out uses a brief ball followed by eight flash frames. Recall uses a private
  white silhouette at full, half, one-third and quarter scale, then a brief ball.
  The render adapter forwards the native billboard pass once. Effects own no
  saved actor, use no per-frame allocation/upload, and are cancelled on unload.
  [Effect implementation and test scope](EFFECTS.md) records the remaining visual checks.
- Generic HGSS conversations: 34 ordered reaction rules at neutral mood, 27
  English messages, 12 motions and seven private emotes. Current HP, status and
  friendship are copied into a bounded snapshot; a private RNG leaves gameplay
  randomness alone. Retail interactions keep priority. [Interaction details](INTERACTIONS.md).
- Fingerprint-checked runtime removal replaces all three owned DLLs with inert,
  hook-free modules. This keeps NitroFS IDs stable after export/reopen. Assets and
  shared PMC remain; reinstall restores the runtime transactionally.
- Exact clean US White 2 IRDO revision-0 SHA-256 and binary signature checks.
  `contract.json` records core patches, field hooks, and native adapter signatures.
- An installed resident `PokewebFollowingCoreW2.dll`. Its absolute
  lookup veneer preserves all 65,536 stock object-code results until a valid
  registry configures extension bounds. A failed reconfiguration clears bounds.
- An eight-byte, word-aligned descriptor-loader edit at `0x02167fb8` retains
  32-bit byte offsets. The native 26-entry cache is unchanged. Patching just
  `0x02167fba` through PMC's word-aligned copy relocation would be incorrect.
- Portable C selection, copied identity comparison, low-HP classification,
  counted suppression reasons, interaction state, and bounded recorded-pose
  history. The alpha integrates recorded world positions; dedicated ledge/rail semantics remain pending.
- A camera-yaw-aware external draw offset for 64-pixel followers. Its half-tile
  dead band and four-pixel margin keep equal-elevation screen-horizontal overlap behind the player,
  while a follower in the foreground wins depth testing on stairs. An elevated
  behind/side follower retains native map depth. A lower behind/side follower
  uses a bounded four-pixel clamp so artwork extending onto the higher step is
  not cut by rear railing geometry. Smaller followers keep native behavior.
- Matching C/TypeScript FWDB registry validation: ABI, count/length arithmetic,
  checksum, sorted keys, owned descriptor range, resource bounds, reserved bytes,
  and zone-policy validation. Diagnostic text stays in the companion JSON.
- A data-only Pokeweb asset workspace under `following/`, with species/form/
  gender/shiny filtering, four-direction idle/walk previews, PNG replacement,
  and asset-pack import/export. A complete batch validates before any filesystem
  map is committed. Replacing an appearance never edits a shared native resource.
- Deterministic PNG, explicitly mapped HGSS BTX, and hg-engine indexed PNG/JSON/
  JASC-palette imports. Missing art remains labelled, including pack round trips.

The current stock-art inventory covers 649 species through **2,574 appearance
keys**, of which **1,068** use exact stock appearances and **1,506** are explicit
placeholders. There are 618 distinct resources in that catalog. A matching
normal asset does not count as shiny coverage. The runtime then replaces all
**624 Gen 5 keys** with explicitly mapped imported art backed by **348** unique
normal/shiny resources; none of those Gen 5 runtime keys is a placeholder.

## Commands

Run from the Pokeweb repository. Supply your own baseline ROM path:

```sh
npm run following:verify-rom -- /path/to/clean-white2.nds
npm run following:build -- /path/to/clean-white2.nds
npm run following:build -- /path/to/clean-white2.nds --publish
npm run following:build-rom -- /path/to/clean-white2.nds
npm run following:verify-core
npm run following:verify-field -- /path/to/clean-white2.nds
npm run following:verify-effects -- /path/to/clean-white2.nds
npm run following:import-interactions -- /path/to/heartgold.nds
npm run following:verify-interactions
npm run following:verify-conversation-return -- /path/to/clean-white2.nds
npm run following:verify-scenes -- /path/to/clean-white2.nds
npx vite-node scripts/verify-following-install.ts /path/to/White2-Following-0.6.12-alpha.nds
npm run following:verify-installed-upgrade -- /path/to/White2-Following-0.5.0-alpha.nds
npx vite-node scripts/verify-following-upgrade.ts /path/to/clean-white2.nds /path/to/previous-field-module.dll
python3 runtime/following-pokemon/verify_registry_stream.py /path/to/White2-Following-0.6.12-alpha.nds
python3 runtime/following-pokemon/audit_memory.py /path/to/White2-Following-0.6.12-alpha.nds /path/to/White2Upgrade-Following-0.7.3-alpha.nds
python3 runtime/following-pokemon/generate_checklist.py
python3 runtime/following-pokemon/verify_packaged.py
npm run following:verify-assets -- /path/to/clean-white2.nds
npm run following:import-gen5 -- /path/to/clean-white2.nds /path/to/hg-engine
npm run following:test
npm run build
```

Python tools need `ndspy` and `Pillow`. The packaged-DLL build gate and compiled
checks also need `capstone`, `unicorn` and `pyelftools`. A local dependency
directory is supported at `build/python`.
For example, `python3 -m pip install --target runtime/following-pokemon/build/python
pyelftools==0.32` supplies the ELF reader without changing the system environment.
The C host tests use `CC` (default `cc`) with address/undefined-behavior sanitizers.

The development build accepts `ARM_TOOLCHAIN_BIN` and `RPM_TOOL_JAR`. Defaults
use the workspace ARM GNU toolchain and RPM tooling. It has no dependency on a
gameplay patch monolith. Outputs stay in ignored `build/`. Add `--publish` to the build command to copy
all three runtime DLLs and their fingerprints into application assets after verification.

Reimport the original effect assets with `npm run following:import-effects --
/path/to/heartgold.nds`. This requires the inspected US HeartGold IPKE resource
layout and regenerates the effects NARC, manifest and runtime checksum header.
Rebuild/publish the runtime after changing that archive. Sprite replacement
remains separate from these fixed effect resources.

Generate empty original billboard templates with:

```sh
python3 runtime/following-pokemon/make_templates.py
```

## Artwork workflow

Open **Code Injection → Following Pokémon → Prepare asset workspace** on the
pinned clean-ROM project. This writes only new `following/` data; it does not
activate following, append the native model registry, or install PMC modules.
Assets use the project's existing filesystem persistence and change tracking.
Prepared workspaces remain editable after ROM export/reopen. A recognized
installed alpha can be toggled or updated after reopening, with hook checks and
owned-file fingerprints still enforced. Starting a new installation requires
the pinned clean input.

For a single replacement, use a PNG with two columns (idle, step) and four rows
(up, down, left, right). Use 64×128 pixels for 32-pixel poses or 128×256 for
64-pixel poses. Pixels must be opaque or transparent, using at most 15 distinct
opaque BGR555 colors. Imports reject excess colors rather than silently choosing
a lossy palette. Each appearance is independently replaceable, including shiny.

Native Pokémon animation timing is up/left/right 10+10 ticks and down 5+10+5.
Mirrored resources use six poses; independent sides use eight. Preview and
conversion honor these profiles. The eight-pose controller's *native runtime*
selection and draw behavior still require verification before release.

Batch packages contain `manifest.json` with `schemaVersion: 1`, an `entries`
array, and each entry's `key`, relative `path`, `profile`, `placeholder`, and
optional `placeholderReason`/`source`. Profiles are `pokemon-mirrored` or
`pokemon-asymmetric`. Artwork is stored as validated I4 BTX resources.

For source imports, create an explicit JSON map and run:

```sh
npm run following:import -- import.json \
  --catalog runtime/following-pokemon/build/catalog.json \
  --output following-assets.zip
```

Example source manifest (paths are relative to this manifest):

```json
{
  "schemaVersion": 1,
  "entries": [{
    "key": { "species": 1, "form": 0, "gender": 0, "shiny": false },
    "source": "hg-engine",
    "path": "art.png",
    "metadata": "art.json",
    "palette": "normal.pal",
    "frameIndices": [0, 1, 2, 3, 4, 5, 6, 7]
  }]
}
```

Those frame indices are an example, **not an assertion about every HGSS or
hg-engine resource**. Audit each source mapping. `frameIndices` specifies eight
source texture indices in target up/down/left/right pose order. HGSS entries use
`source: "hgss"`, a BTX `path`, `paletteIndex`, and explicit `frameIndices`. PNG
entries use `source: "png"` with the documented sheet. Missing or substituted
art can set `placeholder: true` with `placeholderReason`.

## Remaining release work

- Dedicated accepted-movement capture for ledges, rail connections, and changing
  coordinate systems; verify grass, reflections, lighting, shadows and all terrain.
  The alpha samples actual player world positions and rejects large discontinuities.
- Complete script/activity/blackout guards and zone actor-ID audits. The alpha
  checks live actors in IDs F0–F8, preflights native allocation and preserves
  supported events. Unsupported commands recall with diagnostics. A full static
  zone/script audit and exhaustive in-game timing tests remain outstanding.
- Connect arbitrary editor replacements to runtime archive generation, add map
  policy controls, and complete removal/restoration behavior for user-selected
  replacement resources.
- Human visual/audio/input acceptance of the new conversations across maps and transitions.
- Exhaustive saves, battle/activity transitions, all forms, 100 mixed transitions,
  crowded-area allocation telemetry, and DS-family hardware testing.

See `GUARDS.md` for remaining guard verification and `EMULATOR-CHECKLIST.md` for
reproducible human test steps. Passing the alpha smoke test does not complete
these release gates.

### Rendering regression checks

`python3 runtime/following-pokemon/verify_render.py` executes the final packaged
DLL draw hook for both sprite sizes, current animation offsets, camera rotation,
stairs, repeated draws and invalid handles. Native GPU submission is inspected
by a spy. `following:test` also checks 1,728 independent fixed-point projection
cases. Publishing runs the packaged render checks automatically.

The bounded `FWRD` version-1 diagnostic records the frame, actor, sprite size,
applied flag, policy, before/after projected separation, camera axis, native and
submitted translation, and native/submitted width. Policy -1 is ordinary behind,
+1 foreground, -2 the separate lower-stair clamp, and 0 native/bypassed. Values
are transient and do not modify saves. Unsupported projection/billboard modes
forward native drawing unchanged.

## Conditional dialogue

The dedicated **Following Pokémon** editor page stores ordered zone, species, form, and type assignments in `following/contextual-dialogues.narc`. Rules run before the bundled generic conversation pool. The NARC is follower-owned, editable without rebuilding the PMC modules, and uses `{nickname}`, `{player}`, and `{location}` text tokens.

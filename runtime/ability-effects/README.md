# BW / BW2 ability effects

Use **Pokemon → Abilities** to edit existing abilities or create abilities through
ID 255. ID 0 is reserved; names are limited to 15 UTF-16 code units. Import a
template, edit its effects and AND/OR conditions, then apply it. Importing a draft
does not change the ROM. Removing custom effects preserves the name and ID.
Imports append effect cards and combine activation conditions with AND while
preserving nested OR groups and existing edits. An import that exceeds editor
bounds leaves the draft unchanged.

The Description field edits the ability's Summary text independently of its
battle effects. New ability descriptions are saved with Apply ability. Open
**In-game preview** to load the ROM's font and static Summary panel; the preview
updates while typing and warns about clipped text. It preserves explicit line
breaks (`\n` or entered newlines) and does not automatically wrap text. Preview
code and resources load on demand and parsed resources are shared per project.

Rules support up to 16 effects and bounded conditions for HP, type, weather,
species, status and moves. Templates and their editable controls are defined in
`src/pokeweb/abilityLibrary.ts`, `abilityNativeRuntime.ts` and `abilityRules.ts`.
Passive multipliers use the engine's fixed-point scale. Copied handlers preserve
native triggers and intrinsic restrictions; copying a callback does not reproduce
every ability-ID check elsewhere in the game. Imported recipes may implement
only the scope named in the picker. Fairy selectors require a Fairy-enabled ROM.

The additional field/history templates use native operations and private tracking;
they do not replace the scheduler or global ability-eligibility rules. Protean and
Libero expose their activation limit, and Mega Launcher covers pulse damage only.
Heal Pulse healing is unchanged.

**Triggered stat stages** can select the holder's or each target's highest raw
stat (excluding HP and ignoring stages; ties use Attack, Defense, Sp. Atk, Sp. Def,
then Speed). **After using a move** fires once after an executed move resolves,
including status moves and blocked or ineffective moves, but not a flinched turn.
**Knockout splash damage** targets the defeated opponent's surviving active allies;
its percentage can use the defeated opponent's or each recipient's maximum HP.
Only knockouts caused by the holder's move damage count; bench Pokémon are excluded.

All edited abilities share `patches/AbilityEffects.dll`; the browser does not
compile native code. Applying an edit verifies native signatures, dependencies,
relocations and hook conflicts before committing the change. Recognized BW2 battle
counter and trainer-nature adapters are handled by the installer. Unknown patches
and rewritten native dispatchers are rejected.

Supported profiles are US revision-0 Black, White, Black 2 and White 2 with
compatible native interfaces. BW uses overlay 93 and message banks 182/183/285; BW2 uses
overlay 167 and banks 374/375/487. Black also accepts the reviewed native code
variants in Frost’s bundled `Black1Fairy.Vpatch` (SHA-256
`9fd6d01269bada1d8f2195ca26cc33f347de623e18d15d0b90c3033842507f14`),
including copied Color Change and adjustable Magnet Pull. Fairy is detected from
the native type chart when loading Pokémon without Moves. White uses its own
checked native bindings; the reviewed Frost Fairy variants apply to Black only.
Other regions/revisions are not supported. Compatible moved layouts are resolved
by checked signatures and calls; unrecognized handler bodies or dependencies are
rejected. Hardware and DSi behavior require independent testing; catalog availability is not complete
gameplay coverage of every recipe or combination.

Definitions are indexed by ability ID. Edited abilities subscribe only to the
events needed by their effects and state observers, including AI simulations.
AND/OR conditions short-circuit in their displayed order. Effective weather still
uses the native query, preserving Cloud Nine and other ordinary weather guards.
Rule complexity and the active battlers matter more than stored ability count.

The Moves page has a separate **Expanded Flags** row for biting, pulse, ball/bomb,
slicing, powder, wind and healing classifications. These are separate from native
move flags such as contact and sound. Changes save immediately and install the
shared ability DLL and code-injection dependency when needed. Overrides are keyed
by actual ROM move ID, including expanded IDs; unchecked stock classifications
stay cleared after export/reload. Supported Frost expansion signatures and Pokeweb's
expansion routing are detected automatically. Named Gen 6–9 moves receive their
classification at the actual ROM ID, including Frost projects that leave BW's
uppercase name bank unexpanded. Empty expansion slots receive no flags. Automatic
defaults are saved separately from manual overrides, so renaming an installed move
does not discard its flags. Unknown layouts and unrecognized names need manual
classification. Installing Pokeweb's expansion after ability recipes refreshes the
same DLL. Export also refreshes newly detected classifications in a current runtime,
including after an external expansion or newly named moves. Unedited native moves
retain the shipped defaults.
The lookup reads sorted classification data without dispatching battle events.

**Manage flags** creates named custom tags. Check a tag in a move's Expanded Flags
row, then choose **Custom: name** in an adjustable ability primitive's **Move filter**.
The same tag can drive power/damage modifiers, move blocking, priority, reactions
and type conversion wherever that primitive has a move filter. Existing AND/OR
activation conditions still apply. Copied native callbacks keep their native flag
checks; custom tags are consumed through the adjustable primitives.

Custom definitions and assignments are stored in versioned metadata in the same
shared DLL and survive ROM export/reload and project saves. Renaming preserves the
ID and all recipe references. A flag used by a saved ability cannot be removed
until those references are changed. Removed IDs are retired to prevent old drafts
from silently referring to a new tag. There are 242 custom IDs (filter values
14–255), names of 1–32 UTF-16 code units, and at most 4,096 move/tag assignments;
the normal shared-DLL memory budget also applies. IDs are independent of the seven
built-in classification bits. The runtime binary-searches sorted (move ID, flag ID)
pairs without additional battle-event or weather queries.

Power modifiers, including type-conversion bonuses, apply at the native power
ratio stage. Conversion bonuses apply only to moves whose type is converted.
Custom stat-stage actions check the requested stage change against native limits
before opening an ability popup, without issuing extra battle queries. Capped
changes do not open a popup. Other successful actions in the same activation retain their shared popup.

For a ROM using a verified older shared ability DLL, click **Update Ability Runtime**
in the left sidebar of **Pokémon → Abilities** or **Moves**, then export the ROM.
The button is enabled only for recognized older runtimes. This replaces the shared
DLL while preserving existing recipes, parameters, names and assignments. Applying
an ability edit also updates the runtime automatically. Unknown or altered DLLs
must pass normal compatibility checks before an update is available.
Start the exported ROM from a normal save; an emulator save state restores the
old runtime already loaded in memory.

Blocking recipes show an ability popup and an explanation. Native stat/status
prevention messages are reused where appropriate. Screen Cleaner opens its popup
only when it removes a selected screen. Wind Rider also handles Whirlwind's
forced-switch check. Perish Body applies the native timed Perish Song condition
and its countdown/fainting sequence; it does not refresh an affected attacker's
count on each hit. Entry notices are emitted at entry/ability gain, while passive
stat and damage calculations remain silent. Presentation follows the corresponding
behavior in pokeemerald-expansion while using Gen 5's native messages and queue.

Build from the repository root with `python3 runtime/ability-effects/build.py`.
The original templates remain available for strict verification of older exports;
the default build updates only the current custom-flag bundle (`--custom-flags-only`).
`--messages-only`, `--move-classes-only` and `--optimized-only` rebuild retained bundles for verification of older exports;
released bundles must remain byte-identical when making a new runtime. Runtime
version 5 adds the custom flag registry and generic filters; version 4 remains
available for strict verification of existing exports. Version 4 added battle
explanations, entry notices, expanded classification defaults,
Whirlwind absorption and the corrected Perish countdown. It includes version 3's
classification overrides, corrected power ratios and stat popup guards. New modules retain
`PokewebAbilityDispatchVersion: 2`; recipe and condition record formats are unchanged.
`test_conditions.c` checks the compiled evaluator's truth tables and skipped
queries with a host C compiler. `python3 runtime/ability-effects/test_move_classes.py`
checks the compiled classification lookup, stock defaults, clears and expanded IDs.
`verify_runtime_upgrade.ts` accepts an old ROM and
a new output directory to check migration and export/reload preservation.
Run `npx vitest run src/test/abilityRules.test.ts src/test/abilityLibrary.test.ts`
for model checks. BW1 binding generation takes an explicit clean ROM, reference
symbol directory and output JSON: `npx vite-node runtime/ability-effects/generate_bw1_bindings.ts INPUT.nds REFERENCE OUTPUT.json`. The generator reads names/addresses from reference metadata and code bytes from the ROM.
`verify_bw1_catalog.ts` checks import/export/reload; `build_bw1_cases.ts` creates
Black or White native battle fixtures using the bundled BW save. Native case
builders accept an input ROM and a separate output directory; `emulator.py`
requires local melonDS bindings and a headless library. Use `--no-roms` with
`verify_bw1_catalog.ts` to run the same round trips without retaining ROM copies.

To prepare a separate Frost Fairy Black base, use
`npx vite-node runtime/ability-effects/prepare_frost_black.ts CLEAN_BLACK.nds Black1Fairy.Vpatch NEW_OUTPUT.nds`.
This requires the reviewed patch and clean US revision-0 Black input, applies its
code/text/graphics sections, and refuses to overwrite the output. The input ROM
and existing saves are preserved. Use `--frost --client --stress` with
`build_bw1_cases.ts` for Fairy battle fixtures and the shared-module stress case.

For controlled performance fixtures, run
`npx vite-node runtime/ability-effects/build_performance_cases.ts INPUT.nds NEW_OUTPUT_DIRECTORY`.
The inputs are US Black or White 2 with compatible native interfaces and no
existing ability edits. `--doubles` uses White 2's direct launcher; it does not
simulate separate Multi Battle trainers. Run `python3 runtime/ability-effects/benchmark.py OUTPUT_DIRECTORY`
with the same melonDS dependencies as `emulator.py`; `--profile` adds read-only
callback counters. Results report emulated turn frames
and the interval from scripted input to the first live target-selection event.
That event is a calculation marker, not the first rendered animation frame.

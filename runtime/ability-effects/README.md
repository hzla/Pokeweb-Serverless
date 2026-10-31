# Black / BW2 ability effects

Use **Pokemon → Abilities** to edit existing abilities or create abilities through
ID 255. ID 0 is reserved; names are limited to 15 UTF-16 code units. Import a
template, edit its effects and AND/OR conditions, then apply it. Importing a draft
does not change the ROM. Removing custom effects preserves the name and ID.

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

Supported profiles are US revision-0 Black, Black 2 and White 2 with compatible
native interfaces. Black uses overlay 93 and message banks 182/183/285; BW2 uses
overlay 167 and banks 374/375/487. Black also accepts the reviewed native code
variants in Frost’s bundled `Black1Fairy.Vpatch` (SHA-256
`9fd6d01269bada1d8f2195ca26cc33f347de623e18d15d0b90c3033842507f14`),
including copied Color Change and adjustable Magnet Pull. Fairy is detected from
the native type chart when loading Pokémon without Moves. White 1 and other
regions/revisions are not supported. Compatible moved layouts are resolved by
checked signatures and calls; unrecognized handler bodies or dependencies are rejected. Hardware and
DSi behavior require independent testing; catalog availability is not complete
gameplay coverage of every recipe or combination.

Definitions are indexed by ability ID. Edited abilities subscribe only to the
events needed by their effects and state observers, including AI simulations.
AND/OR conditions short-circuit in their displayed order. Effective weather still
uses the native query, preserving Cloud Nine and other ordinary weather guards.
Rule complexity and the active battlers matter more than stored ability count.

For a ROM using a verified older shared ability DLL, open **Pokémon → Abilities**,
click **Update ability runtime**, then export the ROM. This replaces the shared
DLL while preserving existing recipes, parameters, names and assignments. Applying
an ability edit also updates the runtime automatically. Unknown or altered DLLs
must pass normal compatibility checks before an update is available.

Build from the repository root with `python3 runtime/ability-effects/build.py`.
The original templates remain available for strict verification of older exports;
`--optimized-only` rebuilds the current template bundle. New modules use
`PokewebAbilityDispatchVersion: 2`; their condition record format is unchanged.
`test_conditions.c` checks the compiled evaluator's truth tables and skipped
queries with a host C compiler. `verify_runtime_upgrade.ts` accepts an old ROM and
a new output directory to check migration and export/reload preservation.
Run `npx vitest run src/test/abilityRules.test.ts src/test/abilityLibrary.test.ts`
for model checks. Black binding generation takes an explicit clean ROM, reference
symbol directory and output JSON: `npx vite-node runtime/ability-effects/generate_bw1_bindings.ts INPUT.nds REFERENCE OUTPUT.json`. The generator reads names/addresses from reference metadata and code bytes from the ROM.
`verify_bw1_catalog.ts` checks import/export/reload; `build_bw1_cases.ts` creates
Black native battle fixtures using the bundled BW save. Native case builders accept an input ROM and a separate output
directory; `emulator.py` requires local melonDS bindings and a headless library.

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

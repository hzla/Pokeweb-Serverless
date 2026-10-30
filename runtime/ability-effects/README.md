# BW2 ability effects

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
relocations and hook conflicts before committing the change. Recognized battle
counter and trainer-nature adapters are handled by the installer. Unknown patches
and rewritten native dispatchers are rejected.

Supported profiles are US revision-0 Black 2 and White 2 with compatible native
interfaces. BW1 and other regions/revisions need separate profiles. Hardware and
DSi behavior require independent testing; catalog availability is not complete
gameplay coverage of every recipe or combination.

Build from the repository root with `python3 runtime/ability-effects/build.py`.
Run `npx vitest run src/test/abilityRules.test.ts src/test/abilityLibrary.test.ts`
for model checks. Native case builders accept an input ROM and a separate output
directory; `emulator.py` requires local melonDS bindings and a headless library.

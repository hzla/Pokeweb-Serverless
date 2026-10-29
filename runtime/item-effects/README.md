# Native item effects

The BW2 item editor combines native handler assignments, code/data parameters,
adjustable effects and bounded AND/OR conditions. Presets are editable starting
points; authoritative controls and formats are in `src/pokeweb/itemEffectsModel.ts`,
`itemRules.ts`, `itemRulePresets.ts` and the native profile catalog. BW1 and other
regions/revisions need separate verified profiles.

Shared native code parameters affect all users of that implementation; item-data
parameters remain per item. Composed rules support up to 16 effects, native
callbacks, trigger/target/chance settings and per-effect state. Native behaviors
retain their intrinsic restrictions. Fling, Natural Gift and bag-use routing stay
in item data; reward, breeding, evolution and field effects are outside this
in-battle library. Drive/Plate move typing does not reproduce form/ability systems.

All custom rules share `patches/ItemEffects.dll`. The builder verifies the loaded
ROM's callbacks and dependencies and relocates each selected copy once. Unknown
code and conflicting hooks are rejected before installation. Consumability applies
to the whole item; failed conditional activations retain it. AI/preview queries
restore private state and do not consume items.

Resident code/data/state is bounded to 64 KiB, with a separate 112 KiB loading
budget and checked 16-bit RPM offsets. The existing PMC loader still requires
compatible ARM9 bindings. Metadata supports project/ROM reopening and recognized
legacy migrations; changed templates/dependencies are checked again on reopen.

Build with `python3 runtime/item-effects/build_rules.py` (`--legacy` for the v3
template). Native catalog generators require explicit local reference inputs.
Run `npx vitest run src/test/itemEffectsModel.test.ts src/test/itemRules.test.ts`
for model checks. Native fixture builders write separate outputs; emulator tools
require melonDS and `MELONDS_HEADLESS_LIB`. Representative native cases do not
establish hardware, DSi or all cross-patch combinations.

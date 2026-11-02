# Move effects

The Moves page has an **Effects** editor for recognized US revision-0 Black,
White, Black 2 and White 2 ROMs, including the reviewed Frost Black Fairy and
vw2qol layouts. The full upgrade battle engine is not supported. Unrecognized
native dispatcher code, services, installed move modules or overlapping hooks stop
installation before move data is changed.
Signature checks and a successful export do not establish gameplay behavior
for every template, combination or ROM modification.

The active native handler table is discovered from its checked dispatcher, including
relocated or expanded tables with up to 4,096 rows. Move IDs and handler addresses
may be reassigned, reordered, added to vacant slots or disabled. Both the address
editor and recipe installer use this table, including pending address edits.
Setting either the move ID or address to zero clears both fields, disabling the row safely.
Duplicate move IDs, invalid IDs, out-of-bounds tables and nonzero pointers outside
the loaded battle overlay or ARM9 code are rejected by recipe validation. Native
operations reused by a recipe are identified independently by their checked code
and event lists; moving their assignments does not change the operation imported
by a template. Unedited moves continue through the ROM's native dispatcher.

Import an effect template into the draft, adjust its cards and conditions, then
apply it. Importing does not immediately change the ROM. Effects retain their
list order within each native timing boundary; arrow buttons reorder cards.
Activation conditions control effects. Use prerequisites make the move fail.
Empty condition groups mean always active.
New custom drafts start empty. Imports append effect cards and combine activation
conditions and use prerequisites with AND, preserving nested OR groups and
existing edits. Imports that exceed editor bounds or require a different
existing native operation leave the draft unchanged.

The move text panel's **In-game preview** loads the ROM's font and static Summary
panel on demand. It updates while typing, preserves explicit line breaks and
warns about text outside the three-line description box. Text is not automatically
wrapped. Preview resources are shared across descriptions in the same project.

Power, accuracy, PP, targeting, hit counts, flags, animation and AI behavior use
the existing move controls. Importing effects preserves these fields. For
example, Scale Shot's template supplies the stat changes after the sequence;
set its ordinary minimum/maximum hits to 2 and 5 separately. The AI behavior
selection remains a native AI profile; arbitrary recipes do not generate new
AI decision logic.

Expanded move data also has a separate **Expanded Flags** row for the supplemental
ability classifications. Changing these flags saves immediately and installs the
shared ability runtime and its code-injection dependency when needed. The Moves
sidebar's **Update Ability Runtime** button updates recognized older ability
runtimes while preserving their recipes. These controls are independent of the
move-effects DLL. Recipe power multipliers use the native base-power stage;
final damage multipliers use the separate native final-damage stage.

Applying a recipe saves and replaces the move's generic effect fields and
native handler assignment together. Those generic fields are edited through
the recipe while it is applied. **Restore native behavior** restores their
saved values and original dispatch, including after exporting and reopening
the ROM. Names and other ordinary data remain editable.

## Available effects and templates

Effects include conditional power and final damage multipliers, accuracy-roll
bypass, HP-based power, stat changes, stage inversion/reset, healing fractions,
condition infliction/cures, flinching, and native Reflect/Light Screen/Heal Bell
operations. Additional effects cover HP costs and recoil, damage drain, Berry
use, held-item checks and removal, PP reduction, hazards, trapping, type changes,
stat swapping and stealing, and ability suppression, copying or bypass. Psychic
Fangs and Hyperspace Hole include reviewed native effects for removing screens
and breaking protection. Other native aliases are not exposed until their generic
data and sequencing are supported together.

Other effects can heal allies instead of damaging them, override a matchup
against one defending type, use a different native weather damage modifier,
thaw hit targets without changing move type, ignore redirection, select an
attacking stat, resolve the user's type after type-changing effects, bypass
Substitute, or drain each recipient's damage.

Damage drain uses the game's native drain behavior and is always active when
the move deals damage. It does not accept activation or effect conditions;
use prerequisites can still make the move fail. Native drain interactions such
as Liquid Ooze and Big Root continue to apply.

Per-recipient damage drain can have conditions and uses native recovery
interactions, including Liquid Ooze and Big Root. It is limited to single-hit
moves and cannot be combined with effects that need the same sequence state;
the editor rejects incompatible combinations and hit counts.

The current template library contains Rototiller, Fell Stinger, Topsy-Turvy,
Flower Shield, Venom Drench, Magnetic Flux, Shore Up, First Impression, Darkest
Lariat, Sparkling Aria, Gear Up, Psychic Fangs, Glitzy Glow, Baddy Bad, Freezy
Frost, Sparkly Swirl, Bolt Beak, Fishious Rend, Decorate, Grav Apple, Scale Shot,
Coaching, Barb Barrage, Bleakwind Storm, Wildbolt Storm, Sandsear Storm, Take
Heart, Collision Course, Electro Drift, Hard Press, Upper Hand, Hyperspace Hole,
Thousand Waves, Spirit Shackle, Strength Sap, Anchor Shot, Burn Up, Speed Swap,
Purify, Core Enforcer, Spectral Thief, Sunsteel Strike, Moongeist Beam, Mind
Blown, Sappy Seed, Stuff Cheeks, Magic Powder, Teatime, Clangorous Soul, Life
Dew, Steel Beam, Poltergeist, Corrosive Gas, Jungle Healing, Eerie Spell, Dire
Claw, Stone Axe, Chloroblast, Ceaseless Edge, Lunar Blessing, Mortal Spin,
Doodle, Fillet Away, Tidy Up, Double Shock, Freeze-Dry, Pollen Puff, Revelation
Dance, Snipe Shot, Body Press, Overdrive, Torch Song, Scorching Sands, Matcha
Gotcha, Hydro Steam, Belch, Stomping Tantrum, Burning Jealousy, Lash Out, Last
Respects, Rage Fist, Gigaton Hammer, Blood Moon, Alluring Voice, Temper Flare,
Sticky Web, Ion Deluge, Electrify, Fairy Lock, Spotlight, Laser Focus, Throat
Chop, Plasma Fists, Jaw Lock, No Retreat, Octolock, Court Change, Glaive Rush,
Salt Cure, Syrup Bomb and Dragon Cheer.

Templates preserve their inspected numeric defaults without changing global
Generation 5 battle rules. Only implemented effects appear in the library.
The reference table lists primitives and the templates that use them.

History conditions can check Berry consumption, failed moves, hits received,
party faints, stat rises or falls this turn, and a move selected on the previous
turn. Event-count power adds an adjustable amount per hit or faint. Selection
restrictions can inspect only the user’s history; other conditions can be used
on the move’s remaining effects. Hit and Berry history belongs to the Pokémon
for the battle, including after switching; Transform copies the target’s hit
history. Per-turn flags and move selection reset at turn boundaries, and all
history resets at battle initialization.

Persistent effects can change incoming damage until the user next acts, apply
recurring HP damage or stat changes, redirect attacks, restrict moves or switching,
temporarily guarantee critical hits, raise critical-hit stages, and convert move types for the remainder
of a turn. Field-wide switch restrictions allow Ghost types and usable Shed Shells
to escape. Recurring effects have a shared limit of 48 active applications;
further applications do not take effect until space is available. A linked
stat effect ends when its source leaves; recurring effects end when their
recipient leaves. A duration of zero means until the effect is cleared by those
rules.

An entry stat hazard applies a configurable stat change when a grounded Pokémon
enters the chosen side. Rapid Spin clears it from the user's side, and native
Defog clears it from its target's side. Tidy Up can also clear it. Court Change
exchanges these hazards and the native screens, hazards, Tailwind, Lucky Chant,
Safeguard, Mist and Pledge side effects, preserving native layers and duration.
It does not exchange Wide Guard or Quick Guard and fails safely if unreviewed
custom side effects are present.

For a Sticky Web move, select the opposing side as its target in the ordinary
move controls. Enable “Reflected by Magic Coat” there if it should be reflected
by Magic Bounce. Only one entry stat hazard can be active on each side at a time.

Some operations need battle-message text. Applying a recipe reuses matching
entries or adds new entries without replacing existing text. Added entries are
retained if the recipe is removed.

## Dispatch and bounds

Recipes are keyed by actual ROM move IDs, not the source IDs used to label
import templates. Expanded moves can receive recipes at their actual IDs.
One `patches/MoveEffects.dll` stores all installed recipes. Its checked dispatch
delegates moves without recipes to native behavior. The module also supplies
narrow Sheer Force eligibility and flinch adapters; unrelated moves delegate to
their native implementations. It does not change loader limits, heap sizes,
Pokémon structures or the action scheduler.

Each move subscribes only to its required native events. The runtime checks
the owning battler and checks the move ID wherever the native frame provides
it. Accuracy and defense-stage frames use the selected native move item for
move identity. Accuracy bypass conditions can inspect the user, weather or
field; that native frame has no recipient. A move recipe
never subscribes to the weather-query event. Weather is queried at most once
per recipe callback, and grounded state at most once per recipient in that
callback. Short-circuited branches perform no queries. These snapshots expire
when the callback returns, so a subsequent action sees new weather or state.
All-recipient effects share one active-battler scan. Stat changes batch their
eligible recipients into native work records. No installed-catalog scan runs
on a battle event: move lookup uses a sorted binary index.

Each recipe allows 16 effects. Each condition tree allows 32 nodes, eight
children per group and three nested levels. Configuration is bounded to
65,535 bytes; code plus state to 48 KiB; and serialized module plus live code
and state to 96 KiB. Installation rejects oversized configurations. The
history runtime allocates 228 bytes of private battle state. The persistent
runtime allocates 1,468 bytes in total, including history state and the bounded
recurring-effect slots. Both use a field observer for only the required events;
neither observes weather queries.

Applying move recipes migrates a recognized older shared ability DLL through
the ability editor's verified runtime update in the same transaction. Existing
ability recipes, names and assignments are preserved. This prevents new move
weather checks from re-entering the older ability runtime's broad subscriptions.
Unknown shared ability DLLs must pass their owner's verification first.
Low-level module builders require that update before generating a move module.
When shared ability and item recipes both need the native move-parameter
service, their verified DLLs use a shared call path. Removing either restores
the remaining editor's standalone path. Conflicting or unrecognized modules
are rejected before changes are applied.

Effect timings must match the move's ordinary category. Type effectiveness
conditions use the final damage stage; they do not issue an extra effectiveness
query during power calculation or prerequisites. Calculation effects are
deterministic and do not accept an effect-chance roll.

## Runtime artifact

`python3 runtime/move-effects/build.py` rebuilds the bundled relocatable runtime
using ARM GNU tools and RPMTool. Set `ARM_TOOLCHAIN_BIN` and `RPM_TOOL_JAR` when
they are not in the workspace's configured tool directories. No ROM is needed
for this build. Add `--history` or `--persistent` to rebuild the corresponding runtime artifact.

`generate_bindings.ts CLEAN_WHITE2.nds SDK_IRDO.yml OUTPUT.json` generates the
BW2 native contracts from explicit local inputs. For BW1, generate the ability
bindings for the same clean game, then run `inspect_bw1_bindings.ts ROM.nds
REFERENCE_DIRECTORY INSPECTION.json ABILITY_BINDINGS.json` and
`generate_bw1_profile.ts INSPECTION.json ABILITY_BINDINGS.json OUTPUT.json`.
`verify_rom.ts ROM.nds
EXTERNAL_OUTPUT_DIRECTORY` exercises installation and export/reopen behavior
against an explicitly selected ROM. `test_runtime.py` executes the compiled
Thumb interpreter with counted native-service stubs; it does not substitute
for native gameplay testing.

For a disposable BW1 battle fixture, run `npx vite-node
runtime/move-effects/build_bw1_battle_cases.ts ROM.nds NEW_OUTPUT_DIRECTORY
TEMPLATE`, followed by `python3 runtime/move-effects/test_bw1_battle.py
NEW_OUTPUT_DIRECTORY` with the local melonDS bindings configured. The battle
oracle supports Freeze-Dry, Torch Song, Revelation Dance, Steel Beam, Eerie
Spell, Core Enforcer, Doodle and Speed Swap. Freeze-Dry also accepts `inactive`,
`neutral`, `capacity`, `weather` or `weather-baseline` as a fourth argument.
The `weather-doubles` and `weather-baseline-doubles` modes exercise the same
comparison with four active Pokémon. The weather, Core Enforcer and Doodle
fixtures use the Black ability editor.

Named custom tags can be created under **Expanded Flags → Manage flags** and assigned
to moves. Their filters are used by adjustable ability recipes; assigning a tag
alone does not change a move’s battle behavior. See the [ability runtime README](../ability-effects/README.md)
for storage, limits and runtime update behavior.

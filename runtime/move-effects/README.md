# Move effects

The Moves page has an **Effects** editor for recognized US revision-0 Black 2
and White 2 ROMs, including the reviewed vw2qol Fairy layout. Black/White 1 and
the full upgrade battle engine are not supported by this runtime. Unrecognized
native assignments, services, installed move modules or overlapping hooks stop
installation before move data is changed.

Import an effect template into the draft, adjust its cards and conditions, then
apply it. Importing does not immediately change the ROM. Effects retain their
list order within each native timing boundary; arrow buttons reorder cards.
Activation conditions control effects. Use prerequisites make the move fail.
Empty condition groups mean always active.

Power, accuracy, PP, targeting, hit counts, flags, animation and AI behavior use
the existing move controls. Importing effects preserves these fields. For
example, Scale Shot's template supplies the stat changes after the sequence;
set its ordinary minimum/maximum hits to 2 and 5 separately. The AI behavior
selection remains a native AI profile; arbitrary recipes do not generate new
AI decision logic.

Applying a recipe saves and replaces the move's generic effect fields and
native handler assignment together. Those generic fields are edited through
the recipe while it is applied. **Restore native behavior** restores their
saved values and original dispatch, including after exporting and reopening
the ROM. Names and other ordinary data remain editable.

## Available effects and templates

Effects include conditional power and final damage multipliers, accuracy-roll
bypass, HP-based power, stat changes, stage inversion/reset, healing fractions,
condition infliction/cures, flinching, and native Reflect/Light Screen/Heal Bell
operations. Brick Break is the available native base behavior. Other native
aliases are not exposed until their generic data and sequencing are supported
together.

The current template library contains Rototiller, Fell Stinger, Topsy-Turvy,
Flower Shield, Venom Drench, Magnetic Flux, Shore Up, First Impression, Darkest
Lariat, Sparkling Aria, Gear Up, Psychic Fangs, Glitzy Glow, Baddy Bad, Freezy
Frost, Sparkly Swirl, Bolt Beak, Fishious Rend, Decorate, Grav Apple, Scale Shot,
Coaching, Barb Barrage, Bleakwind Storm, Wildbolt Storm, Sandsear Storm, Take
Heart, Collision Course, Electro Drift, Hard Press and Upper Hand.

Templates preserve their inspected numeric defaults without changing global
Generation 5 battle rules. Only implemented effects appear in the library.
The reference table lists primitives and the templates that use them.

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
interpreter has no persistent battle-state allocation.

Applying move recipes migrates a recognized older shared ability DLL through
the ability editor's verified runtime update in the same transaction. Existing
ability recipes, names and assignments are preserved. This prevents new move
weather checks from re-entering the older ability runtime's broad subscriptions.
Unknown shared ability DLLs must pass their owner's verification first.
Low-level module builders require that update before generating a move module.

Effect timings must match the move's ordinary category. Type effectiveness
conditions use the final damage stage; they do not issue an extra effectiveness
query during power calculation or prerequisites. Calculation effects are
deterministic and do not accept an effect-chance roll.

## Runtime artifact

`python3 runtime/move-effects/build.py` rebuilds the bundled relocatable runtime
using ARM GNU tools and RPMTool. Set `ARM_TOOLCHAIN_BIN` and `RPM_TOOL_JAR` when
they are not in the workspace's configured tool directories. No ROM is needed
for this build.

`generate_bindings.ts CLEAN_WHITE2.nds SDK_IRDO.yml OUTPUT.json` generates the
native contracts from explicit local inputs. `verify_rom.ts ROM.nds
EXTERNAL_OUTPUT_DIRECTORY` exercises installation and export/reopen behavior
against an explicitly selected ROM. `test_runtime.py` executes the compiled
Thumb interpreter with counted native-service stubs; it does not substitute
for native gameplay testing.

# Writing automated move and ability tests

This reference is for humans and coding agents adding behavioral regression tests to Pokeweb. The runners execute real White2Upgrade battles in headless melonDS, select moves automatically, and check native damage against actual HP loss. They require no browser, menu navigation, or supervising agent. Implemented suites are Fluffy, the named singles move suites listed below, Coaching, and the ten additional doubles suites below; other illustrative examples are future designs, not existing coverage.

## Run the existing suite

From the Pokeweb Serverless repository root:

```sh
# Export one fixture ROM/save and collect eight attacks from two cold boots.
npm run battle:test -- --suite fluffy

# Also restore a ninth attack that intentionally disables the contact reduction.
# The suite must reject that broken result for this command to pass.
npm run battle:test -- --suite fluffy --verify-detector

# Select a different compatible upgrade ROM and optional save.
npm run battle:test -- --rom /path/game.nds --save /path/game.sav

# Fast assertion and deadline tests without an emulator.
npm run battle:test:unit

# Focused move suite; optionally require return to the next command menu.
npm run battle:test:move -- --move ruination --rom /path/game.nds --full-turn-smoke

# Install a fresh core only in the private test fixture, not the source ROM.
npm run battle:test:move -- --move ruination --rom /path/game.nds --core /path/White2Upgrade.dll

# New logic in child DLLs requires a rebuilt full ROM, not --core alone.
npm run battle:test:move -- --move barb-barrage --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move dire-claw --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move take-heart --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move clangorous-soul --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move fillet-away --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move aura-wheel --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move magic-powder --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move obstruct --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move silk-trap --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move burning-bulwark --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move hydro-steam --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move terrain-pulse --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move supercell-slam --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move grav-apple --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move fickle-beam --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move poltergeist --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move grassy-glide --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move bleakwind-storm --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move sandsear-storm --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move wildbolt-storm --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move rising-voltage --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move scale-shot --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move triple-axel --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move steel-beam --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move chloroblast --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move steel-roller --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move ceaseless-edge --rom /path/rebuilt-game.nds
npm run battle:test:move -- --move stone-axe --rom /path/rebuilt-game.nds
```

The default ROM is `../../White2Upgrade.nds`, relative to this repository, and the default save is the bundled `src/assets/testbattle/test.sav`. The headless build in the existing workspace is discovered automatically. Elsewhere, install Python 3, Pillow, the melonDS headless Python package and its matching shared library, then configure them:

```sh
export MELONDS_PYTHON_PATH=/path/emulator/python
export MELONDS_HEADLESS_LIB=/path/emulator/libmelonds_headless.so
npm ci
npm run battle:test -- --suite fluffy
```

Use the appropriate library extension for the host. Equivalent CLI options are `--melon-python` and `--melon-lib`. The MVP uses the shipped CPU-verified battle trigger; it does not rebuild native code or need the trigger's compiler/CPU-check dependencies. The emulator is an external prerequisite, not included in this repository.

Exit `0` means every required case passed. Exit `1` means a failed assertion, missing prerequisite, unsupported ROM, bad fixture hash, emulator failure, or timeout. Outputs are in a fresh `work/battle-interactions/` directory. An explicit `--out` must also name a new directory; nothing overwrites an existing run.

Generated artifacts stay out of Git. `work/` is ignored globally, and each new output directory receives its own `.gitignore` containing `*`, including standalone fixture-builder outputs. Custom `--out` paths inside the repository are therefore ignored too; no broad rule hides real source JSON, screenshots or test code.

```sh
# Retain the exported ROM only when planning to reuse the full fixture.
npm run battle:test -- --out work/fluffy-check --keep-fixtures
python3 -m json.tool work/fluffy-check/result.json

# Reuse the exact captured ROM build without exporting it again.
npm run battle:test -- --fixtures work/fluffy-check/fixtures

# Reverse the move order to check that restored cases remain independent.
npm run battle:test -- --fixtures work/fluffy-check/fixtures --reverse-cases --verify-detector

# Demonstrate a failure exit without waiting for a complete battle.
npm run battle:test -- --fixtures work/fluffy-check/fixtures --max-frames 1
```

Omit `--fixtures` after rebuilding a handler: reuse intentionally tests the old captured ROM, even if another `--rom` is supplied. Boot and each restored move case are bounded by 2,400 emulated frames, and each complete ability-variant batch has a hard 90-second process deadline by default. `--max-frames` and `--trial-timeout` override these limits. Inputs are read-only; the emulator receives temporary ROM/save copies. There is one full fixture export, using approximately the input ROM size on disk.

By default the runner deletes its newly exported `fixtures/battle.nds` when the test ends, whether it passes, fails during fixture building, or times out. It retains `battle.sav`, the fixture manifest, reports, screenshots and logs. Fresh runs prepare their save from the current test setup rather than silently reusing one from older tests. `--keep-fixtures` preserves the ROM as well so the complete fixture can be reused. A `--fixtures` directory supplied by the caller is read-only and is never cleaned. A ROM cleanup error makes the run fail and is recorded under `fixtureCleanup` in `result.json`. The standalone fixture builder intentionally retains its outputs; automatic ROM cleanup belongs to `battle:test`.

Automated interaction saves force Battle Scene Off in both redundant halves of the save and refresh the player-option and checksum-table checksums. The manifest records `battleAnimationsEnabled: false`, and the runner independently checks the option bytes. Older cached fixtures with animations enabled are rejected; regenerate them by omitting `--fixtures`. This does not alter the bundled source save or browser animation-testing behavior. Future behavior suites should also disable animations; visual tests need a separate, explicitly animation-enabled path.

## Doubles MVP: Coaching

Run from this repository with a freshly built full ROM:

```sh
npm run battle:test:move -- --move coaching --rom ../../White2Upgrade-gen89-batch32-20261004.nds
# A smaller smoke run: three restored cases from one doubles cold boot.
npm run battle:test:move -- --move coaching --rom ../../White2Upgrade-gen89-batch32-20261004.nds --variant normal
```

`coaching` authors trainer battle rule 1 and configures the bundled cold-boot
runtime with that same rule. The trainer has Snorlax and Blissey; the save has
Mew and Dragonite. Both save halves disable animations. A native battle-setup
probe independently checks the format and party counts, and ability-registration
probes capture four separate server battlers: player slots 0/1 and foe slots
12/13. Identifying only one battler per side is insufficient for doubles.

Each case restores one battle-start memory snapshot, applies explicit stat-stage
preconditions before input, and submits both player commands through the native
UI. Coaching retains its first-slot/highlighted-ally input path. The additional
doubles suites use the explicit move-slot/target driver described next.
Replacement battlers, triples and multi-trainer ownership still need dedicated
input paths and assertions, not writes to selected actions or calculated outcomes.

The oracle waits for the next turn's command menu and checks all four Pokémon's
identities, move histories, PP, HP, and stat stages. Only Dragonite may receive
Coaching's boosts. The cases cover normal/capped boosts, Simple, Contrary,
Protect, Substitute, Crafty Shield, Fly's semi-invulnerability, and a native
singles no-ally failure control. Dragonite uses each defensive move itself;
the test does not inject protection or semi-invulnerability flags. The W2
native hiding-flag table and accessor signature are checked before execution.
Coaching uses recipient-owned native stat-change work to pass Substitute's
second native stat check; no doll removal or direct stage mutation occurs.
NPCs use
Splash, so no AI move selection forcing is needed.

To add another doubles suite, extend the fixture definitions with `allyPlayer`,
set each variant's `battleType`, `allySpecies`/`allyAbilityId`, and
`defenderAllySpecies`/`defenderAllyAbilityId`, and add a move-specific oracle.
Explicit enemy abilities still come from temporary Personal-slot overrides.
The builder validates those overrides across both active enemies and variants.
General harness save preparation requires at least two living non-Egg Pokémon
for doubles (three for triples/rotation). Preserve the four-battler format
checks, snapshot isolation, deadlines and default cleanup. Output remains
ignored; fixture ROMs and snapshots are removed, fixture saves retained.

This is focused Coaching behavior coverage, not proof of every doubles move,
redirection, spread damage, multi-battle ownership, animation or battle teardown.

## What the Fluffy test proves

Each attack is run against identical level-50 Snorlax with either Run Away or Fluffy. Player-controlled level-50 Mew knows all four attacks. The AI's Snorlax selects Splash, neither side holds an item, and the fixture starts healthy. The builder checks the ROM's actual contact and Fire properties, rather than assuming that edited moves still match retail data.

| Attack | Control HP loss | Fluffy HP loss | Required behavior |
|---|---|---|---|
| Tackle | 42 | 21 | Non-Fire contact damage halves |
| Swift | 33 | 33 | Non-Fire non-contact damage is unchanged |
| Flamethrower | 32 | 64 | Non-contact Fire damage doubles |
| Fire Punch | 40 | 40 | Contact reduction and Fire weakness cancel |

These are measured results from the current MVP run, not hardcoded damage expectations. Future ROM balance edits may change absolute damage; the assertions derive expected HP loss from each paired control battle using native fixed-point rounding.

The test observes ability registration, matching paired stats, matching damage before the final modifier, the final damage ratio, calculated damage, and applied HP loss. Native battle RNG executes, then the runner controls returned battle draws to suppress critical hits, select the same 85% damage roll, and avoid secondary effects. Normal tests do not overwrite handler results, calculated damage, or HP. This is a controlled interaction test, not a test of random outcome frequencies.

The optional negative control neutralizes Fluffy's contact multiplier at its native service call. The measured loss returns to 42 HP and the unchanged oracle rejects it. The failed result is recorded under `disabled-contact-fluffy`, separately from normal trials. Merely proving that a battle boots would not provide this evidence.

## Where to change code

| File | Responsibility |
|---|---|
| [build-battle-interaction-fixtures.ts](../../scripts/build-battle-interaction-fixtures.ts) | Scenario definitions, executable signatures, ROM move-data checks, party/save preparation, fixture exports and hashes |
| [test-battle-interactions.py](../../scripts/test-battle-interactions.py) | Headless dependencies, isolated worker processes, native inputs/probes, outcome assertions, CLI and result reporting |
| [test_interactions.py](test_interactions.py) | Fast positive and negative tests of the assertion logic and process deadline |
| [build-move-handler-fixtures.ts](../../scripts/build-move-handler-fixtures.ts) | Focused move scenarios, metadata/signature checks and shared-ROM trainer variants |
| [test-move-handlers.py](../../scripts/test-move-handlers.py) | Completed-action move checks, snapshot restoration, optional next-turn smoke and cleanup |
| [test_move_handlers.py](test_move_handlers.py) | Positive/negative checks of move-outcome assertions and variant patches |
| [battleHarness.ts](../../src/pokeweb/battleHarness.ts) | Shared trainer/save patching, validation and bundled trigger configuration |
| [README.md](README.md) | Harness setup, supported scenario fields and verification scope |

`run_batch()` cold-boots an ability variant once and reuses its checkpoint; `execute_case()` observes one first hit; `compare()` is specifically the Fluffy damage oracle. `FLUFFY_CASES`, the fixture builder and the CLI suite choices enforce that four-case contract. The focused runner accepts the named suites in the commands above plus `bolt-beak`, `fishious-rend`, `hard-press`, `psyblade`, `collision-course`, and `electro-drift`, not arbitrary moves. Adding another mechanic means adding a named suite and distinct expectations, not weakening existing checks.

Ruination covers full/odd/even/1 current HP, boosted Defense, Protect, Wonder Guard, Substitute and a controlled accuracy miss. It requires native action completion, the correct previous move and exactly one PP consumed; HP loss is derived from current HP, not a fixed damage constant. Protect and Substitute are established by native opponent actions, not written into condition fields. Explicit HP/stat preconditions are applied only before selecting the attack. `--full-turn-smoke` additionally waits for the normal case's next command menu; neither checkpoint proves battle teardown. The pre-handler ROM failed this oracle (1 damage instead of 117), providing a real negative control.

Power suites read the native 36-byte move record and fail closed on category, type, power, accuracy and target mismatches. Flags are the 32-bit word at byte 32, after alignment padding; byte 11 is status duration, not status ID. Cases require native damage calculations, custom power rewrites where expected, non-critical damage, controlled RNG, and actual HP/Substitute changes. The pre-modifier observation is already after RNG, STAB, type effectiveness and burn/weather—not raw base damage. Current fixtures use neutral weather, healthy attackers and unboosted raw stats; future cases must extend the oracle explicitly for other modifiers.

Terrain Pulse checks resolved type independently from the custom base-power
rewrite, ordinary terrain power ratio, Mega Launcher and STAB. All four terrains,
Air Balloon/Levitate, Gravity, removal/replacement, Normalize/-ates, Protean,
Electrify and Ion Deluge use actual native setup actions. Grounding probes are
read-only; neither terrain/type results nor calculated damage are injected.
Its first implementation failed the Normalize case because ability callbacks
ran later; the final parameter phase corrects that ordering. Native/data-only
reuse does not need another per-move emulator suite under the current project
testing policy; new custom logic still does.

Triple Axel checks native 20/40/60 damage, accuracy miss boundaries, Skill Link,
Technician, Parental Bond, Substitute, per-contact Helmet/Rough Skin cost, early
KO, Disguise, Mold Breaker and Instruct. `accuracyDraws` controls native RNG
returns in order and fails if the engine requests an unexpected draw. The
native loop performs an unused final accuracy check after the third hit;
ordinary three-hit cases account for four draws, while Skill Link uses one.
Native action scratch must reset for the next turn and for Instruct. Disguise
checks both first-strike absorption and single/fixed-damage setup moves; repeated
damage estimates must not queue form/HP work. Substitute fixtures use an opponent
fast enough to create the doll before the attack; assertions reject a missing
doll rather than treating that battle as Substitute coverage. No Loaded Dice,
doubles, visual animation or teardown coverage is claimed by this suite.

Steel Beam and Chloroblast distinguish maximum-HP cost from damage-based recoil.
The oracle checks odd/even maxima, a low-current-HP boundary, target KO,
miss/protection/immunity policy, Substitute, Disguise, Rock Head, Magic Guard,
Reckless, native Gastro Acid suppression, and one cost for Parental Bond's
two strikes. A Magic Guard follow-up exercises repeated execution without
ending the battle. Native damage and HP cost have separate assertions; both
pre-handler ROMs fail the cost oracle. No expected result is written after
move selection. The low-HP precondition is deliberately nonterminal: a fatal
cost reaches normal whiteout, but the current runner cannot certify that case
through its action-complete checkpoint and would read freed battler storage.
Terminal tests need a verified pre-free exit capture, not an HP-zero shortcut
or a weakened completion assertion. No-target/owner/AI marker paths and scratch
reset are source/compiled-host checks, not claimed singles emulator coverage.

Barb Barrage distinguishes ordinary/bad poison from burn and sleep, tests its secondary chance boundary and Sheer Force, and rejects the old Hex alias as a negative control. Bolt Beak/Fishious Rend use real failed actions, native U-turn switching and Instruct; Fishious Rend also checks Strong Jaw. Hard Press derives power from target HP at damage execution, including a target's real earlier Substitute. Grav Apple checks Gravity, Clear Body and Sheer Force. Psyblade checks terrain setup/removal and two intact Air Balloons. The effectiveness suites check unchanged base power and a final 5461/4096 modifier only on super-effective hits; Electro Drift additionally checks added Grass triple resistance.

Fickle Beam enumerates all 100 controlled percentage draws, rather than claiming a stochastic frequency sample. Additional cases require a shared roll across Parental Bond hits, a fresh roll for Instruct, and no damage calculation through Protect. These cases preserve the project's existing Parental Bond behavior (second-hit power halving); they do not claim modern-generation Parental Bond parity or animation coverage.

Dire Claw enumerates all 100 controlled activation draws and observes the native
three-way status-choice RNG bound. It checks the applied ailment, activation
before selection, no selection after a failed roll, and no reroll when the
chosen status is immune. Native sleep-duration draws are counted separately
from selection. Additional cases cover existing poison, Serene Grace, Sheer
Force, Parental Bond, Shield Dust, Protect, Substitute, Safeguard and target KO.
The signature-validated event-dispatch probe limits RNG observations to the
per-hit handler window, excluding a newly paralyzed AI's later action check.
This is deterministic boundary/interaction coverage, not a stochastic frequency
sample. Statuses are produced by the handler and native condition work, never
written as the expected result; existing poison is established by Poison Powder.

Take Heart checks both Special-stat boosts, stage caps, Simple, Contrary,
repeat use, an intact user Substitute, status-only success and native Snatch.
Burn and poison come from held Orbs during a real setup turn; paralysis comes
from the opponent's Thunder Wave. The signature-validated, read-only native
event/work probes verify the actual executing owner and aggregated success or
failure. They exclude unrelated later status moves such as Splash. No expected
cure, stat result or work-result flag is written by the runner. Sleeping/frozen
users, doubles, rendered messages and battle teardown are not covered here.

Clangorous Soul and Fillet Away check direct maximum-HP payment separately
from stat boosts and subsequent opponent damage. Cases cover odd/even maxima,
exact-cost failure, cost-plus-one survival, all/partial caps, negative stages,
Simple, Contrary, Magic Guard, Rock Head, Sitrus, an intact user Substitute,
repeat actions and native Snatch. The actual executing battler pays, not
necessarily the original move selector. Soul follows the documented 33%-floor
integration policy; Fillet uses half maximum HP rounded down, both with minimum
one. Read-only native effect-return observations certify payment, boosts and
berry reaction before unrelated later attacks. Later Throat Chop damage is
independently checked using its native damage and PP records.

The sound-blocked Soul case uses a distinct **native-selection-rejected**
checkpoint, not a completed-action claim: it requires rejection, unchanged PP,
action history, HP and stages, and zero effect executions. The command client
has its own battler copy, so the observer matches native slot/species identity
rather than the server allocation's address. Fillet remains selectable after
Throat Chop. Missing work, fabricated selection success and conflated damage
are rejected by fast oracle tests. Both pre-handler ROMs fail the effect-work
oracle. Minimum-one payment across every native maximum-HP value is compiled
host coverage; rendered messages, Dancer, doubles and teardown are not covered.

Aura Wheel checks both authored Morpeko forms, non-Morpeko failure, native
Transform into either form and away from Morpeko, failed hits and type
overrides. Native Transform runs through the move menu; the runner never
writes transformed species, types, copied PP or the expected Speed result.
Species/form and resolved damage type are read independently. Active `surface`
move records, not original `truth` records, supply move IDs and PP: Transform
unlinks these records, and copied moves use 5 PP without spending original PP.
Signature checks validate the native layout before execution. The damage
oracle derives STAB from the expected resolved type rather than the record's
default type. Hunger Switch, actual Mimic/Imposter execution, rendered
messages, full teardown and doubles are outside this focused suite.

Magic Powder observes native uncategorized effect success and the executing
owner, including Magic Coat reflection. Type results are read, never written.
Forest's Curse, Trick-or-Treat, Gastro Acid, Embargo and Substitute are established
through normal move selection. Swift is blocked by added Ghost before replacement
and damages the target afterward, proving that the third type was removed.
A slow opposing U-turn user and a second U-turn battler switch the original
target away and back; its original typing must be restored. The native
work-result layout is signature-checked, as in Take Heart. This is focused
singles coverage, not Tera, rendered messages, doubles or teardown validation.

The damage-only shield suites require the native protection flag, completed
opponent action, correct protection/bypass events, unchanged protected HP,
and actual opponent stat/status results. They wait for the next command menu
because retaliation occurs after the user's action completes. Contact,
noncontact, Toxic, Feint, Hyper Drill, type immunity, Long Reach, usable and
Embargo-disabled Protective Pads, Helmet/Rough Skin, native stat prevention,
Contrary and burn immunity have distinct oracles. A real following Splash
turn must take damage and have no remaining shield callback. The immunity
control requires Hyper Drill to remain unable to damage a Ghost target;
overriding all immunity cannot pass. No result, protection flag, HP or status
is written as the expected outcome. These are singles guard-integration
checks, not new tests of every native effect or modern Protect success odds.
Mirror Armor, Unseen Fist, switching/fainting/doubles, full teardown and
rendered animations are not covered by these focused suites.

Poltergeist checks held-item eligibility, including native Knock Off, Embargo,
Magic Room, berry consumption, Weakness Policy and Red Card. Repeat actions
distinguish cached eligibility within Parental Bond from a fresh Instruct
execution. Signature-validated message-service probes check one announcement
per successful action, target/item arguments and ordering before damage/item
reactions; they do not verify rendered text or animation. Magic Room and Embargo
cases also require their native setup effect to be active. Red Card requires
the actual incoming player battler rather than treating the original pointer
as the current attacker after a switch.

Grassy Glide uses a deliberately slower attacker and observes the target's
native action-complete flag at damage calculation. It covers no terrain,
Grassy Terrain, removal, Psychic Terrain, an intact Air Balloon, Gravity,
Queenly Majesty and Dazzling. A damage boost alone cannot pass the priority
case. These cases set up terrain before the tested turn; they do not claim
same-turn terrain changes re-sort actions.

The three storm suites check native 80% accuracy boundaries in clear weather
and sun, rain skipping the ordinary accuracy/evasion roll, Cloud Nine
suppression, and continued protection/semi-invulnerability. Signature-validated
probes record the native effective weather, accuracy threshold and RNG return;
accuracy draws are controlled independently of secondary-effect draws. Rain
and sun are established with native moves. The Fly case tests the third turn:
Rain Dance during the first charge, Protect during landing, then the storm
against the next charge. Merely starting the turn with Fly's flag set would
not prove that the target remained airborne when hit. Protect uses an entry
Drizzle ability so an earlier use cannot introduce consecutive-Protect odds.

Hydro Steam observes both real effective weather and the value used at the
native damage-weather multiplier. Its oracle rounds weather before random
damage and STAB, rather than faking increased base power or a final modifier.
Cases cover clear/sun/rain, different defense rounding, Cloud Nine, Air Lock,
Drought, Normalize's non-Water type and Protean/STAB. Utility Umbrella is not
an implemented game item and is not claimed as covered.

Supercell Slam uses real native Minimize before its action. The suite requires
the target's Minimize flag, doubled calculated/applied damage, and zero ordinary
accuracy draws, including lowered user accuracy. An unminimized control still
performs its normal 95% check. Native crash, immunity, protection and absent-target
behavior are reused/source-checked, not separately tested by this small suite.
Target-dependent checks use event `0x1C`; event `0x32` has no target ID.
These are singles accuracy tests, not spread-target, secondary-effect,
visual or doubles coverage. Springtide Storm has no rain guarantee and is
intentionally excluded from the shared effect.

Rising Voltage checks target grounding independently of the user's ordinary
terrain bonus. Air Balloon, Levitate and Gravity cases record signature-validated
native floating returns during damage execution, along with actual held items.
Terrain removal/replacement, protection, Ground immunity and Substitute are
native setup/outcome checks, not injected damage or condition results.

Scale Shot checks four controlled native hit-count draws (2–5 strikes), one PP
per action, unchanged user stages at every strike, and exactly one final Speed
increase/Defense decrease. Cases cover caps/floors, early KO, Skill Link,
Simple, Contrary, Sheer Force, protection, a native accuracy miss, immunity and
a Substitute breaking between strikes. The damage oracle tracks HP and
Substitute separately per strike: excess damage at the break cannot spill
into HP, while subsequent strikes can hit HP normally. This is not a stochastic
hit-count frequency test or Loaded Dice coverage. Valid initial user stages
may be set as explicit pre-input fixture conditions; outcome stages are never
written by the test.

Steel Roller checks all four native terrain setups, replacement, Defog removal,
airborne users, target KO, Substitute, protection, miss and immunity. Follow-up
actions require either an unboosted Psyblade or a failed second Steel Roller,
not just a removal announcement. A `followup` fixture selects its own move slot,
validates that slot's PP and retains separate before/after and damage records.
Terrain end-message construction is observed, not its rendered text or graphics.

Ceaseless Edge and Stone Axe observe the native side handler, permanent condition
and layer count on both sides. The builder signature-checks the US side-count
accessors, count-write sites and three-Spikes/one-rock table limits before using
the read-only layout. Native Spikes/Stealth Rock moves establish existing layers;
the tests never write hazard counts. Cases distinguish a damage-only placeholder,
layer caps, Substitute, Sheer Force, Parental Bond, Instruct, blocked attempts,
Shield Dust and contact-punishment KO. They test new placement logic, not native
entry-damage formulas or doubles. Explicit user HP is a pre-input fixture
condition; no HP, handler or count result is overwritten after the move starts.

The focused move runner defaults to a 300-second process deadline per variant
batch, allowing the 100-draw Fickle Beam batch to finish. `--trial-timeout`
overrides that deadline; each boot/restored case still has its independent
2,400-frame bound. The Fluffy runner's 90-second batch limit is unchanged.
An engine build should also verify resolved hook owners and freshly packaged
RPMs: a missing damage-root hook can silently turn a Parental Bond test into a
single-hit test, and some RPMTool parser errors exit successfully.

For a focused debug run, select existing variants explicitly:

```sh
npm run battle:test:move -- --move fickle-beam --rom /path/to/updated.nds \
  --variant parental-bond --variant instruct --variant protect
```

Omit `--variant` for the complete suite. A filtered report records
`completeSuite: false` and its selected variants; its passing result is not
full-suite coverage. Unknown or duplicate variant names fail closed.

For repeated actions, retain the observed completion flag before end-of-turn reset, validate final PP expenditure, and observe previously applied damage at the next calculation. Two Parental Bond hits spend one PP; two Instruct executions spend two. Do not diagnose every ARM9 BIOS address as a crash: normal IRQ/SWI/DMA code can execute there. The runner checks abort/undefined CPU modes and still enforces bounded frames/process deadlines.

Both runners retain fixture saves and reports but delete generated fixture ROMs by default. Snapshots stay in memory and are released in `finally`. The focused runner reuses the same validated headless setup, save-option checks and temporary-worker cleanup as the ability runner. For the current Gen 8/9 implementation batch, the requested policy is to skip per-move emulator tests for reused/data-only effects and label them wired, not battle-tested; reserve new suites for genuinely new logic.

### Source-linked effects and forced move use

Additional suites include No Retreat, Jaw Lock, Octolock, Snap Trap, Thunder Cage,
Salt Cure, Syrup Bomb, Stuff Cheeks, Corrosive Gas, Glaive Rush, Blood Moon and
Gigaton Hammer. Run a complete suite or one explicit variant:

```sh
npm run battle:test:move -- --move octolock --rom ../../White2Upgrade-gen89-batch29-20261004.nds
npm run battle:test:move -- --move syrup-bomb --rom ../../White2Upgrade-gen89-batch29-20261004.nds --variant source-exit
npm run battle:test:move -- --move blood-moon --rom ../../White2Upgrade-gen89-batch29-20261004.nds --variant choice --variant encore
```

Choose the actual current ROM filename; these examples do not silently update
the default ROM. Each run regenerates its fixtures unless `--fixtures` is used.

For source-linked effects, author a real bench Pokémon and let native Roar
remove the source. Octolock/Syrup Bomb must stop; Salt Cure must persist. Capture
native action-end before departure resets the old battler's history/flags.
Observe the replacement's actual registration before changing the current
pointer; its PP must not be compared against the departed Pokémon's PP. Verify
the native trap continuation's source ID and its release as well as residuals.

Selection-only restrictions need both rejected-menu and called-move tests.
Blood Moon/Gigaton Hammer distinguish the selected move from the executed
payload: Sleep Talk spends its own PP, Instruct repeats the payload, faster
Encore can rewrite an already-selected action, and a locked or single-move
user must execute native Struggle without spending the restricted move's PP.
Use `expectedExecutedMove` and `expectedPpSpent` for forced follow-up actions;
the oracle still requires native completion/history and actual damage. Give
the target enough HP to survive the entire sequence so a KO does not masquerade
as a missing command menu. Glaive Rush additionally tests NPC slot ownership
and expiry on a native Truant loafing action.

Stuff Cheeks checks real berry effects/consumption, Recycle, Belch and single
Cheek Pouch activation. Corrosive Gas must destroy without setting consumed-item
history, and cannot allow native Recycle to restore that item. These suites
are singles handler tests, not animation, doubles, teardown or whole-game
regression coverage. Positive/negative oracle tests live in `test_move_handlers.py`.

## Snapshot batches and temporary enemy abilities

One `battle.nds` and `battle.sav` serve all four moves. Snorlax's Personal row is temporarily given Run Away in slot 1 and Fluffy in slot 2. The base trainer selects slot 1; the Fluffy worker validates and changes only the slot-selector byte in its private ROM copy. This happens before native party generation and ability registration, not by changing a live BattleMon ability. The fixture manifest describes both variants and the exact byte patch. This avoids duplicate full ROM exports.

Across a shared-ROM move suite, each `(species, ability slot)` must describe
one ability. The builder rejects conflicting edits: use the other slot or
another defender species for a third ability variant. Repeated trainer edits
must not silently overwrite an earlier variant's Personal row.

Each variant worker cold-boots to the first command menu and captures `save_snapshot()` in memory. `restore_checkpoint()` calls `restore_snapshot()` before every case, releases keypad/touch input, and resets the host observer's pending damage, errors, RNG draws/returns and injected-fault count. It requires the same emulated frame count and byte-for-byte restored battler data before an attack can run. Hooks remain registered but their per-case state is reset. The optional negative control runs after the four ordinary moves from the same checkpoint.

The checkpoint is kept only for the batch and released in `finally` on success or failure. No `.dst`, `.mln` or other savestate files are written. The parent owns the temporary ROM/save directory so killing a hung worker still cleans the files. The top-level runner separately owns and deletes its generated fixture ROM, but keeps the fixture save and metadata; never delete caller-supplied inputs or determine deletion targets from an untrusted manifest. Preserve this ownership model when adding tests; do not create persistent snapshots that accumulate between runs. Cold-boot and teardown tests should remain separate because restoring a mid-battle state does not exercise those lifecycle transitions again.

Custom move DLLs load during move registration, not first use. Putting several custom moves on one Pokémon can therefore load all their groups before the checkpoint, even for unused moves. Batch tests verify behavior with that loaded set; they do not prove that only the chosen move's module loaded. Keep dedicated no-custom, module-loading and heap-budget fixtures separate. The Fluffy batch uses four vanilla moves.

For a custom enemy ability in a harness scenario, supply its ID and the Personal slot to author:

```json
{
  "trainerId": 1,
  "battleType": "Singles",
  "trainer": {
    "ai": 0,
    "team": [{ "speciesId": 143, "level": 50, "abilityId": 218,
               "abilitySlot": 2, "moves": [150] }]
  },
  "player": {
    "team": [{ "speciesId": 151, "level": 50, "abilityId": 28,
               "moves": [33, 129, 53, 7] }]
  }
}
```

This uses the standard harness configuration schema. The interaction builder constructs its shared two-slot fixture with the same helpers; it does not yet accept arbitrary scenario JSON on `battle:test`. Both player and trainer IDs currently accept 1–255. Changing Personal is a ROM-wide species/form/slot change inside the fixture, not a per-individual ability edit; use distinct slots or species when necessary. Cached fixture format 1 is incompatible with batching; regenerate without `--fixtures`.

## Define a test before implementing it

Write down the setup, automated action, observed result, and an outcome that must fail the test. Keep one causal difference between paired battles where possible.

For a damage ability, specify move type, contact/category flags, relevant HP thresholds, held items, weather, terrain, stats, ability state, and expected multiplier. Start with inert control abilities and no items. Add interacting mechanics in separate named cases. Do not compare unrelated Pokémon or damage from different random rolls.

For a move, specify when the effect occurs relative to damage, which battlers it affects, its duration, and exceptions. A move can deal correct damage while its secondary effect is broken; both need assertions. For example:

| Future test | Positive case | Negative case | Native outcome to assert |
|---|---|---|---|
| Multiscale | Hit a full-HP defender | Hit the same defender below full HP | Final ratio and applied HP loss |
| Baneful Bunker | Protect against contact damage | Protect against non-contact damage | Protected HP stays unchanged; only the contact attacker becomes poisoned |
| Prismatic Laser | Attack, then attempt another attack | Equivalent attack without recharge | First damage occurs; the recharge turn performs no attack and clears the recharge condition afterward |
| Spectral Thief | Hit a target with positive stat stages | Hit a target with no positive stages | Target boosts disappear and user stages change before damage; damage still occurs in both cases |

Those cases require new fixture definitions and, for multi-turn/status tests, new native readers or an action sequence. They are not enabled by changing `--suite` today.

## Add a new damage suite

1. Add explicit scenarios in the fixture builder, including stable case IDs and expected behavior. Validate the ROM's relevant move properties and ability IDs. Select compatible species and inert control abilities; ensure damage cannot faint the target and hide the true amount.
2. Reuse `patchHarnessTrainer()` and `patchHarnessSave()` to construct valid parties. Player `abilityId` overrides allow a defensive ability to be placed on a suitable high-HP target without changing species. The current save helper accepts ability IDs 1–255. Explicit trainer `abilityId` values now author the selected Personal species/form/slot in the temporary project, and `abilitySlot` selects it through native trainer generation. Keep these explicitly dirty Personal rows in the export. Use different slots for different IDs on the same species/form; conflicting IDs for one slot are rejected, and the shared Personal edit can affect other matching Pokémon in the fixture.
3. Generate a manifest with input and fixture hashes, scenario data, and the bundled trigger verification receipt. Preserve the original input ROM and save. Keep outputs under ignored local directories, not shipped assets.
4. Add the named suite to the Python CLI and validate its manifest contract. Keep the existing Fluffy suite unchanged. Generalize species/side selection explicitly for another setup; Fluffy requires player Mew attacking AI Snorlax, while the move runner validates each declared defender species/ability and tracks native incoming battlers.
5. Add a mechanic-specific oracle. Verify registration and relevant live battle state, compare control conditions, then assert native calculation and actual HP changes. Use integer fixed-point rounding, not approximate float equality.
6. Add unit tests that intentionally supply wrong multipliers, wrong HP losses, mismatched conditions and incomplete observations. A broken or missing handler must fail.
7. Run the suite twice from cold boots. Add an optional, separately labeled real-emulator fault injection if feasible. Verify both a normal pass and failure exit/report behavior, then document actual coverage and exceptions still untested.

For example, a future full-HP damage case could use the same declarative shape as Fluffy:

```ts
// Illustrative scenario shape, not a currently registered suite.
{ id: "full-hp-contact", moveId: 33, name: "Tackle",
  contact: true, fire: false, ratio: 2048 }
```

Its suite must also prepare the correct ability and HP state. To test Multiscale below full HP, change only current HP in both members of that pair and require `ratio: 4096`. Copying the contact rule alone would incorrectly test Fluffy again.

For an existing power-suite extension, the current case fields look like this:

```ts
// Actual Grav Apple case shape: use the fixture's Gravity slot on a prior turn.
{ id: "gravity-boost", setupSlot: 1,
  expectedPowers: [120], expectedDefenseStage: 5 }

// Actual Psyblade shape: Electric Terrain then Defog, both native actions.
{ id: "terrain-removed", setupSlots: [1, 2], expectedPowers: [80] }
```

`expectedPowers` describes the mechanic's power; `effectivePowers` can separately declare reviewed ability adjustments. `typeRatio` models the fixture's actual matchup, and `damageRatios` asserts final modifiers and fixed-point rounding. `powerRolls` checks draws per calculation. A new HP/stat/weather family must supply a suitable oracle, not simply reuse these fields with guessed constants. Keep failure-focused unit tests alongside every oracle extension.

## Additional doubles suites and fixtures

Implemented suites: `decorate`, `expanding-force`, `snipe-shot`, `jungle-healing`,
`life-dew`, `lunar-blessing`, `dragon-cheer`, `make-it-rain`, `matcha-gotcha`, and
`mortal-spin`. They use a typed, data-only registry in
`scripts/move-handler-doubles-fixtures.ts`; the main builder handles ROM/save
construction and the runner handles native observations and assertions.

```sh
npm run battle:test:move -- --move make-it-rain --rom ../../White2Upgrade-gen89-batch37-20261004.nds
npm run battle:test:move -- --move snipe-shot --rom ../../White2Upgrade-gen89-batch37-20261004.nds --variant follow-me
npm run battle:test:move -- --move dragon-cheer --rom ../../White2Upgrade-gen89-batch37-20261004.nds --variant psych-up --variant transform
```

Author both parties with at least two usable Pokémon and set both trainer data
and the boot runtime to Doubles. Cases name four roles: `attacker`, `ally`,
`defender`, `defenderAlly` (native slots 0, 1, 12, 13). `moveSlot` and
`allyMoveSlot` select each player's move; `targetRole` and `allyTargetRole`
select legal native targets. The signature-pinned UI driver distinguishes
action, move and target phases; it never writes selected battle commands.
The foe target cells are reversed relative to party order, so do not infer
screen coordinates from a slot number.

For example, a Decorate case can specify:

```ts
{ id: "boost-ally", targetRole: "ally", completeTurn: true,
  expectedStages: { ally: [8,6,8,6,6,6,6] } }
```

Use `setupCommands: [{ slot: 0, case: { id: "setup", allyMoveSlot: 1 } }]`
for native setup turns with explicit partner commands. `followup` adds an
observed later action and its own checks; Dragon Cheer copies are followed by
real attacks with their native critical ranks observed. Healing tests establish
ally Heal Block by protecting the user against a slow foe's spread Heal Block,
then healing before that foe can act again. Do not aim Gen 5 Heal Block at an
ally: its native move targets opponents.

HP and stat stages are bounded pre-input fixtures. `statuses` can establish
specified major statuses before input where trainer data cannot encode them;
require `expectedStatusesBefore` as well as the expected post-move status.
Player save `status` uses BW2 IDs 0–5, not old bit masks: healthy, paralysis,
sleep, freeze, burn, poison. Sleep duration/Toxic escalation require native
battle setup. A cure or thaw on a healthy fixture must fail its precondition.
Protect/Substitute/Fly, hazards, traps and Heal Block are established with actual
moves, not fabricated outcome flags.

The doubles oracle verifies the next command menu and all four identities,
commands and unchanged/expected stages. Damaging cases declare exact
`expectedTargets`, power, spread and matchup ratios. An independent integer
oracle includes native fixed-point rounding and terrain power. Matcha Gotcha
drains actual clipped HP/Substitute damage and checks Ooze-before-healing order;
Make It Rain observes the native bonus pool, not a synthetic money counter.
Transform tests distinguish original ability/species from the copied surface.
New oracle rules need positive and deliberately wrong-result unit tests in
`runtime/battle-harness/test_move_handlers.py`.

Current limitations: no triples/multi-trainer tests, complete prize payout,
switch/teardown stress, native drain-KO/contact-KO cases or full B2 behavioral
coverage. These are focused behavior tests, not animation acceptance. Outputs
remain ignored, fixture ROMs/snapshots are cleaned, and saves are retained.

## Add multi-turn and status assertions

Replace the first-hit stop condition with a bounded action sequence. Reach a specific native phase before sending each command. The MVP uses one native Fight pulse followed by the requested move's touch cell and verifies the actual executed move ID; repeated A presses would accidentally select the first move. Observe the effect at its correct phase, then wait for the next relevant action or turn. Do not rely on a fixed frame number from one run.

Derive status, stat-stage and condition readers from the supported engine ABI before using them. Add executable/data-layout checks where applicable, and record before/after values in trial JSON. The current `read_mon()` exposes HP, stats, types and ability but does not read all statuses, stat stages or volatile conditions. Screenshots and battle messages help diagnose a result; they do not replace these assertions.

For recharge, test a real subsequent turn instead of passing as soon as the first attack deals damage. For protection, a timeout waiting for HP loss is not a pass: positively observe that the protected attack resolved, HP stayed unchanged, and the appropriate contact consequence occurred. For stolen boosts, verify their transfer before damage calculation rather than only after the turn.

## Probe and failure rules for agents

- Run the real engine and its installed DLLs. Do not import child handler symbols or hardcode their relocated addresses. Observe stable native service calls and resulting live state.
- Retain exact executable signature checks. If a core hook changes a probe site, inspect the new instructions and ABI, relocate the probe deliberately, and rerun negative controls. Do not remove a failing check to obtain a green run.
- The headless API's ordinary memory reads do not expose the ARM9 private stack reliably for this runner. Use validated instruction sites where the engine has loaded arguments/results into registers, as the damage probes do, or implement a verified DTCM-aware reader.
- Every pass needs a complete observed outcome. Unsupported layouts, missing observations, crashes and timeouts are failures, never skips or implicit successes.
- Keep fault injection opt-in and separate from normal trials. Control only necessary randomness; do not force the effect being tested to succeed.
- Preserve user saves and unrelated work. Do not reload a previous emulator state as evidence for a newly built ROM; it may contain old code and pointers.
- Record assumptions and limitations. These tests currently cover compatible US White 2 revision 0 upgrades, not Black 2 or White 1. Fluffy suppression, Protective Pads, switching and multi-battles still need their own cases. Emulator passes do not establish visual/audio acceptance or hardware compatibility.

## Review a failed run

Start with `result.json`, then the failing trial's `.json`, `.log` and `.png` under `trials/`. Trial JSON records live abilities/stats, native RNG draws, calculation frames, damage ratio, calculated damage and HP loss. Each variant's `*-batch.input.json` records the fixture and options, `*-batch.log` captures native logging, and `*-batch.json` records all trials, checkpoint metadata and cleanup status. A process deadline may leave only the input/log; the top-level report still fails.

Distinguish setup failures from mechanic failures. A wrong registered ability or mismatched stats indicates an invalid fixture; correct registration with a wrong native ratio or wrong secondary state indicates a behavior failure. Diagnose first, then fix the appropriate fixture, probe or handler. Never update expected results simply to match a broken implementation.

Before handing off a new test, run the new suite, its negative checks, `npm run battle:test:unit`, and the existing battle harness tests. Type-check new fixture scripts explicitly because the normal project TypeScript configuration includes `src/`, not `scripts/`. Link the human reference from the harness README and keep CLI documentation synchronized with the actual supported options.

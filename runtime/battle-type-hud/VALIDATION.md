# Battle Type HUD — current validation

Pokeweb bundle **0.4.24** provides lettered Type Icons 0.3.18, Circular Icons 0.3.18-circular, Angular HUD Wedges 0.3.24-solid, and independent Move Effectiveness Preview 0.4.1 for English Black 2 and White 2. Each installer keeps its own hooks. Selecting or switching an icon style retains one active icon module and one hook set; importing, reinstalling, and staged removal were covered by Pokeweb model/export checks. Unknown overlapping hooks and native resource changes are rejected.

The current angular-wedge compiled ARM checks covered all 18 mono/dual fill pairs, player and enemy panel slots, status labels, typing changes, palette fading, unchanged-frame write suppression, native caught-marker preservation, HP-bar palette entries 5–12, and teardown in B2 and W2. The module is 7,648 bytes with about 7,904 retained PMC bytes, 364 bytes of fixed state, and no added battle-heap allocation, sprite, palette bank, or graphics VRAM allocation. Those numbers describe the module and measured fixtures, not total battle memory.

`reports/dsi-verification.json` records DS/DSi pointer boundaries using each
game's native mode getter, ABI preservation, and all three icon styles with
gauge, battler, cell and palette objects exclusively in extended RAM. The
move-preview pointer helper passes the same boundary checks.
`reports/dsi-captured-state-verification.json` matches the old installed code in
a supplied White 2 DSi capture, reproduces its pointer failure, and compares
both corrected wedge panels against captured native graphics. Native readers
execute; gauge creation, update and release use no-op fixtures. No game frames
or hardware sessions were executed.

The preview colors damaging move names for effective/resisted matchups using current battle typing; status moves retain normal color. Immunity uses the configurable red highlight. The client-state evaluator includes the ability, item, suppression and grounding cases listed in the README. Weather Ball, Natural Gift, Judgment, Techno Blast and unsupported custom mechanics retain neutral fallback. BW1 has independently pinned bindings and the separate DS acceptance recorded below.

## BW1 DS release — 2026-10-08

US Black (`IRBO`) and White (`IRAO`) revision 0 have separate Type Icons
bindings, overlay-94 hooks, reversible resource expansion and compiled DLLs
for letters, circles and angular wedges. Both games are enabled for the exact
native profiles and DLLs in the DS acceptance ledger.
The candidate uses 796 bytes of fixed state, up to six private palette banks,
two additional OAM pieces per panel and at most 1,536 added character VRAM
bytes across six panels. It adds no actors or separate battle-heap allocation;
the native expanded cell resources grow by 16 bytes per panel. Build memory
reports distinguish this from BW2's smaller state and different palette policy.

Compiled candidate checks pass all three styles in both games, in DS and
extended-memory fixtures. Retail palette reservation/free, mode/fade/proxy/palette getters, current typing,
Roost, visible-source selection and PK5 type dispatch execute. Native gauge
creation, update and release are instrumented; personal archive access is
stubbed after checking species/form/type-field arguments; physical palette DMA
is modeled. Uninitialized unused palette banks are included. Four layouts, six
panels, type changes, status, fades, teardown, missing expansion and palette
conflicts are covered. Native pixel, cell and palette preservation and ABI
checks pass. These checks do not establish live DSi acceptance or DS gameplay.

Pokeweb installer tests cover both BW1 games, all styles, PMC installation,
switching/reinstall, export/reopen, original FAT replacement, staged resource
restoration, release gates, changed hooks/resources, duplicate/foreign DLLs and
rollback after a failed PMC operation. Separately named validation exports
use a process-local acceptance override; shipped flags are unchanged.

Move Preview candidates have five overlay-94 hooks and 28 bytes of fixed
state, including a BW1 rotation move snapshot. `reports/bw1-move-verification.json`
records both games in DS and extended-RAM fixtures. Retail type affinity,
effective types, ability/suppression, conditions, held-item and field readers
execute; drawing, view mapping, move-cache queries and Hidden Power inputs
use stand-ins. The fixture covers grounding, item suppression, immunities,
excluded moves, target-card changes, stack arguments, custom colors, fades
and cleanup. These checks do not establish live DSi acceptance.

The focused HUD installer suite passes 72 tests, including independent BW1
Move Preview installation, custom-color export/reopen/reinstall, both orders
of installation with each icon style, staged removal, acceptance gates and
rollback. A BW2 rebuild after the shared layout refactor produces byte-identical
DLLs; its compiled move-preview regression suite passes.

Scoped DS sessions on 2026-10-08 cold-booted separately named Black and White
exports. Black singles showed Psychic immunity against Purrloin. White
rotation showed Ice Beam's effective highlight and Thunderbolt's resisted
highlight against Simisage, with native PP unchanged. Captured bitmap glyphs
and rendered RGB colors agree. White's combined angular-icon build showed all
six panels and native rotation controls changed the selected move list. Black's
combined circular-icon build displayed six triple panels and reached native
target selection. These are scoped observations, not completed acceptance.
Current normal-installer all-five-patch exports also cold-boot all 24
game/style/format combinations: both games, three icon styles and native
single/double/triple/rotation battles. Reviewed captures show the panels,
names and HP displays intact, native move lists and double/triple target
selection. Psychic immunity colors the double target label. Native
rotation controls remain available. The test NPC uses the retail field-script
battle command, avoiding its incompatible trainer-eye prelude for doubles.
These scoped captures do not certify complete battles, all target transitions,
mechanic exceptions or sustained resource cleanup.

A further 24 combined DS sessions complete native single, double, triple and
rotation trainer battles in both games with each icon style and return to the
field. All party checksums are valid; one battle-entered count and the expected
total KOs agree with each native trainer's party size. These completion fixtures
already know the configured KO move and disable the test-only KO evolution so
that the battle-control checks can finish without those prompts. Separate
combined sessions cover KO learning and evolution. Twelve additional sessions
exercise custom colors after normal reinstall/export/reopen: cyan effective
and magenta resisted move names in rotation, and a blue Psychic-immunity target
label in triples. Reviewed captures and counted font pixels agree for every
style and both games.

The `0.1.3-bw1` icon candidates correct a BW2-only status-byte assumption by
reading BW1's verified native battler condition getter. Compiled fixtures now
use native condition words, including pre-existing status before gauge creation
and an irrelevant nonzero byte at the old BW2 offset. All twelve DS/extended-RAM
checks pass. Fresh normal-installer exports also repeat all 24 complete native
trainer battles with these rebuilt DLLs; party checksums and trainer-only
counters agree with the validation parties in each ROM.

Six further combined sessions cover native PSN/BRN labels, HP displays and Heat
Rotom switching, followed by eight wild-battle/field cycles per game and icon
style. All party checksums remain valid; native statuses, forms and moves and
the existing trainer-only counters are retained. HUD gauge references clear
after every field return; module addresses and private palette banks remain
stable. These are eight-cycle observations, not a general heap-capacity bound.
Another six sessions exercise native Illusion disguise and damage reveal, Soak
changing the opponent's current type, move-preview refresh, and Roost's
temporary removal and restoration of Flying. Reviewed captures and live HUD
records agree for every style and both games; PP and party checksums are valid,
unused party members remain unchanged, and teardown clears the records.

Twelve further double/triple sessions cover enemy → ally → enemy selection,
cancel/reopen, Surf spread-target selection and native confirmation across
both games and all styles. Immune enemy headings use red; ally/spread headings
restore neutral white. All live HUD records are healthy; every party byte and
checksum remains unchanged during selections. Confirmation reaches the next
native FIGHT screen. Same-session combined menu/battle/menu transitions also
reopen Learnset and Summary without altering Pokémon during menu browsing.

Both components are available through the normal BW1 installer for the tested
builds. Bundlers preserve acceptance only when exact native profile and DLL
hashes match the [release record](../BW1_UI_RELEASE.md). Live DSi gameplay remains pending separately.

During the 2026-09-24 repository cleanup, native W2/B2 profiles were regenerated from the clean ROMs, the HUD build passed, and the compiled angular-wedge and move-preview verifiers passed. Shipped assets were unchanged; no game emulator was run.

The current BW2 angular build has **no recorded game boot or emulator-frame acceptance**. Earlier releases had scoped White 2 battle evidence, but that does not certify this version or Black 2. Human checks still need real single/double/triple battles, switching, status and disguise transitions, fades, target cards, long names, move-effect exceptions, coexistence with other patches, and long-session heap/VRAM behavior. Compiled fixtures and installer tests do not replace those sessions. See [README.md](README.md) for implementation and build details; historical validation remains in Git history.

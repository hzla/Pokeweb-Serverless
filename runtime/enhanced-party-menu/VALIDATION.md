# BW1 verification status

Both games pass the isolated compiled suite with DS and extended-RAM data
pointers. The suite executes retail PK5 crypto, block access, parameter reads
and the native mode getter. It checks all 32 block permutations with encrypted
and decrypted data, read-only field-script counters, native parameter
allowlists, the command-table index, hook register/stack preservation, seven
evolution arguments, menu selection, reminder handoff, repeated cleanup and
three allocation-failure points. It also checks post-battle KO evolution,
native precedence, immediate KO thresholds, zero-EXP hook veneers, malformed
KO records, missing optional archives and return to ordinary level learning.

Heap, filesystem, event dispatch and presentation are instrumented boundaries.
These results do not certify native heap capacity, graphics, controls, battle
transitions or live DSi behavior.

The Black and White installer tests pass acceptance/revision gates, missing
and outdated dependencies, altered native bindings and companion instructions,
duplicates/conflicts, private-text retention, KO edits, export/reopen, FAT-entry
reuse, staged removal/reinstall and rollback. These tests install the bundled
runtime-8 dependency through the normal
Battle Log installer, including PMC-absent installation and rollback after a
late staging failure. Foreign DLLs claiming either new overlay-93 learning
hook, including the suffix of a native BL instruction, fail before mutation.

The host evolution, reminder-union and KO-learning-session suites pass. Their
Meson wrapper currently uses an obsolete libc++ assertion option with the local
SDK; the same test sources were compiled and run directly with the host compiler.

Separately named Black and White exports cold-boot in DS mode, open the native
RELEARN screen and cancel back to the party menu. EVOLVE starts the native
animation and accepts cancellation in both games. All five party Pokémon remain
byte-for-byte unchanged after each cancellation and return. Native evolution
also completes and returns the evolved species to the party.
Level-100 Pokémon reach the native replacement prompt immediately after a KO,
replace a full-slot move with Flamethrower, and finish battle with one KO, one
battle entered and one battle used. Both PK5 checksums remain valid. Saving to
separately named validation saves and cold reloading preserves the move and
all three counters in both games. The same zero-EXP learning flow can continue
into native post-battle KO evolution and return to the field with the expected
species, move and counters.

Combined exports install all five patches plus Battle Log through normal
installers in opposite Learnset/party-menu orders. Export/reopen/reinstall
retains settings, private text IDs and original FAT entries. Scoped DS checks
show EVOLVE, RELEARN and LEARNSET together in both games, including eight-row
menus with Surf. Eight repeated viewer entry/exit cycles retain all 1,100 party
bytes. Combined RELEARN replaces a full-slot move through native controls;
Learnset scrolling and evolution cancellation retain the resulting party and
all five PK5 checksums. The restricted move-selection Summary retains its native
controls. Live field-script `0x0110` calls return separately seeded KO, entered
and used counters without changing the party. Further combined battle and
cleanup observations are recorded below and in the shared release record.

Further combined sessions complete immediate level-100 KO learning and native
post-battle evolution in both games, save to separately named battery files,
and cold reload with the evolved species, learned move and three counters
intact. Every party checksum is valid in both save halves. Learnset and Summary
remain usable afterward and retain the complete reloaded party. Separate
sessions decline the KO move and cancel post-battle evolution, retaining the
original species and moves with the expected counters. Native EVOLVE also
completes methods 30 and 31 with separately seeded entered/used counters; the
counters and existing moves remain intact and all party checksums remain valid.
The retail NPC reminder also opens after cold reload in both games, follows its
restricted party-selection and Summary flow, replaces a move with Psywave,
exchanges a Heart Scale and returns to the field. The other four party members
remain unchanged; the learned Pokémon retains its counters and a valid checksum.
The ordinary retail Draco Meteor tutor also completes after this cold reload in
both combined builds. Native restricted Summary replaces Flamethrower with
Draco Meteor and returns to the field. The other four party members remain
unchanged, all five checksums are valid and the stored counters remain intact.

The production build and focused Battle Log, Enhanced Party Menu and Learnset
installer tests pass. Two optional gameplay-export tests are disabled by default.

Full six-member parties also retain every encrypted record after native
evolution cancellation. The shared all-five builds complete the 24
game/style/single-double-triple-rotation sessions and the status/type/target
and repeated field-return checks described in the [release record](../BW1_UI_RELEASE.md).
Native precedence and failure boundaries remain separately covered by the
compiled suite; the gameplay checks exercise the recorded evolution methods.
Both BW1 support flags are enabled for the recorded profiles, party-menu DLLs
and runtime-8 dependencies. Changed builds require fresh DS acceptance.
Live DSi acceptance remains pending. Other regions/revisions and altered native
bindings are unsupported.

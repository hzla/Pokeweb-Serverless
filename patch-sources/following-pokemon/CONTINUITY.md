# Menu, PC and seamless-zone continuity — 0.6.14 / 0.7.5 alpha

Both profiles share these corrections. The user confirmed the preceding menu,
PC storage and wandering-NPC fixes, but reported continued recall at Floccesy
Town / Route 20 in White2Upgrade. New seam acceptance remains pending.

## Remaining seam recall (this release)

The supplied pre-transition RAM has a visible follower at grid (126, 2, 662),
a player at (127, 2, 662), and a healthy retained field. Inspection did not
advance the state or run a DS emulator. The matching ROM maps this boundary
to zones 439 and 446.

Two separate packaged-code regressions reproduced recall:

- The native first-position routine `0x02166B7C` initializes new NPCs from a
  cleared actor. The world-write hook previously swept from that zero origin
  to the spawn point. Route 20 NPCs, including the entity at (141, 2, 664),
  created a false swept collision across the follower. Actor flag `0x2` is
  the verified movement-initialized bit. Before it is set, the hook now sends
  an endpoint placement notification. Actual initialized movement retains
  swept collision checks. Placement on the follower still recalls.
- Zone setup entries in banks 878 and 892 use `0x1D9` to change pending NPC
  direction and coordinates. The unsupported-command policy recalled when
  this command was observed. Its native handler only updates entity data,
  not live actors; it is now allowlisted with pinned handler/helper bytes.
  Subsequent actor allocation and placement retain their conflict checks.

The old DLL reproduced collision reason 4 on initial placement and unsupported
command reason 1 on `0x1D9`. This is CPU-fixture evidence, not a recording of
the full game crossing. The prior zone-deletion exclusion remains necessary.
No hooks, bridge ABI, heap allocation, rendering offsets or menu/PC behavior
were added or changed by this correction. Existing world-write notifications
now distinguish initialization from movement.

## Causes and corrections

- Closing the X menu replaces its event with the native subscreen-change event.
  The old root-pointer exemption did not recognize that new event. The policy
  now validates the exact menu and return callback plus their live game/field
  work. It also recognizes native menu callbacks on rail paths. Freed event
  addresses do not grant permission to new events. Unknown application children
  still recall.
- The earlier PC exceptions used incorrect command numbers: `0x12D–0x12F`
  actually control building models/healing, and `0x14C` frees script user work.
  The US dispatch table uses `0x130–0x132` for PC on/run/off and `0x14F` for
  storage. The policy now uses those verified commands and exact PC callbacks.
  Hall-of-Fame integrity query `0xEA`, which runs before PC power-on, is safe.
  `0x14C` remains harmless cleanup but cannot create a storage snapshot.
- Storage fades `0x1A3`, `0x1A4`, `0x1A7` are accepted only from the tracked PC
  VM. Its field fade flag pauses the follower without a recall effect. An
  unknown command, conflicting movement, or unrelated event still cancels this
  permission. The stock PC bank is 1244, selected by common script ID 10090.
  `verify-following-pc-script.ts` checks reachable command types against this
  policy; mailbox, records and manual branches remain conservative.
- Native streaming deletes ordinary zone actors in `0x02167ADC`. Follower
  creation now sets actor flag `0x20`, the native zone-deletion exclusion.
  This protects the actor during deletion; the initialization fix above also
  covers newly spawned NPCs. Native save
  exclusion stays independently set; explicit deletion and full field unload
  still release the actor. Script conflicts and a newly blocked trail may
  legitimately recall at a boundary.

## Storage reconstruction

The full-screen storage application releases the native field. Keeping the old
actor alive there would leave dangling rendering callbacks. Instead, resident
bridge ABI 4 stores one 60-byte snapshot with position, facing, zone, player
anchor and selected Pokémon identity. No native pointer or entire appearance
registry is retained. The field module consumes it once after reconstruction.

An unchanged identity, zone and player position permit immediate visible
reconstruction at the preserved pose, including while the PC dialogue remains
active. A different selected Pokémon rejects the pose and uses ordinary
replacement after the PC event finishes and walking reseeds following. Changing
other slots or boxes does not replace the follower. Empty/Egg-only parties
remain suppressed. Invisible followers do not create visible-return snapshots.
Unsafe recall invalidates a pending snapshot. No new save state is introduced.

Within a retained field, menu and PC presentation pauses preserve the whole
movement trail. A full storage field reconstruction retains only the validated
pose; movement history is reseeded, without replaying UI movements.

## Verification and manual checks

`verify_continuity.py` executes packaged ARM946 code, the native zone deletion
loop, all 34 NPC initial placements from the two reported zones, pending
spawn-data updates, actual placement collisions, initialized movement sweeps,
and identity validation. UI, geometry and allocation services are spies;
these are not game-emulator results. Build publication requires at least 100
cycles. Existing conversation, event, collision, render and relocation checks
remain part of the build.

Cold boot the new ROM using the matching ordinary `.sav`. Test checklist X07
at Floccesy Town / Route 20 first; repeat X01, X04 and X05, then the ambient-NPC and dialogue regressions. Do not
load an old emulator state to accept a newly linked runtime.

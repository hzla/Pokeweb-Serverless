# Visible followers during dialogue, menus and PC use — 0.6.24 / 0.7.15 alpha

NPC/sign text, facing turns, choices and supported stationary scenes pause the
follower at its current recorded pose. The actor, facing and trail survive the
event. Finishing such an event resumes that actor without a send-out. Independent
mode, partner, fade, teardown and ownership guards still apply.

Forced player translation/jumping, a conflicting NPC action, ID/slot pressure,
and unsupported commands or child callbacks recall immediately. The native
operation then runs normally; it never waits for the detached recall effect.
Zone setup command `0x1D9` only updates pending NPC entity data and is allowed;
the ensuing allocation and first-position write still check conflicts. Initial
placement checks its endpoint, while initialized movement checks its swept path.
Recall remains latched until the entire event chain and cached completion flag
finish. Subsequent walking seeds a fresh trail. The 0.4.1 one-use exemption for
the follower's own conversation is retained separately.

Ordinary wandering outside tracked events now uses a separate synchronous
collision query. It blocks only the autonomous NPC step, with no scene pause or
recall. A controller that deliberately ignores collision checks can still cause
recall before its conflicting world-position write. See [AMBIENT.md](AMBIENT.md).

## Modules and lifetime

`PokewebFollowingEventsW2.dll` is resident (PMC priority 1). It wraps opcode
fetch, native event callback/free, VM free, resolved actor actions, slot
allocation, placement, world-position writes and deletion. `events.h` defines
bridge ABI 4: a data export with size/version and indirect bind, unbind,
preserve, consume and discard function pointers. The field DLL imports only this
data symbol. No immediate intermodule ARM/Thumb call or shared native-structure
extension is used.

The overlay-36 field DLL registers its field, game-system identity and generation
after field initialization. It clears registration before native field teardown.
The resident module forwards native calls unchanged when unregistered. It may
retain one bounded PC-Box restore snapshot across that teardown; every other
scene registration is cleared.

Scene state lives outside native objects. The pause state differs from both
`Interacting` and suppression; it does not clear the movement trail or snap to a
grid center. At most 16 event identities and 48 VM identities are recorded. Only
the live native event chain is traversed. Tokens and diagnostic pointer values
are never dereferenced later. Event and VM free notifications invalidate tokens
before deallocation; VM free never reads its already-freed environment.

The current event pointer and the game system's cached flag are checked together.
No native lock or cached flag is cleared. On safe return, party selection is
refreshed immediately; an unchanged identity reuses the actor. Generation or
field mismatch disconnects the bridge and suppresses until field reconstruction.

## Executed command policy

`event-policy.json` records the explicit allowlist, US handler addresses,
categories and byte fingerprints. `generate_scene_policy.py` produces the C
opcode table; `contract.json` pins its native dependencies. The opcode-fetch
callsite in `VM_Run` precedes both standard and extended dispatch. Reading an
operand does not invoke the observer. Native permission checks, branch behavior,
arguments and return values remain unchanged.

The allowlist covers 170 standard commands: basic control flow/variables,
dialogue and name formatting, choices, ordinary sound, camera operations,
read-only context and actor commands with additional resolved-action checks.
Opcode `0x276` is included as an interaction-progress broadcast. Stock sign
and static-furniture scripts run it after actor pause and before their sound and
message commands; it does not move actors, replace the field, or start a
communication activity. The exact handler bytes in overlay 33 are pinned.
All other standard commands and all extended commands recall before native
dispatch. An untaken branch is never scanned. Supported child callbacks are the
field script supervisor, choice list, two camera waits and the mandatory script-end
cleanup child. Cleanup is allowed only with a valid native work layout and a
registered-bit mask containing audited camera, message-window, auto-print and
volume/ambience finalizers. The mask is checked before every callback, including
resumed cleanup. Other finalizers and child callbacks recall before execution.

Actor actions are checked again when each queued step is committed. Facing and
waits remain safe. Grid movement queries native destination terrain height and
checks a swept native tile footprint, including multi-tile jumps. Rail walks use
a private 124-byte native cursor copy to evaluate the actual rail path through
16 native samples. Direction keys therefore follow rail geometry. No live rail
cursor, camera or shared calculation cursor is advanced by this probe.

Common field-event setup sets the native `MMDL_MOVEBIT_PAUSE_MOVE` bit on
ordinary actors. A queued local action belonging to an actor with that bit set
is dormant, so its projected route is not grounds for recall. This covers
random-movement NPCs frozen for a conversation and unrelated wanderers while a
sign or static furniture script is open. The player remains guarded regardless
of this bit. Position and world-step hooks also remain active: if a script is
allowed to move a paused actor, they recall synchronously before a conflicting
coordinate write. Once the actor is unpaused, normal route prediction applies.

Direct world-position writes are checked before coordinates change, including
non-grid writes. Native dimensions extend toward +X and -Z; height uses native
grid-level separation. Pool/ID checks run before selecting a native actor slot.
Grid spawns use a conservative 3-by-2 bound for stock descriptors. Special or
rail spawn layouts recall rather than guessing their resolved geometry.

The native menu and its replacement subscreen-return callbacks are validated
against their live game/field work. Both preserve the follower, including on
rail paths. A reused event address cannot grant permission. Party, Bag, Pokédex
and other applications may still recall normally.

PC on/run/off uses verified commands 0x130–0x132 and exact presentation callbacks.
The tracked PC VM can fade into storage without a recall effect. Storage command
0x14F snapshots the selected Pokémon identity and pose before field teardown.
The resident bridge returns that snapshot once. Matching identity, zone and
player position permit visible reconstruction even while the PC dialogue is
still active. A changed selected Pokémon rejects the old pose and returns via
ordinary replacement after walking. See [CONTINUITY.md](CONTINUITY.md).

Conservative cases include unaudited movement profiles, special rail actions,
point/invalid rail cursors, missing terrain, rail repositioning and other
full-screen applications. These are individually diagnosed; stationary dialogue
itself is not excluded on rail or non-grid maps. Script coverage and visual
geometry still require the human acceptance cases; a safe-looking scene can use
an unsupported opcode and legitimately recall in this alpha.

## Diagnostics and acceptance

`FollowingSceneDebug` starts with the bytes `FWSE`. It exposes diagnostic ABI,
generation, disposition (0 idle / 1 paused / 2 recalled), last reason, opcode,
actor action, live event/VM identities, event origin, write counter, script ID and
a bounded 32-entry ring. It allocates nothing and is not saved.

| Reason | Meaning |
|---|---|
| 1 | Unsupported opcode |
| 2 | Unsupported child/event callback |
| 3 | Forced player movement |
| 4 | Occupied-space conflict |
| 5 | Follower actor-ID conflict |
| 6 | Native actor-pool pressure |
| 7 | Unsupported/unresolvable movement or placement |
| 8 / 9 | Event / VM tracking capacity reached |
| 11 | External deletion of the follower |
| 12 | Missing/incompatible bridge registration |
| 13 | Unsupported cleanup finisher or invalid cleanup work |

`FollowingDebug.reason` adds `0x400` for bridge failure and `0x800` for an event
chain with recalled follower. Script/VM addresses in these records are identities
only. Capture the script ID, opcode/action and generation with any unexpected
recall; do not dereference an old pointer from a trace.

`verify_scenes.py` loads the final pair of DLLs at separate addresses, resolves
the import by its RPM export hash, and installs their actual hook bytes. It uses
the pinned retail VM dispatch, event cache and scheduler on an ARM946 CPU.
Rendering, UI, actor allocation and geometry evaluators are isolated spies;
these checks do not establish in-game visual or hardware acceptance.

Run `npm run following:verify-scenes -- /path/to/clean-white2.nds` and follow
S01–S18 and X01–X06 in [the human checklist](EMULATOR-CHECKLIST.md). Cold boot the versioned
ROM from an ordinary save; an older emulator state contains old module code.
Emulator execution belongs to the human tester. Hardware remains unverified.

The menu-return, PC-command and streamed-zone corrections are described in
[CONTINUITY.md](CONTINUITY.md). That document supersedes earlier PC opcode
assignments and pose-only return assumptions.

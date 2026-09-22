# Wandering NPC collision — stock 0.6.14 / Upgrade 0.7.5

The visible follower participates in collision checks made by an actor's native
autonomous movement callback. A wandering NPC receives the ordinary blocked-step
result and uses its existing wait/retry behavior. The callback context is bounded
and synchronous; its previous value is restored on return. Player movement,
trainer sight and queries outside that callback retain their native results.
An active script/event bypasses ambient blocking and retains existing recall
before conflicting scripted movement. Native collision flags are never toggled.

This deliberately changes the earlier no-blocking policy for ambient NPCs only.
It follows HGSS's distinction between player passage and wandering-NPC collision.
There is no new save field, configuration option, route rewriting or pathfinder.

## Verified binary boundaries

- Overlay 12 `0x021671C8`: movement-callback dispatcher, actor table at +140,
  update slot +8. Resident replacement brackets the same callback invocation.
- Overlay 12 `0x0215E538`: four-argument grid collision. Its 12-byte veneer preserves
  r3 (the Z argument) using r4/LR. The displaced prologue resumes at `0x0215E544`.
  Retail collision runs first; only an otherwise clear autonomous query can gain
  a follower collision. Grid volumes grow +X/-Z and consider current/previous
  positions at matching native grid elevation.
- Overlay 36 `0x02195714`: native rail actor-collision call. Original collision
  runs first. The destination is resolved through the native rail manager and
  its native radius/elevation test, rather than a guessed compass direction.

The current bridge is ABI 4; field registration and unload rules remain unchanged. Query
records are stack-owned and never retained. The full native function bodies and
rail helper bytes are pinned in contract.json as well as the hook instructions.

## Simultaneous movement and exceptional controllers

Before a follower trail sample is applied, native NPC current/previous grid
footprints or current/reserved rail positions are checked. The player and actors
excluded from native object collision are omitted. A blocked follower recalls,
discards its trail and waits for safe player movement to reseed. It does not
teleport around the NPC or delay the player's input.

Normal wandering NPCs remain blocked while the follower occupies the tile.
Special autonomous controllers can deliberately ignore collision results; their
conflicting native world-position writes recall the follower before proceeding.
This fallback preserves those controllers instead of cancelling committed moves.
Initial placement before the verified movement-initialized flag (`0x2`) uses
only the destination footprint. It must not invent a path from the cleared
actor origin. Live movement keeps its swept collision check, and a conflicting
spawn destination still recalls. See [CONTINUITY.md](CONTINUITY.md).
Hidden followers are excluded. Collision covers native occupied space; oversized
artwork can visually overlap neighboring tiles without making all pixels solid.

No new heap allocation is introduced. The resident callback context costs one
pointer; query and rail-coordinate temporaries are on the stack. The appearance
registry remains in ROM, and the conversation buffer remains 8 KiB.

## Acceptance

verify_ambient.py runs final DLL hooks with the original native grid collision
scan and the original wandering state-machine retry branch. Map/rail evaluation,
UI and resources are isolated spies. Existing interaction/scene tests execute
first. The build invokes this test before publishing either profile.

N01–N08 in EMULATOR-CHECKLIST.md cover wandering, release after blocking,
simultaneous movement, player/trainer behavior, scripts, rail/elevation, hidden
actors and unload. Upgrade U15 repeats these with expanded species. Emulator and
hardware acceptance remain with the user; CPU tests are not visual acceptance.

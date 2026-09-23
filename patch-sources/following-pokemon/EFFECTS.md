# HGSS overworld ball effects — 0.3.x alpha

HGSS has distinct send-out and recall effects. `fldeff_mb_io.c` implements them
in `EoaMB_Out_Move` and `EoaMB_In_Move`: a short ball display and flash on send-out;
a white shrinking Pokémon followed by a ball on recall. Its
`GMEVENT_MapChangeWorpPoint` path explicitly starts recall before proceeding.
That source check establishes the warp path; it does not establish that every
ordinary HGSS doorway uses the identical sequence.

The imported resources are original compiled US HeartGold IPKE assets from
`a/1/0/3`: member 129 (ball model), 104 (flash model), and 164 (texture animation).
`import_effects.py` creates a three-member NARC and records hashes and lengths
in `src/assets/following/effects.json`. The runtime checks its length and CRC
before passing it to the native resource loader.

## White 2 adaptation

- Uses the existing overlay-36 follower and a verified billboard-render callsite.
  New code is a standalone PMC module; no reference game sources are built.
- Send-out starts when a valid one-tile trail first permits the follower to
  appear. The ball lasts two field ticks; the original flash animation plays
  for eight ticks as the Pokémon becomes visible.
- Recall starts on detected event/fade, player-mode or story-partner suppression.
  It snapshots the follower's current billboard, removes the native actor,
  and draws the detached image at scales 1, 1/2, approximately 1/3, and 1/4,
  then shows the ball for four ticks. No scripted actor ID remains occupied.
- A separate texture/palette resource supplies the white silhouette. Neither
  the follower's original texture nor another actor's palette is modified.
  Resources are uploaded once and reused; draw-time code does not allocate.
- Field unload cancels effects and releases all owned render objects, animations,
  models, texture/palette allocations and resource buffers. An interrupted
  effect never delays a warp, battle or menu. Menu/system suspension may use
  immediate removal rather than a complete visible recall.
- The first appearance and subsequent returns require walking to seed the trail.
  There is no new button, interaction or save field.

The port uses White 2's current billboard placement for the shrinking image.
HGSS's additional size-specific positional adjustment is not enabled here;
large Pokémon positioning needs visual review. Inspection of the HGSS send-out,
recall, PC recall, and warp callers found no dedicated sound call paired with
`FE_MB_IO_Add`; the effect implementation itself also contains no sound call.
The port therefore keeps these effects silent instead of assigning an unrelated
White 2 sound. The separate HGSS PC-box recall variant remains outside this
animation change.

## Validation boundary

The 0.3 module builds without unresolved imports and has exactly three field
hooks. Binary signatures, render forwarding, stack/register preservation,
effect sequencing, missing-asset fallback, private material ownership, absence
of per-frame allocation/upload and idempotent destruction are checked with
mocked native services. These are not DS rendering tests.

The user reports the effects working in the browser emulator. A separate
movement-helper instruction fault blocked 0.3.0 on melonDS; 0.3.1 fixes that
encoding, with the user confirming that 0.3.1 fixed the melonDS freeze. See [validation](VALIDATION.md).
**The full visual matrix remains pending human testing.** Check the FX rows
in [the emulator checklist](EMULATOR-CHECKLIST.md). In particular, determine
whether a doorway's fade allows the full recall to be seen, whether the flash
aligns with the Pokémon, and whether the native scene looks unchanged afterward.
Early teardown intentionally cancels unfinished effects rather than retaining
resources across a field unload.

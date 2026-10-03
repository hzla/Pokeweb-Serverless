# Move Expansion animation assets

All supplied Gen 9 move animations are by **Log(n)**. The bundle preserves this credit in its manifest and `CREDITS.txt`.

The optional Gen 6, 7 and 9 bundle contains 196 White2Upgrade animation scripts, all 244 referenced SPA particle files, and 15 screen/character/palette background triplets. The Gen 9 import covers moves 852-919; Tera Blast (851) was not supplied. Installing the bundle provisions dependencies into the target ROM and rewrites script IDs. Assets already present with identical bytes are reused; differing assets are appended without replacing existing entries.

| Resource | Black / White | Black 2 / White 2 |
| --- | --- | --- |
| SPA particles | `a/0/0/6` | `a/0/0/6` |
| Move backgrounds | `a/0/9/5` | `a/0/9/4` |
| Routing loader overlay | 94 | 168 |
| Move-command overlay | 93 | 167 |

Do not assume a low particle ID denotes the same asset in both games. Many BW1 and BW2 files differ at identical IDs. Backgrounds must be allocated as contiguous triplets; `LoadBackground n` reads files `n`, `n+1`, and `n+2`.

## BW1 command compatibility

BW1's native handlers for `DistortBackground` (opcode 38) and `BackgroundPaletteAnimation` (opcode 39) consume four and five arguments respectively and return without rendering those effects. The BW2 scripts use six and two arguments. Installing their original encoding on BW1 can desynchronize script execution.

The installer removes these two commands from BW1 copies and reassembles labels and branch addresses. BW2 retains them. This preserves the remaining animation but does not port the sequel's distortion or palette-animation effects. It also does not install later-generation battle mechanics or custom move-effect handlers.

## Frost Fairy compatibility and export

Frost's Black 1 Fairy patch prepends `0x2100` bytes to overlay 93 and lowers its RAM address. Pokeweb locates the move-command hook using its surrounding instructions, including when its original file offset has moved. Ambiguous or conflicting hooks are rejected. The installer preserves Fairy battle code and replaces recognized legacy animation routing with the coordinated Pokeweb helpers.

The routing helpers fit inside verified alignment padding in the two native overlays. The loader's original 32-byte BSS allocation is materialized as static data, preserving its native pointer and setting the table's BSS size to zero. Its total RAM footprint stays unchanged. Simply increasing the load size of older appended helpers is unsafe: those helpers overlap the party-selection overlays used when switching after a KO.

Normal export migrates recognized older helper pairs, whether their load size was truncated or already enlarged. Migration validates the helpers, pointers, command target, native padding, and exact old tail length before replacing them; unrecognized extensions are left untouched. This handles imported ROMs without requiring the user to reopen the Move Expansion installer. Missing bundled assets in an older ROM require reinstalling with **Include Gen 6, 7 and 9 Animations** checked.

## BW1 startup compatibility

Older BW1 PMC startup wrappers can contain two malformed Thumb-to-ARM calls, causing an undefined-instruction exception in melonDS before battle overlays load. The RPM relocation writer now computes BLX displacements from the word-aligned PC, including forward calls at addresses ending in `...2`. Thumb-to-Thumb BL calls retain their halfword-aligned PC behavior.

Normal export repairs the recognized Black/White wrapper after validating its active entry call, RPM overlay, initializer destination, and both legacy call targets. Corrected calls are left unchanged; unknown wrappers are preserved. This startup repair changes no animation assets or overlay allocations. Test it from a fresh boot: an old savestate restores the faulty instructions and exception state from RAM.

## Regenerating the bundle

Run from the repository root:

```sh
npm run moveexpansion:animations -- /path/to/White2Upgrade-Original-pokeweb /path/to/output.zip /path/to/prerequisite-spas.narc /path/to/cleanblack2.nds
```

The fourth argument can instead be a clean White 2 ROM. With no arguments, the generator uses its existing sibling White2Upgrade checkout, the shipped ZIP output path, the checkout's expanded SPA archive, and `../cleanblack2.nds`.

Custom SPA files in the White2Upgrade graphics directory take precedence. Remaining particles and backgrounds come from the supplied BW2 ROM; unavailable particles fall back to the prerequisite archive. The v3 manifest records donor game code and SHA-256, each dependency's hash, and each move's referenced IDs. New external object or called-animation dependencies cause generation to fail until explicitly supported. The app uses the shipped bundle and does not require an end user to supply a second ROM.

## Validation

```sh
npx vitest run src/test/moveExpansionPatch.test.ts src/test/moveAnimationModel.test.ts src/test/moveAnimationPreviewModel.test.ts src/test/moveBackgroundModel.test.ts src/test/romPatchModel.test.ts src/test/fileSystemModel.test.ts
npm run moveexpansion:verify-rom -- /path/to/input.nds --include-bundled-animations
npm run build
```

The ROM verifier checks in-memory and post-export idempotence, preservation of pre-existing particle/background entries, complete background triplets, valid particle references, BW1 command adaptation, overlay load sizes, zero BSS after materialization, and unchanged or reduced overlay RAM footprints. Emulator checks are separate: a successful export is not evidence that every move animation has completed in-game.

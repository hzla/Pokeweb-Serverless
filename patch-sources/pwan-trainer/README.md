# PWAN trainer sprites

Status: **source-copied**.

Bundled artifacts: `PokewebPwanTrainerB2.dll`, `PokewebPwanTrainerW2.dll`.

This standalone overlay-168 runtime redirects configured front-trainer graphics to a shared appended carrier, uploads 96×96 PWAN frames, and seeds each native MCSS palette. It supports stock US Black 2 and White 2 and does not depend on the Pokémon PWAN runtime DLLs.

Registration uses the MCSS instance index, not its initial native palette address. Frame zero is uploaded when native resources are ready; subsequent updates animate the registered instance. Deletion unregisters the MCSS argument (the native function's second argument). Hook wrappers preserve eight-byte stack alignment.

The imported palette is installed once in the native source buffers after resource loading, with a native palette-update request. MCSS retains ownership of its palette proxy, blend parameters, and queued VBlank uploads. Later GIF frames update only texture pixels: they neither bind a separate full-bright palette nor overwrite native palette-effect buffers. This preserves the native dark-to-normal trainer intro without GIF-frame-dependent brightness flicker.

The carrier uses upward-positive cell Y and a bottom-center pivot, so its 96×96 canvas ends at the native trainer baseline. Its multi-cell node stays at `(0, 0)`. The integration snapshots include the carrier generator and both games' hook-signature checks.

After updating an older installation, reinstall **Trainer PWAN GIF Support** in Code Injection and start a fresh Test Battle. Reinstallation regenerates the carrier without reimporting GIFs. An old emulator save state retains the old runtime and carrier.

## Local verification

Run `npx vite-node scripts/verify-trainer-pwan-emulator.ts ROM.nds ANIMATED.gif 1` from Pokeweb with a locally supplied clean US B2/W2 ROM and an animated GIF. This uses the bundled browser emulator core, asserts multiple trainer frame uploads and actor deletion, and writes PNG captures and a final save state to a new temporary directory. Inspect the captures for positioning, palette, and the transition to Pokémon sprites. Add `--with-pokemon` to install the separate Pokémon PWAN DLLs too, or `--native` to capture an unconfigured trainer for visual comparison. The native capture mode does not assert PWAN playback.

Add `--verify-fade` for the stock trainer-1 intro to sample the actual rendered VRAM palette every frame. The regression requires the native palette slot, a black silhouette, monotonic intermediate shades, and the final imported colors. `--hold-first-frame` holds the first GIF frame for 128 ticks (requires at most 64 timeline entries), verifying that native fading also completes when the texture does not change. Palette traces are diagnostic outputs, not distributed fixtures.

This focused smoke test covers a single trainer intro; it does not establish multi-trainer or complete battle-lifecycle coverage. Unit tests separately verify B2/W2 carrier geometry, archive round trips, and preservation of original trainer files. ROMs, saves, GIFs, and emulator captures are not included in this snapshot.

These are bookkeeping copies only. The canonical runtime source and build recipe remain authoritative. Shared external headers and toolchain dependencies are not duplicated here.

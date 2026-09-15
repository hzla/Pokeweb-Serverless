# Current iteration

Bundle 0.4.16 contains Type Icons 0.3.16 and unchanged Move Preview 0.4.0.
The native caught Poké Ball is again fully owned by the game at its original
8×8 enemy-header coordinates. The patch no longer clears or redraws it. Header
translation begins immediately after the marker slot, and runtime layout checks
still validate the unused pixels before it.

The 12×11 point-up type rhombuses, 5-right/6-down dual stack, raised monotype,
name spacing, status behavior, effective typing, Illusion, and palette handling
are unchanged. The previous 0.3.15 DLLs are retained as installer upgrade
fixtures.

Removing the legacy marker raster and relocation path reduces each release DLL
to 7,824 bytes and estimated retained PMC use to 8,080 bytes. Fixed state remains
364 bytes, with no battle-heap allocations. Compiled ARM tests verify the native
marker remains byte-identical through creation, all statuses, image reloads, and
teardown in singles, doubles, and triples for B2 and W2. No in-game emulator
testing was run.

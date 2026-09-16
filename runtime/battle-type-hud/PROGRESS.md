# Current iteration

Bundle 0.4.21 contains three selectable Type Icons builds and unchanged Move
Preview 0.4.0. The Code Injection card shows all three preview sheets and one
Icon style selector. Switching styles replaces the existing Type Icons DLL at
its current path, so duplicate hooks are never installed.

The third build now paints only the light checkerboard face at the native HUD's
stair-stepped left edge. It uses an 11-row regular-player mask and a seven-row
mask for enemies and compact triple-player panels. Enemy wedges begin one pixel
farther left; every black pixel outside their exact mask and the complete bottom
shadow remain untouched. A dual type keeps independently colored
upper and lower fields separated by a black divider; a monotype fills across
the divider interior. The native enemy caught marker remains in place.

All three builds share status behavior, live effective typing, Illusion,
palette fades, lifecycle hooks, player/enemy layouts, and fixed 364-byte state.
The angular-wedge release DLL is 7,184 bytes and has an estimated 7,488-byte retained
PMC footprint, with no battle-heap allocation.

Compiled ARM checks cover all 18 type colors, mono and dual geometry, every
player and enemy panel slot, all six statuses, live mono-to-dual type changes,
unchanged-frame write suppression, caught-marker preservation, and exact
teardown for B2 and W2. No in-game emulator testing was run.

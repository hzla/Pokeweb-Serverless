# Current iteration

Bundle 0.4.23 contains three selectable Type Icons builds and unchanged Move
Preview 0.4.0. The Code Injection card shows all three preview sheets and one
Icon style selector. Switching styles replaces the existing Type Icons DLL at
its current path, so duplicate hooks are never installed.

The third build paints only the native HUD's stair-stepped left face. Its strips
are two pixels wider, and the black dual divider is one row higher. Retail
summary-label dark shades sit at monotype edges. Dual-type transitions use the
matching bright fill dithered with black, preserving the darkened corners and
both sides of the divider without touching the live HP-bar palette. A monotype
removes the divider and stays continuous. Enemy wedges retain their one-pixel
left adjustment; black pixels outside the exact mask, the complete bottom
shadow, and the native caught marker remain untouched.

All three builds share status behavior, live effective typing, Illusion,
palette fades, lifecycle hooks, player/enemy layouts, and fixed 364-byte state.
The angular-wedge release DLL is 7,600 bytes and has an estimated 7,856-byte retained
PMC footprint, with no battle-heap allocation.

Compiled ARM checks cover all 18 fill/shade pairs, mono and dual geometry, every
player and enemy panel slot, all six statuses, live mono-to-dual type changes,
fade handling for the two reclaimed palette entries, byte-exact preservation
of live HP-bar entries 5–12, unchanged-frame write
suppression, caught-marker preservation, and exact
teardown for B2 and W2. No in-game emulator testing was run.

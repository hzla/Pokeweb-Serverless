# Continue map zoom and memory outlook

Version 0.1.9 implements a smooth 4× lower-screen zoom when Continue is selected from a mapped save. The top card stays visible. Sixteen eased scale steps and a two-tick hold display over roughly 41 emulator video frames (about 0.68 seconds) before the native load begins. The location marker is the zoom focus. The patch ignores repeat, B, and page-navigation input during this short animation, then forwards Continue once. An unmapped location continues immediately.

The existing map framebuffer is an affine bitmap background. The zoom changes its scale and origin during VBlank, so it needs no second map texture or full-screen pixel buffer. The [animation preview](validation/continue-zoom.gif), [midpoint](validation/continue-zoom-mid.png), and [4× endpoint](validation/continue-zoom-4x.png) are emulator captures from the Route 20 save. The endpoint matches the 4× scale selected from the earlier static probe.

Near an edge, the camera origin is clamped to the 256×168 map. The marker then moves toward the corresponding screen edge rather than exposing the hardware's out-of-map color. For locations where the zoom would enlarge the map's location banner, the patch restores the 152×22 map pixels beneath that banner before magnifying. The [upper-left edge probe](validation/continue-zoom-edge.png) shows the clamped view without the enlarged banner. If the banner-underlay allocation fails for such a location, Continue falls back to the native load without a zoom.

## Verification

The 0.1.9 ROM booted saved and empty menus. A 680-frame button Continue capture showed 41 custom-menu frames with the zoom, 295 dark handoff frames, and then the game's transition and gameplay; no old-menu frame appeared. Touch Continue also reached gameplay. B and Right during the animation did not change pages or interrupt the load. New Game button and touch actions, return from the native warning, 1,200 idle saved-menu frames, 600 idle empty-menu frames, and 40 page round trips passed. The initial saved screen was pixel-identical to 0.1.8. The source ROM and test save hashes remained unchanged.

## Asset and heap space

The 0.1.9 PMC module expands to 63,536 bytes. A prior 64,176-byte build booted, while a 64,288-byte trial did not, so additional embedded art would be risky. The zoom itself adds only a small scale table and code. The new location-banner underlay uses 6,688 heap bytes; all live menu allocations were non-null in the Route 20 emulator state.

The largest embedded asset is the 31,207-byte compressed town map. Moving it to a new ROM filesystem file could provide substantial module headroom, but loading that entire file into heap would raise peak heap use. The preferred next experiment for a larger feature is to append a distinct map asset to the ROM filesystem, have the installer check its file and path conflicts, and stream it through a small decode buffer. Smaller candidates are the 2,668-byte marker frames and 1,871-byte badge art. That relocation is unnecessary for the current zoom and has not been implemented or validated.

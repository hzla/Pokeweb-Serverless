# LEARNSET — validation evidence

On 2026-10-08, the separately built US revision-0 B/W `0.1.0-bw1-candidate` companions passed compiled wrapper checks for native command capacity, exact prologue trampolines, seven-argument graphics veneers, missing-companion handling, read-only input, list/PP/scroll controls, D-pad party switching including forms/Eggs, family refresh rollback, native list ownership, and repeated cleanup. Retail font/icon/type routines also passed the complete compiled information suite, including header, family navigation, and session-cache checks in both games. Instrumented I/O/heap figures exclude native allocator overhead and real graphics/input timing.

The 36 BW1/BW2 installer tests passed, including both BW1 acceptance gates, native API/resource checks, duplicate/conflicting/altered companions, atomic rollback after the second companion fails, pair repair, reinstall, and export/reopen with edited private text. Both BW1 private validation ROMs were exported through the normal installer and reopened with retained IDs; source ROMs remained unchanged. The shared-source BW2 rebuild left all four shipped BW2 Learnset DLLs byte-identical, and both BW2 compiled wrapper suites passed. TypeScript checking and the production build passed after installer integration.

Four isolated B/W DS/extended-RAM fixtures executed each game's retail mode getter and passed info allocation-pointer access, family navigation, and cleanup. Heap/filesystem boundaries were instrumented; no blanket 4 MiB pointer limit was introduced. These checks do not measure native heap capacity or establish live DSi acceptance.

Scoped DS sessions cold-booted both separately named validation exports, opened LEARNSET through each normal bundled DLL, and returned to the native party screen. Black’s party bytes were unchanged after browsing and exiting. Black's diagnostic menu-trace export displayed Heat Rotom's form-specific information and Electric/Fire badges, skipped the Egg during party switching, and browsed from Haxorus to Fraxure with the virtual learnset/stats and evolution requirement. A capture taken before the native menu animation settled initially hid the new row; tracing confirmed registration and the settled menu displayed LEARNSET. This required no registration fix. The diagnostic trace is private and is never bundled. These observations are narrower than acceptance of all release artifacts and required contexts.

Normal all-five-patch exports also pass scoped Black and White sessions with
both companion installation orders. Their native menus include EVOLVE, RELEARN
and LEARNSET together, including eight-command menus with Surf. Both games show
Heat Rotom's form-specific data, skip the Egg, browse Haxorus's evolution family,
scroll move rows with native PP, and animate only the selected family icon.
Pressing A while browsing does not learn a move. Full party records remain
unchanged after scrolling and eight repeated entry/exit cycles. Native RELEARN
then replaces a full-slot move and returns normally in both combined builds.
After combined KO learning, post-battle evolution and cold save reload, the
viewer also opens for the evolved species. Browsing and subsequent Summary
navigation retain the complete reloaded party in both games.
The retail NPC reminder remains functional in both combined builds after cold
reload: native selection, move replacement and Heart Scale exchange complete
and return to the field with unchanged counters and other party members.
The ordinary retail Draco Meteor tutor also completes through native restricted
Summary in both builds after this reload, retaining the counters and other
party members.

Further combined sessions use all six party slots in both games. The viewer
browses all seven Eevee evolution branches and their native requirements,
handles terminal families, skips the Egg, displays an empty learnset and
reports a deliberately truncated learnset as unavailable. Read-only/no-op
controls and native return retain every one of the 1,320 encrypted party bytes;
all six PK5 checksums remain valid. A full six-member party also displays the
eight-command Surf/EVOLVE/RELEARN/LEARNSET menu without clipping.

BW1 DS gameplay and visual acceptance is complete for the builds identified in
the [release record](../BW1_UI_RELEASE.md). Both support flags are enabled only
for those profiles and DLL hashes. Same-session menu/battle/menu transitions
also reopen Learnset and Summary correctly in both games, retaining all six
party records during post-battle browsing. Live DSi acceptance remains pending;
these observations do not establish a general native heap-capacity bound.

The 1.4.5 release checks recorded on 2026-09-17 include compiled White 2 and Black 2 wrapper tests for separate navigation sounds, exactly-once playback, and silence on failed or no-op input. Native byte checks pin the tutor-list callback to sound 1356 and the summary Left/Right page-change paths to sound 1637. Neither sound path adds a hook or overlay lifetime. The paired menu DLLs changed only in version metadata; the viewer code changed by four bytes from 1.4.4. These are package measurements, not a live heap measurement.

The recorded installer/PMC/export suite passed 86 focused tests, and the production build passed. Updates from both 1.4.4 test ROMs preserved private messages and exported/reopened successfully. The 1.4.5 W2/B2 test ROMs passed 900-frame startup checks with matching battery saves. Those startup checks establish boot, **not** interactive LEARNSET or audible sound behavior. The prior layout, info-cache, and header suites were not rerun for this sound-only release; consult Git history for their earlier results and limits.

During the 2026-09-24 repository cleanup, the 1.4.5 build and the compiled runtime, information, and graphics checks passed for W2 and B2 after historical build outputs were archived. Shipped assets were unchanged; no game emulator was run.

The viewer retains a bounded evolution graph and three icon buffers until the session ends. Temporary filesystem caches and message handles close after each load, and the viewer's application heap is destroyed before overlay teardown. Earlier instrumented allocation and I/O figures exclude native windows, message internals, allocator overhead, and real elapsed time; they are not a current peak-heap measurement. The module adds no battle-resident allocation by design, but long-session native memory behavior still requires acceptance.

BW2 human cold-boot checks remain open for the upper-panel appearance, selected-only icon animation, L/R family and D-pad party navigation, terminal and branching evolution requirements, list scrolling and PP, sound effects, empty/malformed data handling, eight-command menus, repeated opening/closing, and unchanged RELEARN/tutor behavior. Test both stock B2/W2 and supported Upgrade install orders. Do not use a state with an older DLL to validate a new export. Current code and packaging are described in [README.md](README.md); historical release reports remain in Git history.

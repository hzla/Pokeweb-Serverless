# B2/W2 save-menu installer

Version 0.3.6 is available under **Code Injection → Graphical/UI Enhancements → Black 2 / White 2 Save Menu** on hosted Pokeweb, LAN addresses, and localhost. Installation is available for compatible English Black 2 / White 2 ROMs regardless of the page's hostname.

With a save present, the menu plays the game's Relic Song sequence. The player walking loop and occupied party icons change poses every eighth note using the sequence tick counter, so they follow its tempo changes. The song restarts after its natural ending and the previous sound state is restored when leaving the menu. The no-save screen keeps its native behavior. Installation checks the ROM's song sequence and sound routines before staging the patch.

The top screen uses the native party-menu grid behind the save card and New Game button, with a cyan outer border following the native 64-frame selector fade. A filled faint gray emblem sits behind the save-card elements and is restored beneath animated sprites during walking and recalls. Its compact mask is embedded in the DLL without an additional heap buffer.

Continue recalls the visible party from right to left, starting two frames apart. Pokémon turn cyan/white and shrink away without a ball effect. The player raises the ball through native Fly poses 1 → 2 → 3, holds until recalls finish, then reverses 2 → 1 → 0. After the recalls finish, a player sprite in a raised-leg walking pose jumps across the two screens onto the zoomed location marker, with the follower-mount sound at takeoff. The patch has no Following Pokémon dependency. Interiors use the town/route marker when their location label identifies one unique point. No-save menus use the original game screen. The native C-Gear question is skipped using the Yes fade/load path; native wireless errors remain visible. No-question saves keep their native direct load.

English B2/W2 and compatible hacks are accepted after native-code, Continue-dispatch, artwork, map-data, sound-sequence, and module-conflict validation. Recognized 0.2.3 and 0.3.0–0.3.5 installations update without a second DLL. Active Main Menu Skip is refused. Failed validation or staging leaves the previous project installation intact.

Native source and build/harness tooling are maintained separately. Pokeweb ships `SaveMenuB2.dll`, `SaveMenuW2.dll`, `save-menu-map.lz`, and a generated compatibility manifest. The map installs as `ui/save-menu/map.lz` and is decoded through bounded streaming buffers.

Automated checks cover both game profiles, installer rollback, update/export/reload, hosted/LAN/loopback availability, and native code with mocked services. A White 2 Following Pokémon 0.7.44 test ROM was cold-booted in headless melonDS: the sound sequence and sprite poses tracked its tick counter, the song restarted, and B/Continue cleared it. Audible output and Black 2 running-game behavior still need emulator acceptance.

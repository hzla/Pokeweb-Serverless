# Quick Poké Ball

Install from **Code Injection → Quality of Life** in Pokeweb. The patch supports US revision-0 Black, White, Black 2, and White 2. PMC is installed automatically when needed.

The top screen shows the selected ball and quantity at the left edge during the command menu in eligible wild single battles. Tap **L** to throw. Hold **L** and press **Right/Down** or **Left/Up** to cycle through stocked balls. Releasing **L** after cycling keeps the selection. Press **B** while holding **L** to cancel the throw. A direction press suppresses a throw even if there is only one ball to select.

The shortcut cycles the retail battle Bag ball IDs whose item data still specifies the native ball action. The tab remembers the chosen ball between battles for the current play session, including after cycling without throwing. If that ball is unavailable, the tab uses an available last-used battle Bag item, Poké Ball, or the next stocked ball.

A full party and full PC boxes hide the tab. Once there is space, the tab is available in the next eligible encounter.

## Runtime

`quick_ball.c` wraps the command-menu poll, forced exit, and view teardown in battle overlay 93 for Black and White and overlay 167 for the sequels. `bw1_profile.py` binds the shared runtime to Black and White's native functions. The runtime checks battle type, command readiness and capture restrictions before accepting input. A throw uses the native item-action reservation and submission path. The battle engine handles consumption and the capture result. The ARM9 hook resets the session choice when the game creates its Bag cursor and keeps the DLL resident when the battle overlays unload.

`tab.py` builds the sprite and palettes from the retail battle Bag icons. The command menu owns one battle actor, 1 KiB of OBJ tiles and main OBJ palette bank 15. The runtime restores the bank and both native palette-fade buffers when the tab closes. It falls back to the ordinary command menu if the archive or actor cannot be opened.

## Build

Run `python3 runtime/quick-poke-ball/build.py` with Python 3, ndspy, the ARM GNU toolchain and the RPM conversion tool used by Item Expansion. For a different workspace layout, set `ARM_TOOLCHAIN_BIN` and `RPM_TOOL_JAR` for the tools, `ALETHEIA` and `POKEBW2_CONFIG` for the symbol inputs, and `BW1_ROM_B`, `BW1_ROM_W`, `QUICK_POKE_BALL_B2_ROM` and `QUICK_POKE_BALL_W2_ROM` for the retail ROMs. The script writes four DLLs, the shared graphics archive and the compatibility manifest to `src/assets/codeinjection/`.

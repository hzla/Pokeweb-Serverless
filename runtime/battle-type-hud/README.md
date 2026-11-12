# Type Icons and Move Effectiveness Preview

Two independent installers under **Code Injection → Graphical/UI Enhancements**
support checked US revision-0 Black/White and Black 2/White 2 profiles. BW1 uses
separate native bindings, graphics ownership and accepted bundles. Live DSi and
hardware behavior require separate checks; mode-aware pointer guards alone do
not establish that coverage.

Type Icons offers lettered hexagons, circular symbols and angular wedges. One
style is active at a time. Icons use live battle typing, preserve the caught
marker and hide behind status labels. Singles, doubles and triples use their
native panels. Rotation/Pokéstar icon layouts are outside the BW2 contract.
Fairy ID 17 is displayed only when the ROM already implements Fairy mechanics.

Move Effectiveness colors damaging move names in singles and rotation for
super-effective, resisted or immune matchups against the opposing active
Pokémon. Doubles and triples show the selected move name in white during
target selection. The 17-pixel-tall nameplate reuses the stock move button's
border, grid and type palette with shortened sides. Status and type-neutral
fixed-damage moves retain normal colors.
Hidden Power uses IVs.
Weather Ball, Natural Gift, Judgment, Techno Blast and Struggle stay neutral.
The nameplate body starts at (1, 172) on the touch screen. The Black 2/White 2
corner outlines extend one pixel above and below it. The nameplate sits higher
if the stock footer window contains text. All retail English names fit,
including the widest at 72 pixels.
Custom names wider than 102 pixels or taller than 13 pixels are clipped to fit.
The BG6 window is released when target selection closes.

The evaluator includes supported native type, ability, item and field immunities,
suppression and bypass checks. It reads current state, including unrevealed
abilities/items, and preserves Illusion disguise typing. It does not predict
Protect, accuracy, switches or redirection. Custom mechanics require a matching
preview adapter. Installer colors are stored at DS RGB555 precision.

Native signatures, graphics and overlapping relocations are checked before
installation. Unknown layouts fail safely. BW2 Type Icons adds no battle-heap
allocation, sprites or palette banks. The Move Effectiveness target label
uses 1,632 bytes of tile data and one otherwise empty BG palette bank during
target selection. Low memory or an occupied palette bank can suppress the
nameplate.

Build with `npm run typehud:build`; verify/sync with `npm run typehud:sync` and
`npm run typehud:verify-rom -- /path/input.nds`. Requirements are Python plus
`requirements.txt`, ARM GNU tools, Java/Javac and RPMTool. Set `BTH_TOOLCHAIN_BIN`,
`BTH_CTRMAP_JAR`, and the per-game `BTH_*_ROM` inputs. BW1 build options and native
profile data are maintained beside `build.py` and `configure_bw1*.py`.

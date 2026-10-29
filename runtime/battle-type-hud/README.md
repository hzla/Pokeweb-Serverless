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

Move Effectiveness colors damaging move names for super-effective, resisted or
immune matchups. Singles/rotation use the opposing active Pokémon; doubles and
triples show the selected move name during enemy target selection. Status and
type-neutral fixed-damage moves retain normal colors. Hidden Power uses IVs.
Weather Ball, Natural Gift, Judgment, Techno Blast and Struggle stay neutral.

The evaluator includes supported native type, ability, item and field immunities,
suppression and bypass checks. It reads current state, including unrevealed
abilities/items, and preserves Illusion disguise typing. It does not predict
Protect, accuracy, switches or redirection. Custom mechanics require a matching
preview adapter. Installer colors are stored at DS RGB555 precision.

Native signatures, graphics and overlapping relocations are checked before
installation. Unknown layouts fail safely. The BW2 renderer adds no battle-heap
allocation, sprites or palette banks; existing regular-player graphics retain
their small compatibility expansion. Low-memory/conflicting patches can still
prevent installation.

Build with `npm run typehud:build`; verify/sync with `npm run typehud:sync` and
`npm run typehud:verify-rom -- /path/input.nds`. Requirements are Python plus
`requirements.txt`, ARM GNU tools, Java/Javac and RPMTool. Set `BTH_TOOLCHAIN_BIN`,
`BTH_CTRMAP_JAR`, and the per-game `BTH_*_ROM` inputs. BW1 build options and native
profile data are maintained beside `build.py` and `configure_bw1*.py`.

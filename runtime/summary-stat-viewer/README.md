# Summary IV/EV Viewer

Independent PMC companions for checked English US revision-0 Black/White and
Black 2/White 2. Install under **Code Injection → Graphical/UI Enhancements**,
optionally disable the EV view, then export. PMC is installed automatically.
Settings survive export/reopen; recognized modules update in place. Only newly
staged DLLs can be physically removed through the card.

Left/Right follows Status → Stats → IVs → EVs → Ribbons, omitting unavailable
pages. The bar-chart footer opens IVs; tapping Stats restores normal Stats.
Session selection survives native Pokémon changes and move-detail returns.
Eggs and restricted Summary modes retain native restrictions.

The six values use native display order: HP, Attack, Defense, Sp. Atk, Sp. Def,
Speed. They are stored IV/EV values, including zeroes and EV values through 255.
The HP bar, nature colors, artwork and other native controls remain intact.
The runtime reads Pokémon data without setters and owns/releases its footer
graphics within the native Summary lifetime.

The installer checks signatures, graphics, module integrity and hook conflicts
on an isolated staged state. Compatible hacks must retain these native resources.
Other languages/revisions are unsupported. BW1 uses independent overlay-131
bindings and exact accepted bundle hashes. Live DSi/hardware behavior needs
separate testing.

Build/check with `npm run summarystats:build`, `npm run summarystats:verify` and
`npm run summarystats:verify-rom -- /path/cleanwhite2.nds`. BW1 uses
`summarystats:build-bw1` and `summarystats:verify-bw1`. Set the per-game
`SUMMARY_*_ROM`, `ARM_TOOLCHAIN_BIN` and `RPM_TOOL_JAR` inputs as needed.
Cold boot new exports; old states restore old loaded DLLs.

# Pokenav

Read-only current-area encounter browser for checked US revision-0 Black 2 and
White 2. Install under **Code Injection → Graphical/UI Enhancements → Pokenav**
and assign a Pokenav action in **More → C-Gear Buttons**. Applying the design
installs the shared viewer/C-Gear dependencies; the party LEARNSET command is
optional. Export and cold boot with an ordinary save.

The lower panel shows the active map's seasonal Surf, Rod and Grass methods.
D-pad/touch selects icons and folders; L/R changes method within the selected
section and skips empty methods. Each method remembers its selection until exit.
A pages evolution requirements. B or the native return/close control exits.

Duplicate species/form slots merge into one icon. The top panel shows species
data and the sum of that entry's native slot weights. All species are revealed;
the base chance precedes Repel, abilities and other encounter modifiers. Optional
Nuzlocke filtering grays excluded families and adjusts the displayed chance.

The launcher snapshots the native 232-byte active-season table. The viewer owns
temporary fonts, icon/data caches and surfaces for the session and uses a private
PK5 shell without changing party or save data. Missing/empty encounters remain
dismissible. Unknown field layouts or conflicting hooks are rejected.

Build/check with `npm run pokenav:build`, `npm run pokenav:verify` and
`npm run pokenav:verify-rom -- /path/cleanwhite2.nds`. Native benchmarks require
copied fixtures, local melonDS bindings and a headless library. Other games,
hardware and DSi behavior need separate verification.

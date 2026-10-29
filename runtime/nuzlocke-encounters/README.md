# Nuzlocke Style Encounters

Filters caught evolution families from native encounter tables in checked US
revision-0 Black 2/White 2. Install under **Code Injection → Feature Add-Ons**,
export and cold boot. Pokenav is optional; this does not install C-Gear or enable
the LEARNSET command. BW1 and arbitrary native encounter/save rewrites are
unsupported.

Any family member ever registered as caught excludes its connected family,
including released/traded Pokémon. Seen-only entries do not count. Connections
and forms come from the ROM's Personal/evolution data. Remaining slots keep their
relative probability. If every slot is excluded, the default prevents encounters;
an optional setting retains the original distribution instead.

Pokenav shows excluded icons in gray at 0% and normalizes eligible base chances.
These percentages precede Repel, abilities and other native modifiers. Whole
percentages may not sum exactly to 100. Static/roaming encounters, Hidden Grottoes,
gifts and scripted battles are outside the patch.

The overlay-36 DLL uses bounded cached graph/configuration data under
`nuzlocke/encounters.narc`. Caught status refreshes through the native save API.
Malformed/missing data or allocation failure falls back to native selection.
Disable retains settings and restores native selection after a cold boot.

Build/check with `npm run nuzlocke:build`, `npm run nuzlocke:verify` and
`npm run nuzlocke:verify-rom -- /path/cleanwhite2.nds`. Gameplay/hardware behavior
requires its own checks beyond compiled and export tests.

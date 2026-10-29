# Learnset Viewer

Read-only LEARNSET party command for checked US revision-0 Black/White and
Black 2/White 2. BW1 uses separate companions and acceptance-gated profiles;
live DSi behavior requires separate testing. The bundled implementation is C++;
the [Ruby port](../ruby-patches/learnset/README.md) is experimental.

LEARNSET appears before Cancel when the native eight-slot menu has room. Eggs,
battle/daycare and item/mail requests retain native restrictions. The upper panel
shows ROM species/form data, types, abilities, base stats and evolution family;
the lower panel lists level-up moves and PP. L/R browses family, D-pad Left/Right
changes party member, and A pages evolution requirements. Browsing never teaches
moves, evolves Pokémon or spends items; RELEARN remains native.

Two companions share private text IDs without replacing tutor strings. Installer
staging is atomic; updates preserve private IDs and edited text. Only newly staged
modules can be physically removed. BW2 companions also host Pokenav's separate
encounter mode without requiring the party command to be enabled.

Build with `npm run learnset:build` or `npm run learnset:build-bw1`. Run
`python3 runtime/learnset-viewer/verify_runtime.py`, `verify_info.py` and
`verify_graphics.py` for BW2, or `npm run learnset:verify-bw1` for BW1.
`npm run learnset:verify-rom -- /path/cleanwhite2.nds` checks installation/export.
Cold boot new exports; compiled checks do not establish complete game acceptance.

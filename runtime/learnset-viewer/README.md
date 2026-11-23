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

Choose **Classic** or **Three cards** in Code Injection under **Party Menu
Learnset/Dex Viewer**, then install, update, or apply the layout. Three cards
uses eight-pixel gaps between the upper panels and extends the grid behind
the move list. Both layouts display PP as `15 PP`. Three cards colors the
stat bars by base stat. A stat of 150 fills 36
of 46 pixels, with the last 10 pixels covering 150–255. BW2 Classic also uses
this scale. New installs default to Three cards. Updates preserve the installed
layout.

Two companions share private text IDs without replacing tutor strings. Installer
staging is atomic; updates preserve private IDs and edited text. Only newly staged
modules can be physically removed. BW2 companions also host Pokenav's separate
encounter mode without requiring the party command to be enabled.

Build with `npm run learnset:build` or `npm run learnset:build-bw1`. Run
`python3 runtime/learnset-viewer/verify_runtime.py`, `verify_info.py` and
`verify_graphics.py` for BW2, or `npm run learnset:verify-bw1` for BW1.
`npm run learnset:verify-rom -- /path/cleanwhite2.nds` checks installation/export.
Cold boot new exports; compiled checks do not establish complete game acceptance.

## Editable Three Cards graphics

On Black and White, the installer adds `pokeweb/learnset-three-cards.narc`
when you select Three cards. Open or replace it in the exported ROM's
filesystem with a Nintendo DS graphics editor. It contains `tiles.ncgr`,
`screen.nscr`, and `palette.nclr` in that
order. The 4bpp artwork uses a 256×256 tilemap with 256×192 visible pixels.
Use at most 895 tiles and keep visible map entries in palette banks 8, 9,
13, and 14. The palette has 16 banks. The runtime uses the same palette banks
for dynamic elements, so palette changes can affect both the art and text.
Keep the text and icon areas aligned with the viewer's fixed positions.

The runtime uploads the static layer to BG3 when the viewer opens. Five
dynamic BG2 regions share one 6 KiB drawing buffer. The software renderer is
the fallback for missing or incompatible art. Layout changes and installer
updates keep existing artwork edits.

## Editable Three Cards prototype (BW2)

Build and export from the project root using separate prototype output
directories. The prototype uses the same editable file format.

```sh
LEARNSET_TILED_PROTOTYPE=1 \
  LEARNSET_BUILD_DIR=runtime/learnset-viewer/build/tiled \
  LEARNSET_ASSET_DIR=runtime/learnset-viewer/build/tiled/assets \
  npm run learnset:build
npx vite-node runtime/learnset-viewer/prepare_three_card_prototype.ts \
  INPUT.nds runtime/learnset-viewer/build/tiled/assets OUTPUT.nds
```

The prototype reserves 302 KiB for Three Cards when the graphics archive is
present. Classic, Custom UI, PokéNav, and native tutor sessions use the retail
320 KiB reservation. The 18 KiB difference is available to the game's user
heap while the viewer is open. PMC allocates its arena separately at boot.

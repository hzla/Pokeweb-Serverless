# Fairy Type Support (Black / White)

Black / White get Fairy as type 17 from Frost's Black patch (`Black1Fairy.Vpatch`), applied through the same patch
reader as Black 2 / White 2's (`src/pokeweb/generalPatchModel.ts`). Black uses it unchanged, as
`src/assets/patches/fairy-b.bin`. White uses `fairy-w.bin`, which `build.py` derives from the Black patch.

## What the patch does

- **Overlay 93 (battle).** Gains a 0x2100-byte prefix and is loaded 0x2100 lower, so the retail code keeps its
  addresses. The prefix holds:
  - the move-handler table, moved there with room for 384 entries,
  - a move-animation routing helper,
  - an 18x18 type chart.
- **The "typeless" tests.** Moved from 17 to 18 in nine places: the damage calculation, type effectiveness,
  `GetTypes` / `HasType`, the type chart lookups, Color Change and Conversion 2.
- **Overlay 94.** The move-animation caller (Frost's routing; Pokeweb's Move Expansion recognises it).
- **Fairy in menus and screens:**
  - the summary screen's type icons (overlay 131),
  - Hall of Fame (overlay 180),
  - one value in overlay 208,
  - the type icons' palette table in ARM9.
- **Graphics and text.** The type names (text 199), the type icons, the move reminder graphics and a Fairy palette
  for the move buttons (`a/0/1/1` member 222).

## How the White patch is derived

White's overlays are Black's at addresses 0x20 higher, with the same contents. aletheia matches every function of
these overlays at Black + 0x20, and the files differ only in relocated words. So `build.py` builds White's patch from
Black's:

- **Overlay table entries:** taken from White's own table and changed the way the Black patch changes Black's. The
  script checks that the same change reproduces the Black patch's entries.
- **Pointers the patch writes** (and the 258 handler addresses in the prefix): +0x20.
- **The ARM9 palette byte:** written at White's table, which is found by its retail bytes.

For every edited span, the script checks that Black's and White's retail bytes are equal, except for the known
pointer words. The NARC members the patch replaces are identical in both games' retail ROMs.

    python3 runtime/fairy-bw1/build.py --black-patch Black1Fairy.Vpatch --black clean_black.nds --white clean_white.nds

## Effect runtimes

Pokeweb's ability and move effect runtimes find battle functions by signature. Black's signatures already had Frost
variants for the functions the patch edits. `white_binding_variants.py` gives White's signatures the same variants
(`abilityBindingsW1.json`, `moveRecipeBindingsW1.json`). It checks that each changed byte is masked in and the same in
both games.

## Install order

- **Mega Evolution:** installs Fairy Type Support first (with the modern typings), then Move Expansion.
- **Move Expansion:** installs it first too, as on Black 2 / White 2.
- **Fairy after Move Expansion:** also works.
  - Pokeweb's routing accepts Frost's overlay 94 caller.
  - Export re-applies Move Expansion's overlay 94 load size.

## Verified (desmond, `emulator.ts`)

On Black and on White, with the modern typings applied:
- Garchomp's Dragon Claw "doesn't affect the foe's Clefable".
- Charm's move button shows the Fairy colour and icon.

With the Mega install:
- Mega Gardevoir is Psychic/Fairy with Pixilate.
- Charizard → Mega Charizard X still works with Fairy and Move Expansion.
- An expanded move's animation still hides the text box.

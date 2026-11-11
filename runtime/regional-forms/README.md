# Regional Forms (Black, White, Black 2, White 2)

The Code Injection card **Regional Forms** (Major Features/Expansions, next to Mega Evolution, localhost only) adds
the 54 Alolan, Galarian, Hisuian and Paldean forms of species 1-649 as added forms of their species. They are
grouped in 34 families, and the card lists them with a checkbox each, all checked. Uncheck a family you already made
your own forms for: the card marks families whose species already have added forms. Installing again adds only the
forms that are missing. The forms are found by their names ("Rattata-Alola").

## What each form gets

- **From White2Upgrade's `data/pml`:**
  - stats and types
  - abilities
  - held items, gender, egg data, colour, height and weight
  - TM and tutor compatibility (White2Upgrade keeps retail's TM and tutor layouts)
  - level-up moves
  - evolutions
- **From the PWAN library:** the animated sprites and icon (`src/assets/pwan/library`, the "regional form" entries).
- **A name:** "Rattata-Alola" or "Tauros-Paldea-Combat", in the Pokémon name bank at the form's personal record.

## Dependencies, installed first

- **Fairy Type Support**, for Alolan Ninetales, Galarian Rapidash and Galarian Weezing.
- **Move Expansion**, for the 41 newer moves in the learnsets.
- **The animated sprite runtime.**
- **Evolution by form** (`runtime/form-evolution`).

## Galarian Darmanitan's Zen Mode

Retail's Zen Mode switches Darmanitan between forms 0 and 1 (Standard and Zen Mode), so on its own it would turn a
Galarian Darmanitan into the standard one. With the Darumaka family, the installer adds `RegionalZenMode<game>.dll`
(the battle overlay; `src/zen_mode.c`), which keeps retail's handlers and maps the Galarian pair:

- the turn-end check reads a Galarian Darmanitan's form as 0 or 1, as if it were the standard pair;
- the form change it sends becomes Galarian Zen Mode for 1 and Galarian for 0. Losing the ability (Gastro Acid)
  gives the Galarian form back too. Switching out restores the form it started the battle with.

The installer writes the two Galarian forms' numbers into the DLL (at its `PWZN` mark). After the battle, the game
writes back the form the Pokémon started with, as for the standard Darmanitan. Galarian Darmanitan's hidden ability is
Zen Mode. Its other slots are Gorilla Tactics, which the ability library can't add, so they keep the base form's
Sheer Force.

Rebuild the DLLs with `python3 runtime/regional-forms/build.py` (inputs as `runtime/form-evolution/build.py`'s). This
writes them and `regionalZenModeManifest.json` to `src/assets/codeinjection`.

## When something is missing

- **Abilities.** One the ability library can't add (Mimicry, Wandering Spirit, Cud Chew ...) keeps the base form's
  ability in that slot. The report lists them.
- **Moves.** One the ROM doesn't have is left out of the learnset. With Move Expansion, none are.

## Evolutions

Each form evolves into its own evolution: Alolan Rattata into Alolan Raticate, and Galarian Darumaka into Galarian
Darmanitan, which is Darmanitan's form 2. A target that is a regional form names that form's personal record.

- **Evolutions into newer Pokémon are left out.** Perrserker, Sirfetch'd, Obstagoon, Mr. Rime, Cursola, Runerigus,
  Overqwil, Sneasler and Clodsire don't exist here.
  - When the base species does evolve, the form gets an evolution that can't happen ("use item 0"). So Galarian
    Meowth, Galarian Yamask, Hisuian Sneasel and Paldean Wooper don't evolve.
- **The Ice Stone forms** (Alolan Vulpix and Sandshrew, Galarian Darumaka) evolve by their base species' method:
  Fire Stone, level 22 and level 35. White2Upgrade uses the Water Stone instead.
- **Galarian Slowpoke** evolves at level 37 into Galarian Slowbro, and by a King's Rock trade into Galarian Slowking.
  These are White2Upgrade's stand-ins for the Galarica items.
- **Forms of a later stage** that evolve from the base form in their region are not reached by evolution. These are
  Alolan Raichu, Exeggutor and Marowak, and Hisuian Typhlosion, Samurott, Lilligant and Braviary.

## Rebuilding the package

    python3 runtime/regional-forms/content/build_content.py --w2u <White2Upgrade-w2-integration>

This writes `src/assets/data/regionalForms.json`.

## Emulator check

The check uses a local clean ROM and the desmond emulator.

    npx vite-node runtime/regional-forms/emulator.ts ROM.nds [--team TEXT] [--foe TEXT] [--families 19,554] [--frames N] [--after STEPS]

By default, an Alolan Rattata one EXP point short of level 20 knocks out a level 5 Chansey and then evolves. The
captures are written to `build/emulator/<label>/`. `--after` runs button, touch and capture steps once the battle is
done (to open the party or the Pokédex, say).

## Verified (2026-11-11)

**On White 2:**
- Alolan Rattata became Alolan Raticate.
- Galarian Darumaka (34 to 35) became Galarian Darmanitan.
- Galarian Meowth grew to 28 without evolving.

**On White:** Galarian Darumaka became Galarian Darmanitan.

**On Black 2 and Black:** the install and a battle ran without faults.

**Zen Mode** (a level 20 Galarian Darmanitan with Zen Mode against a level 40 Shuckle using Seismic Toss): it became
Galarian Zen Mode below half HP and won.
- On White 2, its party icon after the battle was Galarian Darmanitan again.
- Checked on White 2, White, Black 2 and Black.

**The Pokédex** (White 2, after a battle against a Galarian Darmanitan and an Alolan Raticate):
- The National Pokédex list, Darmanitan's and Raticate's Info, Area, Cry and Forms pages opened, and the Pokédex
  closed, without faults.
- They show the standard forms: the Pokédex keeps its own table of the species with forms and how many each has
  (Darmanitan two, Raticate none). It clamps any other form to 0 when it registers one. The added forms are never
  recorded or shown. Black and White's Pokédex has the same table and clamp.

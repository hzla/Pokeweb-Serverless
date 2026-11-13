# Species Expansion (Black 2, White 2)

The Code Injection card **Species Expansion** (Major Features/Expansions, after Regional Forms, localhost only) adds
the Pokémon after Genesect as new species: national 650-1023 for now (1024 and 1025 follow), with their Pokédex entries. Phases 1 and 2 of the 1025-species port
(`claude/species-1025-expansion-feasibility.md` in the project).

## Numbering

Retail uses species 650 (Egg), 651 (Bad Egg), 652-684 (the Pokéstar Studios actors) and 685-686 (two more Egg
names), and checks for an Egg against 650 in many places. The added species keep all of that: **ROM species =
national + 37**, so Chespin is 687 and Iron Crown 1060 (Pecharunt will be 1062). The summary's and the PC's "No." show
the national number, and so does Pokeweb (the Pokémon editor's card and the list's tooltip).

## What the installer changes

- **Records at the species' own number**, as retail's are: personal, learnset and evolution records, the three name
  banks (90 names, 483 with article, 486 upper case), baby species (a/0/2/0) and egg moves (a/1/2/4, empty).
- **Form records move:** retail's form records (685-708), the regional Pokédex table (personal 709) and every form
  added since move 378 files later (1063 onwards; the table is 1087 and grows to 1063 entries). The owners' first-form
  fields, evolution targets that name a form record, the name bank's form names and the Regional Forms record follow.
- **Sprites and icons:** each species gets a sprite block after the existing ones (and its icon at that block), filled
  from the PWAN library. Goodra uses Sliggoo's art until its own is in the library.
- **Overlay 36:** the field's party check (`CheckResetKeldeoOrdinaryForme`, at every map start and end) corrupts a
  Pokémon whose species is above 649 (two 0xFF bytes in its encrypted data: a bad egg). Its limit is raised to the last
  added species.
- **The Pokédex** (`speciesExpansionDexModel.ts`): descriptions, heights, weights (banks 442, 451, 471; retail's form
  entries at 650-732 move to 1063 onwards) and categories (464) from White2Upgrade's text; the search lists (a/0/9/7:
  the form chain and shapes follow the moved form entries, initials, national and alphabetical order, height and
  weight orders with the added species, entries now `species | form << 11`); footprints (a/1/6/5) and area files
  (a/1/7/6, "not found") for the added species. Footprints and shapes are placeholders (the cry stand-in's).
- **Overlay 302:** the search filter reads 11-bit species, and the national list's length is 649 + the added species.
- **Dependencies, installed first:** Fairy Type Support, Move Expansion and the animated sprite runtime.

## The runtime (`src/species.c`, `build.py`)

`SpeciesExpansion<game>.dll` (resident) replaces, for the added species:

| Function | What the added species get |
| --- | --- |
| `GetPokemonDataIDBase` | the table's sprite block (retail's form sprites start at block 685, so `species * 20` can't be used) |
| `PokeParty_GetIconIndex`, `PokeIcon_GetPalette` | the icon and palette at that block |
| `getResIDFunc`, `getWaveInfoFunc` | a retail species' cry (a placeholder: same type and stage, closest base stat total) |
| `PML_PersonalLoadRegionalDexTable` | the moved table (file in the table header) |
| `Regulation_CheckParamBit` | battle rules: legendaries and mythicals banned where the rules ban Mewtwo, the rest allowed (the banned-species bits stop at 655) |

Outside the added species each does what retail does (pokebw2's decomp). `GetPokemonDataIDBase` and
`getWaveInfoFunc` take arguments on the stack, so they use `THUMB_BRANCH_SAFESTACK`: libRPM's plain branch moves the
stack, which shows as "An error has occurred" when a battle starts.

The resident DLL also replaces `pokedex.c`'s save functions (`initPokedex`, `PokeDex_IsCaught`, `PokeDex_IsSeen`,
`addToDex`, `PokeDex_GetShownSexRareForm`, `PokeDex_HasSeenVariant`, `addPkmToDex`, `PokeDex_RegistPkm`, the counts,
`PokeDex_IsCompleteNational`, the last species) for the save layout below.

`SpeciesExpansionDexList<game>.dll` (overlay 299) rewrites the list's set-up (the list no longer keeps every name: a
row loads its name when drawn, so 1023 rows cost no more heap than 649) and prints four-digit numbers and counts;
`SpeciesExpansionDexSearch<game>.dll` (overlay 302) loads the national list and the sort orders;
`SpeciesExpansionDexInfo<game>.dll` (overlay 296) prints the entry's number.

`SpeciesExpansionSummary<game>.dll` (overlay 207) and `SpeciesExpansionBox<game>.dll` (overlay 255) wrap the
`WordSetNumber` call that prints the Pokédex number: an added species prints its national number (four digits from
1000).

The installer writes the table at the core DLL's `PWSX` mark: `{u16 version, u16 count, u16 regional Pokédex file,
u16 reserved, {u16 sprite block, u16 cry species | 0x8000 if restricted | 0x4000 if mythical}[400]}`. Pokeweb reads
it back when it loads a ROM.

## The Pokédex save

Save block 54 keeps retail's size (0x4dc bytes). Its bit lists are by national number - 1: retail's (caught at 0x08,
seen ×4 at 0x5c, shown ×4 at 0x1ac, 0x54 bytes each) hold 1-672, and 673-1025 are nine lists of 45 bytes (caught,
seen ×4, shown ×4) in the area retail keeps for the other languages' entries (0x328, 0x1b0 bytes), whose last word is
the mark `PWDX`. A save without the mark (any retail save) has the area cleared on first use, so existing saves load
as they are: the only loss is the "other languages" flags, which the expansion's Pokédex doesn't show. There is no
save converter. `speciesExpansionSaveModel.ts` reads and writes the layout (`editPokedexSave`).

`sample-save.ts` writes a sample save (`samples/SpeciesExpansion.sav`, raw 512 KiB; the same file for White 2 and Black 2)
from the bundled test save:
the national Pokédex with every species (1-1023) caught, and a party of added species (Greninja, Decidueye,
Cinderace, Sylveon, Dragapult, Meowscarada, level 50). Load it with a ROM that has the expansion installed: verified on
White 2 and Black 2 (the full list to Iron Crown, entries, the search and its orders, the party).

```sh
python3 runtime/species-expansion/build.py [--game W2|B2] [--test]
python3 runtime/species-expansion/content/build_content.py --w2u /path/to/White2Upgrade
npx vite-node runtime/species-expansion/emulator.ts /path/clean.nds [--team TEXT] [--foe TEXT] [--retail] [--watch auto] [--dex] [--save PATH] [--last SPECIES]
npx vite-node runtime/species-expansion/sample-save.ts /path/clean-white2.nds
```

The emulator check installs on a clean ROM, checks the staged and reloaded data, then runs a test battle: Chespin,
one point short of level 16, beats a Chansey and evolves into Quilladin. Verified on White 2 and Black 2: battle
sprites (Chespin, Iron Crown), evolution, party icon and plate, summary (No. 651, sprite, type, ability). `--dex`
gives the save the national Pokédex with national 650-655 caught and Iron Crown seen, for checking the Pokédex.

## Not yet done

- Real footprints and body shapes for the added species; their area maps are empty.
- Other screens that print Pokédex counts in three digits (the trainer card, the start of the Pokédex).
- Goodra's art; national 1024 and 1025 (from pokebw2's assets).
- White2Upgrade's other guards: Join Avenue keeps a species in 10 bits (species above 1023 would show as another),
  Funfest missions and C-Gear beacons, the trade screen's initials table, Dream World flags, battle video headers.
- The PC's "No." is not yet checked in the emulator.

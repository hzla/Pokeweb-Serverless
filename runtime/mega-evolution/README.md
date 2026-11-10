# Mega Evolution (Black 2 / White 2)

A standalone PMC runtime for Mega Evolution, installed from **Code Injection → Feature Add-Ons → Mega Evolution**
(`src/pokeweb/megaEvolutionModel.ts`). One DLL per game, `PokewebMega{W2,B2}.dll`, scoped to battle overlay 167:
PMC loads it with the battle and drops it afterwards, so its state starts clean in every battle.

## Credits

- **Dararo**: the original Mega Evolution implementation (White2Upgrade).
- **Hibiki**: the battle UI (the move-screen MEGA button and its graphics, `src/button_assets.h`) and the
  transformation animation.

This runtime ports their work from White2Upgrade's `w2u_mega.cpp` onto the native hook points that pokebw2's decomp
identifies, without White2Upgrade's other systems.

## Behaviour

- A route is `{species, trigger, sourceForm, targetForm, moveTrigger}`: the Pokémon in `sourceForm` holding the
  trigger item (or knowing the trigger move) can change into `targetForm`. The Mega form must exist in the personal
  data (Add Form in the Pokémon editor), or the runtime ignores the route.
- One Mega Evolution per trainer per battle (in a Multi Battle each trainer has their own). The player arms it on the
  move screen with START or the MEGA button on the touch screen (shown only when the Pokémon can Mega Evolve; pink
  while armed). Every trainer the game controls (opponents and partners, `IsClientNPCTrainer`) Mega Evolves the
  first Pokémon that can, on its first turn of fighting (option `autoFoes`, on by default); wild Pokémon never do.
- The Mega form's ability comes from the same slot (first, second or hidden) as the Pokémon's own ability in its
  base form; a Mega with one ability has it in every slot.
- Generation 7 order: all chosen Megas happen just before the turn's first move (after switches, items and running),
  in the current order. The remaining actions are then ordered again (`ActionOrder_RecalcAndSort`), so the Megas'
  speed and abilities (Prankster, Gale Wings...) count for the turn they Mega Evolve.
- The sequence: "reacting" message, ability-change events, the form change (`ChangeForm`, then the client's form
  change command, which plays the animation), "has Mega Evolved", the new ability, its entry effect.
- The form lasts until the battle ends: the Mega's form and ability become the Pokémon's base ones, so the native
  resets on switching or fainting keep it. When the battle hands the party back (`BattleMon_WriteToSrc` with
  `keepBaseForm`), the Pokémon gets its own form and ability back. The original ability comes from the runtime's
  record, or, failing that, from the base form's personal data and the Pokémon's ability slot.
- Mega Stones can't be removed, swapped, stolen or knocked off the species they are for.
- The transformation plays `animationMove` through `BtlvScu_StartMoveEffect` (with battle animations on) and swaps
  in the Mega sprite at `revealFrame` (244 for Hibiki's animation). With `animationMove` 0, or animations off, the
  sprite changes at once.

## Hooks (overlay 167)

| Hook | Kind | Purpose |
|---|---|---|
| `BtlServerFlow_RunTurn` → `ActionOrder_Build` | call | a new turn is pending |
| `ActionOrder_Run` → `ActionOrder_Proc` | call | before the first move: Megas, then re-order |
| `ChangeForm` | replace | retail, then the Mega's ability, base form and weight (server and client copies) |
| `BattleMon_WriteToSrc` | replace | retail, after restoring the party's own form and ability |
| `GiratinaArceusGenesectItemCheck` | replace | retail, plus Mega Stones |
| `BattleClient_ActionSelectFight` → `BtlvCore_WaitMoveSelect` | call | START / touch button, the form travels in the fight action's spare bits 27–31 |
| `BtlvCore_StartFormChange`, `BtlvCore_WaitFormChange` | replace | the transformation animation |

Retail calls and data are absolute symbols (see the item expansion's `build.py`), so the DLL's only extern module is
overlay 167. The Move Effectiveness preview's `BTLV_INPUT_CheckKey` hook is untouched: the MEGA button is polled
separately, which is how this runtime coexists with it. White 2 Upgrade / Black 2 Upgrade carry their own Mega
Evolution; the installer refuses to run beside them, and beside any DLL that patches the same code.

## Table (`PWMG`, version 1)

Patched by Pokeweb on install, on every route edit and before export:
`magic, version u16, count u16, msgReacting, msgEvolved, msgWish, animationMove, seArm, seDisarm, revealFrame,
options` (u16 each), then 192 routes of `species u16, trigger u16, sourceForm u8, targetForm u8, flags u8 (1: move
trigger), reserved u8`.

## Build and check

    POKEBW2_CONFIG=... POKEBW2_EXTRACT=... ARM_TOOLCHAIN_BIN=... RPM_TOOL_JAR=... python3 runtime/mega-evolution/build.py
    python3 runtime/mega-evolution/build.py --test-routes   # a DLL with built-in test routes, build/ only
    npx vite-node runtime/mega-evolution/emulator_battle.ts /path/clean.nds [--giratina] [--touch] [--dll path]

The emulator check installs through the model with two test routes that need no content: Rotom holding Leftovers
changes into Heat Rotom (types, stats), Giratina holding Leftovers into Origin Forme (ability Pressure → Levitate,
weight). It arms the Mega with START (or the button with `--touch`), finishes the battle, saves in the field and
reads the party back.

Verified in desmond (White 2 and Black 2): the button appears and arms, the Pokémon changes form on both the server's
and the client's copy (types, stats, ability, weight, sprite), and after the battle and an in-game save the party has
its own form and ability back. Not yet verified: opposing trainers' Megas, doubles/triples, hardware.

## Mega Pokémon (content package)

`src/pokeweb/megaContentModel.ts`, installed by the card's one **Install Mega Evolution** button, which also installs
Item Expansion, the PWAN runtime and this runtime when missing. From `src/assets/data/megaContent.json` + `src/assets/mega/megaContent.zip`
(built by `content/build_content.py` from pokebw2's `res/w2u` data and White2Upgrade's assets; White2Upgrade icons
via `content/extract_w2u_icons.py`):

- 71 Mega forms of species 1-649 (`addPokemonForm`, then stats, types, abilities, height, weight from pokebw2's
  `mega_roster.json`). Abilities above 164 are matched by name or created from Pokeweb's ability library (Tough
  Claws, Mega Launcher, Parental Bond, Aerilate, Pixilate, Strong Jaw, Refrigerate); Delta Stream has no template
  (Mega Rayquaza keeps its base ability). Fairy needs the Fairy type patch, otherwise the base type stays.
- Mega Stones at their pokebw2 IDs (657-780, Item Expansion): White2Upgrade's item data (no price, no effect),
  names, plurals, articles, a description, White2Upgrade's icons (the Legends Z-A stones use the Mega Ring icon).
- Animated sprites: Pokeweb's PWAN library entry (with its icon), plus White2Upgrade's PWAN files for the Megas or
  sides the library lacks. Sprite credits are per side; the ones without a credit record are "Unknown" (Mega
  Venusaur, Blastoise, Aerodactyl, Sceptile, Sharpedo, Camerupt, Metagross; the backs of Mega Pidgeot, Houndoom,
  Sableye and Gallade). The card lists every credit.
- Battle messages (bank 18, player / wild / foe triplets): "reacting to [trainer]'s Mega Ring", "has Mega Evolved",
  the fervent wish.
- Hibiki's transformation animation (White2Upgrade's script 622 and SPAs 765, 767, 770, 771, 783). Without Move
  Expansion the script is appended to the battle-effect archive `a/0/6/6` (115 members retail, so member 115) and
  played as effect ID 0x231 + member (676): the retail effect VM reads `a/0/6/6` for IDs from 0x231. With Move
  Expansion it goes past member 1,000 of `a/0/6/5` and plays as its ID + 115 (the expansion's routing). Projects
  whose Mega Pokémon were installed without the animation get it from the card's Update button
  (`stageMegaAnimation`).
- With Move Expansion: Mega Rayquaza (Dragon Ascent).
- One route per Mega.

Verified in desmond (`emulator_content.ts`, White 2 and Black 2): the install adds 70 forms and 70 stones without
Move Expansion (Mega Rayquaza skipped) and 71 with it; Charizard holding Charizardite X becomes Mega Charizard X
(Fire/Dragon, Tough Claws, stats) with its PWAN sprite, the "reacting to Red's Mega Ring" message and Hibiki's
animation (with and without Move Expansion); with `--foe`, the trainer's Charizard holding Charizardite Y Mega Evolves on its own
(Drought, stats). In desmond the intact sphere of the animation shows dark for a moment in both games; check it on
hardware or melonDS before tuning the SPAs. The install takes about 15-30 seconds.

Not included yet: the Mega glyph over the Pokémon (Hibiki's animation no longer draws the Mega symbol itself;
White2Upgrade's MegaB2W2 extras draw it, White 2 only), the Mega cry and HP-bar icon, the battle summary's Mega
ability.

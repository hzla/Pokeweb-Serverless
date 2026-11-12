# Mega Evolution (Black 2 / White 2, Black / White)

A standalone PMC runtime for Mega Evolution, installed from **Code Injection → Major Features/Expansions → Mega Evolution**
(`src/pokeweb/megaEvolutionModel.ts`). The card is shown only on localhost (`canUseMegaEvolutionInstaller`, the
same rule as Map Studio); projects that already have it keep working and exporting elsewhere. One DLL per game,
`PokewebMega{W2,B2}.dll` scoped to battle overlay 167 and `PokewebMega{B,W}.dll` scoped to Black / White's battle
overlay 93: PMC loads it with the battle and drops it afterwards, so its state starts clean in every battle.

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
- The player needs the Mega Ring (the key item `ringItem`, 124; the Mega content install adds it) in the bag: without
  it the MEGA button is not shown and START does nothing. The bag is checked once per battle (`GetBagSave` /
  `BagSave_CheckAmount`; Black / White: `BattleSetupParam.myItem`, `MYITEM_SAVEDATA_HasItem`). The trainers the game
  controls don't need it. `ringItem` 0 turns the check off.
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

## Black / White (overlay 93)

The same `src/mega.c`, built with `PW_BW1`: `src/mega_bw1.h` maps every retail call to its Black / White function
(aletheia's names; each checked against aletheia's source) and two structure offsets differ (`BtlvCore`'s scene unit
at 0x17c, the hand-ex scope word at 0x1d74). The hook points are the same; Black / White's
`BTLV_CORE_StartMonSpriteChange` / `WaitMonSpriteChange` are 28- and 16-byte thunks, so the form change is redirected
at their one call site in `BTL_CLIENT_CmdChangeForm` instead of at their entries:

| Hook | Kind |
|---|---|
| `BTL_SERVER_FLOW_StartTurn` → `BTL_SERVER_FLOW_BuildActionOrder` | call |
| `BTL_SERVER_FLOW_RunActionOrder` → `BTL_SERVER_FLOW_ProcAction` | call |
| `BTL_POKEPARAM_ChangeForm`, `BTL_POKEPARAM_WriteBackToParam`, `HAND_COMMON_IsItemBoundToSpecies` | replace |
| `BTL_CLIENT_StepSelectMove` → `BTLV_CORE_PollMoveMenu` | call |
| `BTL_CLIENT_CmdChangeForm` → `BTLV_CORE_StartMonSpriteChange`, → `BTLV_CORE_WaitMonSpriteChange` | call |

Server commands (0x4f form change, 29 ability, 0x5b "set" message), ability/item IDs, Pokémon and personal parameter
IDs, sound effects, the touch-rectangle format, `BattleMon` / `BtlServerFlow` / action-word layouts are the same as
Black 2 / White 2's. Overlay 95 (`BTL_ID_IsArceusPlate`, `BTL_ID_IsGenesectDrive`) loads out of BL range, so those two are
`long_call`s. The Black 2 / White 2 DLLs build byte-identical with the shared source.

## Table (`PWMG`, version 2)

Patched by Pokeweb on install, on every route edit and before export:
`magic, version u16, count u16, msgReacting, msgEvolved, msgWish, animationMove, seArm, seDisarm, revealFrame,
options, ringItem, universalItem` (u16 each), then 192 routes of `species u16, trigger u16, sourceForm u8, targetForm u8, flags u8 (1: move
trigger), megaClass u8`. Version 1 (no `ringItem`, routes at +24) is still written for a project whose staged DLL
predates version 2, until its Update button stages the new DLL.

## Universal stones (DLL version 3)

`universalItem` is the first of five consecutive item IDs: Megite, Megite X, Megite Y, Megite Z and Megite G. A route
whose `megaClass` is n (1-5) is also triggered by item `universalItem + n - 1`, whatever its own trigger (a stone or
Mega Rayquaza's move). Such a stone is protected from Knock Off and Trick like the route's own stone. When a
move-triggered route is taken with a universal stone, the "reacting" message is shown.

Pokeweb sets the class whenever it writes the table. It reads the class from the name of the route's Mega form:
- "-Mega" → 1, "-Mega-X" → 2, "-Mega-Y" → 3, "-Mega-Z" → 4 and "-Mega-G" → 5;
- or the package's "Mega Charizard X" form.

So Megas added in the Pokémon editor work with the Megites when they are named that way. The table stays version 2:
a version 2 DLL ignores both fields, and `universalItem` 0 turns them off.

## Build and check

    POKEBW2_CONFIG=... POKEBW2_EXTRACT=... ARM_TOOLCHAIN_BIN=... RPM_TOOL_JAR=... python3 runtime/mega-evolution/build.py
    python3 runtime/mega-evolution/build.py --test-routes   # a DLL with built-in test routes, build/ only
    ALETHEIA=... BW1_ROM_B=... BW1_ROM_W=... python3 runtime/mega-evolution/build.py --game B --game W
    npx vite-node runtime/mega-evolution/emulator_battle.ts /path/clean.nds [--giratina] [--touch] [--dll path]
    npx vite-node runtime/mega-evolution/emulator_content.ts /path/clean.nds [--foe] [--no-animation] [--native] [--no-move-expansion] [--gmax] [--team TEXT --species N]

The emulator check installs through the model with two test routes that need no content: Rotom holding Leftovers
changes into Heat Rotom (types, stats), Giratina holding Leftovers into Origin Forme (ability Pressure → Levitate,
weight). It arms the Mega with START (or the button with `--touch`), finishes the battle, saves in the field and
reads the party back.

Verified in desmond (White 2 and Black 2): the button appears and arms, the Pokémon changes form on both the server's
and the client's copy (types, stats, ability, weight, sprite), and after the battle and an in-game save the party has
its own form and ability back. The same on Black (START) and White (touch button; Giratina's Pressure → Levitate).
Not yet verified: doubles/triples, hardware.

## Mega Pokémon (content package)

`src/pokeweb/megaContentModel.ts`, installed by the card's one **Install Mega Evolution** button, which also installs
Move Expansion, Item Expansion, the PWAN runtime and this runtime when missing. From `src/assets/data/megaContent.json` + `src/assets/mega/megaContent.zip`
(built by `content/build_content.py` from pokebw2's `res/w2u` data, Pokeweb's PWAN library and White2Upgrade's item
icons and animation):

- 71 Mega forms of species 1-649 (`addPokemonForm`, then stats, types, abilities, height, weight from pokebw2's
  `mega_roster.json`). Abilities above 164 are matched by name or created from Pokeweb's ability library (Tough
  Claws, Mega Launcher, Parental Bond, Aerilate, Pixilate, Strong Jaw, Refrigerate); Delta Stream has no template
  (Mega Rayquaza keeps its base ability). Fairy needs Fairy Type Support, which the install adds first; without it the base type stays.
- Mega Stones at their pokebw2 IDs (657-780, Item Expansion): White2Upgrade's item data (no price, no effect),
  names, plurals, articles, a description, White2Upgrade's icons (the Legends Z-A stones use the Mega Ring icon).
- Animated sprites and icons: every Mega's PWAN library entry, credited per side (the card lists them). White2Upgrade's
  `assets/pokeweb_pwan` files at the old supplement asset numbers (724, 727, 742, 778, 787, 788, 797 and the backs at
  729, 776, 782, 817) were Gen 7/8 Pokémon (Decidueye, Incineroar, Cutiefly, Mimikyu...), and the library's Mega
  Slowbro was Galarian Slowbro, so `scripts/patch-pwan-library-megas.ts` rebuilt those sprites from the priority
  sources in `~/Repos/Port-Pokeweb/sprites` (aranousqui20-newmegas preferred, essentials_gifs otherwise: Venusaur,
  Blastoise, Slowbro (`SLOWBRO_2`; `_1` is Galarian), Sceptile, Sharpedo, Camerupt, Metagross, Gallade's back) and added
  the seven Megas the library lacked with White2Upgrade's icons (pokebw2 `sourceIconFile` / `iconPalette`).
- Battle messages (bank 18, player / wild / foe triplets): "reacting to [trainer]'s Mega Ring", "has Mega Evolved",
  the fervent wish.
- Hibiki's transformation animation (White2Upgrade's script 622 and SPAs 765, 767, 770, 771, 783). Without Move
  Expansion the script is appended to the battle-effect archive `a/0/6/6` (115 members retail, so member 115) and
  played as effect ID 0x231 + member (676): the retail effect VM reads `a/0/6/6` for IDs from 0x231. With Move
  Expansion it goes past member 1,000 of `a/0/6/5` and plays as its ID + 115 (the expansion's routing). Projects
  whose Mega Pokémon were installed without the animation get it from the card's Update button
  (`stageMegaAnimation`).
- Mega Rayquaza (Dragon Ascent from Move Expansion, which the install adds first when the ROM doesn't have it;
  skipped if Move Expansion can't be installed).
- One route per Mega.
- The universal stones (Megite, Megite X, Y, Z and G; `UNIVERSAL_STONES`), always: five consecutive free item IDs
  from 740 (the package's range above its own stones), else from 781. They use the generic stone icon. Projects whose
  Mega Pokémon predate them get them with Update Mega Evolution.
- With the card's **Include G-Max Megas** checkbox (unchecked by default), 13 G-Max Megas (`GMAX_MEGAS`).
  - **Source:** White2Upgrade's import of the G-Max artwork, the PWAN library's `GMAX_MEGA_` entries of species
    1-649.
  - **Stats:** the base form's stats, types and abilities (White2Upgrade's policy; `addPokemonForm` copies the base
    record).
  - **Names and stones:** a species that already has a Mega gets "-Mega-G" and "<its stone> G" with that stone's
    icon. These are Venusaurite G, Charizardite G (Charizardite X's icon), Blastoisinite G and Gengarite G. The
    others get "-Mega" and an "-ite" stone with the generic icon: Butterfreeite, Pikachuite, Meowthite,
    Machampite, Kinglerite, Laprasite, Eeveeite, Snorlaxite and Garbodorite.
  - **Item IDs:** from the same free slots, after the universal stones.
  - **Adding them later:** on an installed project, checking the box turns the button into Update Mega Evolution,
    which adds the missing ones (`stageMegaExtras`).

Verified in desmond (`emulator_content.ts`, White 2 and Black 2): the install adds 70 forms and 70 stones without
Move Expansion (Mega Rayquaza skipped) and 71 with it; Charizard holding Charizardite X becomes Mega Charizard X
(Fire/Dragon, Tough Claws, stats) with its PWAN sprite, the "reacting to Red's Mega Ring" message and Hibiki's
animation (with and without Move Expansion); with `--foe`, the trainer's Charizard holding Charizardite Y Mega Evolves on its own
(Drought, stats). In desmond the intact sphere of the animation shows dark for a moment in both games; check it on
hardware or melonDS before tuning the SPAs. The install takes about 15-30 seconds.

Black / White take the same package and the same install. What differs: the battle messages go to Black / White's
"set" message bank 14 (bank 18's counterpart, same entries and codes); item text uses Black / White's item banks
(`itemFamily`); the animation script is remapped for Black / White (the Black 2 / White 2-only background commands are
dropped) and always goes to the battle-effect archive `a/0/6/7` (effect ID 0x231 + member): Black / White's Move
Expansion routes expanded moves through the move command (a global set per move) rather than by ID + 115, so a
direct effect call past member 1,000 of the move animations would read a missing battle-effect member. The Mega
sprites stream through the animated sprite streaming runtime (Black / White have no split PWAN runtime).

The install adds Fairy Type Support first when the ROM lacks it (all four games; Black / White's is Frost's patch,
see `runtime/fairy-bw1/`), with the modern typings, so the Fairy Megas get their type; then Move Expansion. Verified on
White: Gardevoir holding Gardevoirite becomes Mega Gardevoir, Psychic/Fairy with Pixilate.

Verified in desmond (`emulator_content.ts`, Black and White): the install (with Move Expansion) adds 71 forms and 70
stones; Charizard holding Charizardite X arms with START, "Charizard's Charizardite X is reacting to Hilbert's Mega
Ring!", Hibiki's animation, the streamed Mega Charizard X sprite at the reveal frame, "has Mega Evolved!", Fire/Dragon,
Tough Claws, stats; `--no-animation` (the native form change); `--native` (the form given a native sprite package,
Garchomp's, instead of its stream: the native sprite and its native animation appear at the reveal); `--foe` (the
trainer's Charizard holding Charizardite Y Mega Evolves on its own: Drought, sun).

Custom Megas: the Pokémon editor's Evolutions tab (`src/ui/pokemonMegaPanel.ts`, `src/pokeweb/megaEditorModel.ts`)
edits the routes of one form, adds Mega forms (named `<Pokémon>-Mega` at their personal index in the name bank, which
the game doesn't read past species 649) and creates Mega Stones at items 781-1023 (`stageCustomMegaStone`). The content
install names its forms the same way (`Charizard-Mega-X`). Verified in desmond: a new Pikachu form with a new
Pikachuite (item 781) Mega Evolves with the animation and the "Pikachuite is reacting" message, and changes type,
ability and stats.

Not included yet: the Mega glyph over the Pokémon (Hibiki's animation no longer draws the Mega symbol itself;
White2Upgrade's MegaB2W2 extras draw it, White 2 only), the Mega cry and HP-bar icon, the battle summary's Mega
ability.

The Mega Ring: White2Upgrade's key item at ID 124 (an unused retail slot in all four games, so a retail save holds
it), its data (Key Items, important, sort index 23), text and icon (the package's generic stone icon is its icon). On
Black 2 / White 2 the ARM9 pocket table (`sItemPockets`, B2 0x0208f4d0 / W2 0x0208f4fc) also gets Key Items for it,
since the game and the item expansion's bag validator read native pockets from there. A project with Mega Pokémon
from before the ring gets it with Update Mega Evolution. The bundled test saves (`src/assets/testbattle/test.sav`,
`white.dsv`) hold it in Key Items (`add_mega_ring_to_saves.ts`); the White 2 Upgrade / Black 2 Upgrade saves already
did. Verified in desmond: with the ring, Charizard Mega Evolves on White 2 and Black; with `--ring-item 125` (an
item the save lacks) the MEGA button is gone and START does nothing (White); `--bag` shows the Mega Ring with its
icon and description in Key Items (White, Black 2).

Universal stones and G-Max Megas (`emulator_content.ts --gmax --team "<Pokémon> @ <stone>"`):
- White 2: Megite → Mega Venusaur; Megite X → Mega Charizard X; Megite G → Gengar's G-Max Mega; Butterfreeite → Butterfree's
  G-Max Mega. The stone's "reacting" message is shown, then the G-Max sprite.
- Black 2: Megite Z → Mega Garchomp Z.
- White: Megite X → Mega Charizard X.
- Black: Megite G → Gengar's G-Max Mega.

# Code Injection and Patches

## Cascade personal-data migration

Code Injection > Infrastructure and Dependencies shows **Editable Cascade AI Abilities** for a detected Cascade White BW2 ROM containing an identifiable injected AI ability table, or an already migrated Cascade ROM. **Migrate AI Abilities & Chances** copies the loaded variant's numeric ability IDs and raw hidden ability chance values into its Pokémon personal records and enables editing. See [Pokemon Personal](Pokemon-Personal.md) for offsets and ranges.

Both tables are extracted from the loaded DLLs. Ability IDs come from the `A9_DamageCalc.cpp` table; raw chance multipliers come from the separate `WhiteListedPokemon` array in `newitems_support_structs.h`, compiled into `D2_FieldOverlays.dll`. Current byte-sized and older enum-sized ability layouts are supported; missing, ambiguous, conflicting, truncated, or non-`u8` tables cannot be migrated. All target personal records are validated before any writes. This operation does not modify injected code or change gameplay behavior.

An earlier AI-only migration can use **Import Hidden Ability Chances** to fill zero-valued chance fields without overwriting AI ability edits or nonzero chances. Export retains a separate chance-import marker to prevent subsequent imports from resetting edited values.

## Purpose

The Code Injection page applies bundled binary changes to the ROM (the separate Patches page was folded into it). These features are for behavior that cannot be represented as normal game data, such as adding a runtime, changing battle code, changing dust-cloud logic, or extending type support.

Use these tools carefully. They modify ARM9, overlays, or ROM files at known byte locations. Pokeweb checks the ROM version and expected original bytes before applying supported patches, but you should still keep backups.

## Required Data

| Feature | Required data | Notes |
|---|---|---|
| General patches | Original ROM bytes | Pokeweb must be able to compare the target bytes against the supported patch signatures. |
| PMC runtime | Black 2 / White 2 code files | PMC is the runtime used by several injected DLL-style patches. |
| PWAN GIF support | Clean US Black 2 (`IREO`) or White 2 (`IRDO`) code layout | Both versions support the split summary, battle, and miscellaneous renderers. |
| Trainer battle log | US Black 2 (`IREO`), White 2 (`IRDO`), or the corresponding Upgrade ROM | Uses a version-specific DLL, PMC, save blocks 29–31, the evolution NARC, and summary text bank 179. |
| Enhanced Party Menu and Battle Log Integration | US Black 2 or White 2 with the current matching Battle Counters DLL | Adds EVOLVE and RELEARN to the field party menu, post-battle KO evolution, and KO learnsets. |
| Single-NPC double battle fix | Black 2 / White 2 with PMC support | The fix is installed as a bundled DLXF patch. |
| Tag Battle Stabilization | US White 2 (`IRDO`) with compatible battle AI hooks | Supports tag battles above the vanilla six opposing Pokemon by reducing simultaneous AI script memory use. |
| Porta PC | US Black 2 (`IREO`) or White 2 (`IRDO`) with compatible field hooks | Press Start during normal overworld exploration to open the PC and access Pokemon boxes, including on rail maps such as Castelia City. |
| Infinite Candy | US Black 2 (`IREO`) or White 2 (`IRDO`) with unused item 622 | Adds a reusable Rare Candy effect and icon in Key Items using a PMC DLL; White2Upgrade and Black2Upgrade are excluded. |
| Hard Level Caps | Stock US Black 2 (`IREO`) or White 2 (`IRDO`) | Caps battle EXP and Day Care growth using game work variable 16415. Infinite Candy respects the cap; ordinary Rare Candy ignores it. |
| Installed DLLs | Files in `patches/` or `lib/` | Patch DLLs are applied to the game; library DLLs are dependencies used by patches. |

## Code Injection Controls

| Control or Field | What it does | Example value |
|---|---|---|
| PMC status | Shows whether the PMC runtime is installed, ready to install, unsupported, or incompatible. | `Ready to install` |
| Install PMC | Installs or updates the PMC runtime for supported Black 2 / White 2 ROMs. | Click after loading a supported ROM. |
| PMC overlay | Shows the overlay used by the runtime. | `overlay_316` |
| PMC base address | Shows where the runtime is expected to live in memory. | `0x023C8000` |
| PWAN GIF status | Shows whether Pokeweb can install the PWAN animated-sprite runtime. | `Ready`, `Unsupported`, `Incompatible` |
| Install/Upgrade PWAN GIF Support | Stages the three version-specific PWAN runtime files and upgrades a known legacy White 2 monolith. | Summary, Battle, and Misc DLLs for W2 or B2 |
| Uninstall PWAN GIF Support | Removes PWAN runtime DLLs staged in the current project while preserving imported PWAN assets. | Available before the staged DLLs are exported and reloaded as part of a ROM. |
| Install Battle Log | Checks six ARM9/battle/summary regions, installs PMC if needed, stages the version-specific stripped battle and summary DLLs, and generates ancestry from current evolution data. | US Black 2, White 2, Black2Upgrade, or White2Upgrade |
| Uninstall Battle Log | Removes the staged battle and summary DLLs, removes or restores generated ancestry data, and restores normal Pal Pad/Wi-Fi save handling. Existing log records in the save remain untouched. | Available before the staged DLLs are exported and reloaded as part of a ROM. |
| Install Item Expansion | Black 2 / White 2. Installs PMC if needed and stages five `PokewebItems*` DLLs: item IDs up to 1023 and pokebw2's shared bag (one pool of 1,023 distinct items instead of fixed pockets). Pads item data and the item name, description, article and plural texts to 1,024 entries; items 639–1023 exist once you name them in the Items editor, and take their pocket from their item data. Also installs Battle Log's save guard. | Add Mega Stones at IDs 657 and up. |
| Convert Save to Expanded / to Retail | The item expansion uses a new save format: the bag block grows and the Pal Pad trade-history block shrinks (Battle Log records are kept). Converts a raw `.sav` both ways, never in place; the original file is unchanged. A ROM with the expansion stops at a message when it finds an unconverted save. Converted saves do not work with PKHeX, Poké Transporter or older ROMs, and Pal Pad, Wi-Fi friend and Unity Tower data are no longer saved. | `game.sav` → `game-expanded-items.sav` |
| Install Move Expansion | Black / White / Black 2 / White 2 (Major Features/Expansions). Expands the ROM to 1,000 move slots and adds the data for the Gen 6-9 moves (no special move handlers), installing Fairy Type Support first on Black 2 / White 2; optionally the move animations compiled from Gen 5 romhacks and the community. Credits for the move animations are on the card. | Installed automatically by Install Mega Evolution. |
| Install Mega Evolution | Black 2 / White 2 (Major Features/Expansions), shown only when Pokeweb runs on localhost (experimental, like Map Studio). One click installs everything it needs (PMC, Fairy Type Support and Move Expansion, Item Expansion, the PWAN runtime, `PokewebMega*.dll`) and the Mega Pokémon below. The player arms Mega Evolution on the move screen with START or the MEGA button; every trainer the game controls (opponents and partners) Mega Evolves whenever it can; one per trainer per battle, Generation 7 turn order. The form, its ability and stats last until the battle ends. Routes (species, held Mega Stone or trigger move, form, Mega form) can list your own Mega forms. Credits: Dararo (original Mega Evolution implementation), Hibiki (battle UI and transformation animation). | Refuses White 2 Upgrade / Black 2 Upgrade, which have their own. |
| Mega Pokémon (same button) | Adds the 71 Mega forms of species 1-649 (stats, types, abilities, weight): 70 with their Mega Stones (IDs 657-780, with icons) and Mega Rayquaza, triggered by knowing Dragon Ascent (from Move Expansion); animated sprites and icons, the battle messages, Hibiki's transformation animation and a route each. Missing Gen 6+ abilities are added from the ability library. If Move Expansion can't be installed on the ROM, Mega Rayquaza is skipped. If the Mega Pokémon were installed without the animation, the button shows Update Mega Evolution and adds it. Item Expansion changes the save format: convert existing saves on its card. Sprites come from the PWAN library; their credits are listed on the card. | Fairy-type Megas keep their base type without the Fairy type patch. |
| Install/Update Enhanced Party Menu and Battle Log Integration | Verifies party/field/tutor and battle-return hooks, stages the matching stripped companion, and configures EVOLVE and RELEARN text. Existing KO learnsets are preserved. | Update older companions to 1.3.1 for the post-battle KO evolution fix |
| Uninstall Enhanced Party Menu and Battle Log Integration | Removes a staged companion while retaining text entries and KO learnsets. Uninstall this before removing Battle Log. | Existing message IDs never shift |
| Single-NPC double battle fix | Installs a bundled patch that fixes trainer scripts where one visible NPC should start a double battle. | Black 2 or White 2 patch DLL |
| Install Tag Battle Stabilization | Checks battle AI hooks, installs PMC if needed, and stages the stripped stabilization DLL. Recognizes the original `CascadeTagAI.dll` to avoid duplicate installation. | Two opposing trainers with four Pokemon each |
| Uninstall Tag Battle Stabilization | Removes the stabilization DLL staged in the current project. | Available before exporting and reloading the DLL as part of a ROM |
| Install/Update Porta PC | Installs PMC if needed and stages the matching stripped DLL. Replaces a recognized original ButtonScript DLL in place. | `PortaPCB2.dll` or `PortaPCW2.dll` |
| Uninstall Porta PC | Removes a Porta PC DLL staged in the current project. | Available before the DLL becomes part of an imported ROM |
| Install Infinite Candy | Installs PMC if needed, stages the version-matched DLL, and fills item 622's data, name, and description. | Give item 622 through an event or save editor; Rare Candy at item 50 stays unchanged. Credit: PW2Code by Dararo. |
| Install Forgettable HMs | Black 2 / White 2. Installs PMC if needed and stages a generated `ForgettableHmsB2.dll` / `ForgettableHmsW2.dll` that hooks `PML_MoveIsHM`, so HMs can be forgotten while ARM9 stays retail. An older inline ARM9 edit shows *Migration Available* and is restored on install. Black / White use the ARM9 patch (Make HM Moves Forgettable) on the same tab. | Let players remove Cut or Surf in a BW2 hack. |
| Install/Update Autorun | US Black, White, Black 2 and White 2. Installs PMC if needed, stages `Autorun{B,W,B2,W2}.dll` (field grid and rail movement hooks) and the shared `PokewebOptionRows*.dll`, and adds an AUTORUN On/Off row to the in-game Options screen. With the Running Shoes, moving runs and holding B walks; existing saves start with Autorun on. On Black 2 / White 2 with Following Pokémon, both rows share one Options module (Followers, then Autorun). | Run everywhere without holding B. |
| Uninstall Autorun | Removes a staged Autorun install, its Options row and text. Following Pokémon's row stays. | Available before the DLL becomes part of an imported ROM |
| Install/Update Skip Intro | US Black 2 and White 2. Installs PMC if needed and stages `IntroSkip{B2,W2}.dll` (five call hooks in the new-game events of overlay 35). A new game starts in the player's room, in control, right after Professor Juniper's introduction: no Aspertia flyover, no call outside the house, no "I'm home!" scene. Mom waits in the house and the story continues as usual. | Faster new games. |
| Uninstall Skip Intro | Removes a staged Skip Intro install. | Available before the DLL becomes part of an imported ROM |
| Install Hard Level Caps | Installs PMC if needed and stages the version-matched battle, Day Care, and item hooks. | Set the desired cap with `EventWorks.Set(16415, level)` in a game script. Zero leaves the default cap at 100. Credit: PW2Code by Dararo. |
| Installed DLLs sidebar | Lists each injected patch or library once by its complete ROM path. | `patches/DoubleBattleFixW2.dll` |
| Add Patch DLL | Adds a DLXF Gen V patch DLL to `patches/`. | A battle-code patch DLL |
| Add Library DLL | Adds a supporting library DLL to `lib/`. | A libRPM-compatible dependency |

## ROM patches on the Code Injection page

These are direct ROM edits rather than PMC modules; each asks for confirmation and is kept by exporting the ROM.

| Patch | Tab | Supported games | What it changes | Example use |
|---|---|---|---|---|
| Fairy Type Support | Major Features/Expansions | Black 2 / White 2 | Adds Fairy as an extra usable type and can update Pokemon and move typings. Installed automatically by Move Expansion and Mega Evolution. | Add Fairy-type Clefairy, Togepi, or Ralts-line behavior. |
| Move Expansion | Major Features/Expansions | Black / White / Black 2 / White 2 | 1,000 move slots and the data of the Gen 6-9 moves (base power, accuracy, status effects; no special move handlers), with Fairy Type Support where available; optionally the move animations. | Give Pokémon Moonblast or Play Rough. |
| Make HM Moves Forgettable | Quality of Life | Black / White | Edits ARM9 so HMs can be forgotten. For Black 2 / White 2, use **Forgettable HMs** on the same tab. | Let players remove Cut or Surf without special handling. |
| Editable Cascade AI Abilities | Infrastructure and Dependencies | Cascade White | See *Cascade personal-data migration* above. | |

Dust-cloud rewards (including removing gems or items) are edited in the [Phenomena editor](Phenomena), which has editable encounter chances and item lists for dust clouds and flying shadows. Specify Trainer Pokémon Natures moved to Code Injection > Infrastructure and Dependencies.

## Status Labels

| Status | Meaning |
|---|---|
| Installed | The expected patch or runtime bytes/files are already present. |
| Ready | The ROM matches the supported original bytes and the patch can be applied. |
| Not Installed | The patch has not been applied yet. |
| Unsupported | The loaded game is not supported by that feature. |
| Incompatible | Pokeweb found bytes or files that do not match the expected original or installed form. Another patch, ROM base, or manual edit may already have changed the same area. |
| Signature unknown | Pokeweb cannot confidently identify the target bytes. Treat this as unsafe unless you know exactly what changed. |

## Workflows

### Edit a Pokeweb ROM in Frost

1. Open the **Export** menu and choose **Export for Frost**.
2. Save the separate `-frost-compatible.nds` copy and open it in Frost.
3. Edit ordinary game data and save normally in Frost. Reload that ROM in Pokeweb to continue editing; use **Export for Frost** again when returning to Frost.

This option targets Pokeweb Gen V ROMs with the retail overlay layout or Pokeweb's recognized PMC installation. It retains installed DLLs, hooks, all archive contents, and root filenames. It reserves an overlay-first FAT slot for PMC and shifts the named filesystem together to match Frost's indexing assumptions. The named PMC image is retained for Pokeweb's injection tooling. Repeated compatibility exports do not add more slots.

This is not a general repair for ROMs modified by arbitrary tools: rearranged/unknown overlays are rejected, and third-party patches that hard-code NitroFS file IDs are unsupported. Keep injection installation and PMC changes in Pokeweb, not Frost. Frost still has its own data-format limitations and rewrites some NARCs on save; keep backups and fully reboot the game for testing (do not resume a savestate made against a different ROM layout).

Normal **Export ROM** remains available and does not opt into the conversion.

### Install a bundled gameplay patch

1. Load the original ROM data and the relevant game data.
2. Open `Code Injection`.
3. Read the status for the patch you want.
4. Apply the patch only if it is shown as ready or supported.
5. Export the ROM and test the changed behavior in-game.

### Enable trainer natures

1. Use a supported Black 2 / White 2 ROM.
2. Open Code Injection > Infrastructure and Dependencies and choose **Install Trainer Natures** (PMC is installed automatically; an older inline natures patch is migrated).
3. Open the Trainer editor.
4. Set each Pokemon's `Nature` field, or leave it as `Auto` to preserve normal behavior.

### Stabilize larger tag battles

1. Load a US White 2 (`IRDO`) ROM with the supported battle AI layout.
2. Open Code Injection and choose **Install Tag Battle Stabilization**. PMC is installed automatically if needed.
3. Configure the trainers' teams in the Trainer editor, then export the ROM.
4. Fully restart the game and test the battle from an ordinary in-game save. A mid-battle emulator save state can retain the previous ROM's loaded code.

The patch allows tag battles containing more than the vanilla limit of six opposing Pokemon, such as four on each opposing trainer. It runs one trainer's AI at a time so different trainers do not keep multiple large AI script buffers in memory simultaneously, preventing the associated intermittent battle-start hang. This also helps ROM hacks with expanded AI scripts.

Team sizes are still configured separately. The patch does not enlarge party storage or the battle heap, and each individual script must still fit in available memory. AI scheduling can change move choices through shared RNG ordering and can increase decision time. Other causes of crashes are outside this fix's scope. Black 2 and other regions are not supported by this bundled build.

### Access the PC from the overworld

1. Load a supported US Black 2 or White 2 ROM.
2. Open Code Injection and choose **Install Porta PC**. If an original ButtonScript patch is detected, choose **Update Porta PC** to replace it in place.
3. Export the ROM and fully restart it.
4. Press **Start** while exploring to open the normal PC menu and access your boxes.

Porta PC calls the ROM's existing PC script, including its usual menu choices. Grid, rail, and hybrid maps are supported, including Castelia City. Other field events take priority when they occur on the same frame. The shortcut is available during normal overworld exploration; it does not open boxes during battles, menus, or cutscenes. Team storage and save formats remain unchanged.

After updating the DLL, export and restart the game from an ordinary in-game save. An older emulator save state contains the old hooks in RAM and is not a valid test of the update.

### Install PWAN animated-sprite support

1. Use a clean supported US Black 2 or White 2 code layout.
2. Install PMC if Pokeweb says it is required.
3. Install PWAN GIF support.
4. Open Animated Sprites and explicitly import the front and/or back GIF for a species/form.
5. Export the ROM and test the generated PWAN archive in battle.

Installing the runtime alone writes an empty PWAN configuration and does not modify the Pokemon sprite NARC. White 2 stages `PokewebPwanSummaryW2.dll`, `PokewebPwanBattleW2.dll`, and `PokewebPwanMiscW2.dll`. Black 2 stages the corresponding `PokewebPwanSummaryB2.dll`, `PokewebPwanBattleB2.dll`, and `PokewebPwanMiscB2.dll`, enabling animated overrides in battles, summaries, evolution, egg hatching, and the other supported non-battle views.

### Install the trainer battle log

1. Use a US Black 2, White 2, or corresponding Upgrade project whose ARM9, battle, and summary hook bytes still match its base game.
2. Open `Code Injection` and install the Trainer Battle Log. PMC is installed automatically if needed.
3. Export the ROM. The installer generates `battlelog/ancestry.narc` from the project's current `a/0/1/9` and stages the matching battle and summary DLL pair under `patches/`. The dedicated `battlelog` directory is appended to NitroFS so existing ROM file IDs remain unchanged.
4. Save normally after trainer battles to persist new records.

The log stores up to 600 trainer records in normal save blocks 29–31. Those blocks originally contain Wi-Fi History, Pal Pad/Wi-Fi List, and Wi-Fi Negotiation data, so the corresponding retired online features are incompatible with the log. Reinstalling regenerates family ancestry after evolution edits. To relabel the summary field, edit system message bank 179 entry 15 from `ID No.` to `Frags`; the installer intentionally leaves normal message text untouched.

## Caveats

### Party-menu EVOLVE and RELEARN

Install or update Trainer Battle Log first, then install/update **Enhanced Party Menu and Battle Log Integration** (formerly Menu Evolution).
Version 1.3.1 fixes the missing post-battle KO evolution resolver; update the
companion and start a fresh Test Battle instead of resuming a state with the old
runtime already loaded. The `MenuEvolutionB2.dll` / `MenuEvolutionW2.dll` paths
are unchanged, so updates replace the existing companion without duplicating it.
Export and fully reboot the ROM from an ordinary in-game save, not an older
emulator savestate. KO Moves editing is shown only when the required runtimes
are installed and current.

**RELEARN** opens the native move reminder without charging a Heart Scale.
Its list includes the current species/form's level-up moves up to the Pokemon's
current level and KO moves up to its individual KO count. It removes duplicates
and already-known moves; it does not add pre-evolution learnsets. Learning,
replacement, and cancellation use the game's existing UI and return to the
party menu. The command is hidden for eggs, invalid Pokemon, or empty lists.

**EVOLVE** continues to support eligible level, KO, battles-brought, and
battles-used methods. Both commands respect the eight-entry party-menu limit,
including field moves; EVOLVE takes priority if only one extra command fits.
Message bank 178 receives/reuses separate uppercase entries for both commands.
The companion does not change save structures or spend stored KO counts.

If an older Pokeweb session reports `ROM file already exists:
battlelog_ko/learnsets.narc`, refresh Pokeweb and retry. The editor now retains
the imported KO archive after autosave, updates it by its existing file ID,
and repairs the old duplicate staging during project reload/export. Recovery
preserves original lists for untouched blank members while retaining staged
move lists and recorded intentional deletions. Do not clear the project or
delete the KO archive to work around this error; no DLL reinstall is required.

### General patch caveats

- Code patches are version-specific. A patch made for Black 2 may not be safe for White 2, and BW patches are not automatically BW2 patches.
- Black 2 and White 2 each use a stripped overlay-167 battle DLL and a stripped overlay-207 summary DLL because their entry points differ. Pokeweb selects and installs the matching pair automatically.
- Incompatible status usually means the ROM is not clean at the patch location, the ROM revision differs, or another patch already changed the same code.
- PWAN support writes extra runtime data during export. Do not judge PWAN installation only by whether a normal editor field changed.
- Black 2 PWAN accepts manual GIF imports and bundled community PWAN assets for vanilla species 1-649 and legitimate Gen 5 forms. Imports use the dedicated Black 2 carrier templates.
- A known bundled `patches/PokewebPwanW2.dll` is retired in place during upgrade to avoid shifting ROM file IDs. A different DLL using that legacy filename is treated as a conflict and is not overwritten.
- Feature uninstall buttons can remove DLLs staged during the current edit session. DLL files already built into an imported ROM remain protected until NitroFS deletion support is available.
- Patch DLL files are not ordinary Windows DLLs. They must be Gen V-compatible patch/library DLLs built for the injection runtime.
- Applying a patch can make future patch compatibility checks stricter because the original bytes are no longer present.

## Related Pages

- [Trainers](Trainers)
- [Pokemon Sprites and Animations](Pokemon-Sprites-and-Animations)
- [Moves](Moves)
- [File System](File-System)

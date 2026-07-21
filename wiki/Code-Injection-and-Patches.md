# Code Injection and Patches

## Purpose

The Code Injection and Patches editors apply bundled binary changes to the ROM. These features are for behavior that cannot be represented as normal game data, such as adding a runtime, changing battle code, changing dust-cloud logic, or extending type support.

Use these tools carefully. They modify ARM9, overlays, or ROM files at known byte locations. Pokeweb checks the ROM version and expected original bytes before applying supported patches, but you should still keep backups.

## Required Data

| Feature | Required data | Notes |
|---|---|---|
| General patches | Original ROM bytes | Pokeweb must be able to compare the target bytes against the supported patch signatures. |
| PMC runtime | Black 2 / White 2 code files | PMC is the runtime used by several injected DLL-style patches. |
| PWAN GIF support | Clean US Black 2 (`IREO`) or White 2 (`IRDO`) code layout | Both versions support the split summary, battle, and miscellaneous renderers. |
| Trainer battle log | US Black 2 (`IREO`), White 2 (`IRDO`), or the corresponding Upgrade ROM | Uses a version-specific DLL, PMC, save blocks 29–31, the evolution NARC, and summary text bank 179. |
| Single-NPC double battle fix | Black 2 / White 2 with PMC support | The fix is installed as a bundled DLXF patch. |
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
| Install Battle Log | Checks six ARM9/battle/summary regions, installs PMC if needed, stages the version-specific battle-log DLL, generates ancestry from current evolution data, and changes `ID No.` to `Frags`. | US Black 2, White 2, Black2Upgrade, or White2Upgrade |
| Single-NPC double battle fix | Installs a bundled patch that fixes trainer scripts where one visible NPC should start a double battle. | Black 2 or White 2 patch DLL |
| Installed patch DLLs | Lists injected patch files in `patches/`. | `DoubleBattleFixW2.dll` |
| Installed library DLLs | Lists dependency files in `lib/`. | A shared library required by a patch |
| Add Patch DLL | Adds a DLXF Gen V patch DLL to `patches/`. | A battle-code patch DLL |
| Add Library DLL | Adds a supporting library DLL to `lib/`. | A libRPM-compatible dependency |

## Patch Editor Controls

| Patch | Supported games | What it changes | Example use |
|---|---|---|---|
| Remove Gems from Cave Dust Clouds | Black / White / Black 2 / White 2 | Skips the dust-cloud reward branch that gives type gems. Other dust-cloud rewards can remain. | Make caves give encounters and non-gem items only. |
| Remove Items from Cave Dust Clouds | Black / White / Black 2 / White 2 | Skips dust-cloud item rewards so dust clouds attempt wild encounters instead. | Make dust clouds always behave like encounter spots. |
| Add Fairy Type Support | Black 2 / White 2 | Adds Fairy as an extra usable type and can update Pokemon and move typings. | Add Fairy-type Clefairy, Togepi, or Ralts-line behavior. |
| Specify Trainer Pokemon Natures | Black 2 / White 2 | Enables the trainer Pokemon `Nature` field in supported ROMs. | Give a boss's ace an explicit `Adamant` nature. |
| Make HM Moves Forgettable | Black / White | Changes move deleter behavior so HMs can be forgotten. | Let players remove Cut or Surf without special handling. |

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

### Install a bundled gameplay patch

1. Load the original ROM data and the relevant game data.
2. Open `Code Injection/Patches`.
3. Read the status for the patch you want.
4. Apply the patch only if it is shown as ready or supported.
5. Export the ROM and test the changed behavior in-game.

### Enable trainer natures

1. Use a supported Black 2 / White 2 ROM.
2. Apply `Specify Trainer Pokemon Natures`.
3. Open the Trainer editor.
4. Set each Pokemon's `Nature` field, or leave it as `Auto` to preserve normal behavior.

### Install PWAN animated-sprite support

1. Use a clean supported US Black 2 or White 2 code layout.
2. Install PMC if Pokeweb says it is required.
3. Install PWAN GIF support.
4. Open Animated Sprites and explicitly import the front and/or back GIF for a species/form.
5. Export the ROM and test the generated PWAN archive in battle.

Installing the runtime alone writes an empty PWAN configuration and does not modify the Pokemon sprite NARC. White 2 stages `PokewebPwanSummaryW2.dll`, `PokewebPwanBattleW2.dll`, and `PokewebPwanMiscW2.dll`. Black 2 stages the corresponding `PokewebPwanSummaryB2.dll`, `PokewebPwanBattleB2.dll`, and `PokewebPwanMiscB2.dll`, enabling animated overrides in battles, summaries, evolution, egg hatching, and the other supported non-battle views.

### Install the trainer battle log

1. Use a US Black 2, White 2, or corresponding Upgrade project whose ARM9, battle, and summary hook bytes still match its base game.
2. Open `Code Injection/Patches` and install the Trainer Battle Log. PMC is installed automatically if needed.
3. Export the ROM. The installer generates `battlelog/ancestry.narc` from the project's current `a/0/1/9`, stages `patches/Black2UpgradeBattleLog.dll` or `patches/White2UpgradeBattleLog.dll`, and patches summary text bank 179 entry 15 to `Frags`. The dedicated `battlelog` directory is appended to NitroFS so existing ROM file IDs remain unchanged.
4. Save normally after trainer battles to persist new records.

The log stores up to 600 trainer records in normal save blocks 29–31. Those blocks originally contain Wi-Fi History, Pal Pad/Wi-Fi List, and Wi-Fi Negotiation data, so the corresponding retired online features are incompatible with the log. Reinstalling regenerates family ancestry after evolution edits.

## Caveats

- Code patches are version-specific. A patch made for Black 2 may not be safe for White 2, and BW patches are not automatically BW2 patches.
- Black 2 and White 2 use separate battle-log DLLs because their battle and summary entry points differ. Pokeweb selects the matching artifact automatically.
- Incompatible status usually means the ROM is not clean at the patch location, the ROM revision differs, or another patch already changed the same code.
- PWAN support writes extra runtime data during export. Do not judge PWAN installation only by whether a normal editor field changed.
- Black 2 PWAN accepts manual GIF imports and bundled community PWAN assets for vanilla species 1-649 and legitimate Gen 5 forms. Imports use the dedicated Black 2 carrier templates.
- A known bundled `patches/PokewebPwanW2.dll` is retired in place during upgrade to avoid shifting ROM file IDs. A different DLL using that legacy filename is treated as a conflict and is not overwritten.
- Patch DLL files are not ordinary Windows DLLs. They must be Gen V-compatible patch/library DLLs built for the injection runtime.
- Applying a patch can make future patch compatibility checks stricter because the original bytes are no longer present.

## Related Pages

- [Trainers](Trainers)
- [Pokemon Sprites and Animations](Pokemon-Sprites-and-Animations)
- [Moves](Moves)
- [File System](File-System)

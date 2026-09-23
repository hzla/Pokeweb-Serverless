# Bundled patch source bookkeeping

This folder snapshots the source currently available for Pokeweb's bundled code-injection DLL/RPM patches, including the Following Pokémon variants under `src/assets/following`. **It is not used by the app or by the existing build/synchronization scripts.** Edit the canonical source, rebuild there, then refresh the bundled artifact and bookkeeping copy separately.

The monolithic `Black2Upgrade.dll` implementation is excluded. Its three separately bundled Field/Pokedex/UI companions are included, as are the separate battle-logging modules. B2/W2 and B/W variants with shared implementations are grouped together. Multi-file patches keep their C++ units, headers and hook assembly together.

This is a current-source snapshot, not proof that every historical bundled binary exactly matches the current checkout. No binaries were rebuilt or replaced for this bookkeeping task. Generated B2 assembly is identified explicitly.

## Privacy and contents

Patch source, relevant headers, build/metadata text, tests, license material, and the four prepared native-art PNG inputs for the save menu are included. ROMs, saves, emulator validation captures, local project settings, SDK/toolchain binaries, credentials, machine-specific absolute paths, and Git author/remotes metadata are excluded. Source references are repository names plus relative paths. Text line endings are normalized to LF; machine-specific paths, if present, are replaced with `<LOCAL_PATH>`. Binary PNG build inputs are copied byte-for-byte.

`manifest.json` lists every copied source file, its repo-relative origin and SHA-256, plus the bundled artifact names and hashes at capture time. Shared project headers are under `shared/`; external SDK/framework dependencies and full symbol databases remain in the canonical build environments. Any copied build scripts are reference material, not standalone build entry points in this layout. Original licenses/attributions are retained where available; no new license is asserted.

## Inventory

| Source group | Bundled DLL/RPMs | Status |
| --- | --- | --- |
| [Trainer battle log](battle-log/) | `Black1BattleLog.dll`, `White1BattleLog.dll`, `Black2UpgradeBattleLog.dll`, `White2UpgradeBattleLog.dll` | source-copied |
| [Battle-log save ownership](battle-log-save-guard/) | `BattleLogSaveGuardB.dll`, `BattleLogSaveGuardW.dll`, `BattleLogSaveGuardB2.dll`, `BattleLogSaveGuardW2.dll` | source-copied |
| [Individual PK5 battle counters and KO moves](battle-counters/) | `Black1BattleCounters.dll`, `White1BattleCounters.dll`, `Black2UpgradeBattleCounters.dll`, `White2UpgradeBattleCounters.dll` | source-copied |
| [Battle counter summary display](battle-log-summary/) | `Black1BattleLogSummary.dll`, `White1BattleLogSummary.dll`, `Black2UpgradeBattleLogSummary.dll`, `White2UpgradeBattleLogSummary.dll` | source-copied |
| [Enhanced Party Menu and Battle Log Integration](enhanced-party-menu/) | `MenuEvolutionB2.dll`, `MenuEvolutionW2.dll` | source-copied |
| [PWAN battle sprites](pwan-battle/) | `PokewebPwanBattleB2.dll`, `PokewebPwanBattleW2.dll` | source-copied |
| [PWAN summary sprites](pwan-summary/) | `PokewebPwanSummaryB2.dll`, `PokewebPwanSummaryW2.dll` | source-copied |
| [PWAN misc sprites](pwan-misc/) | `PokewebPwanMiscB2.dll`, `PokewebPwanMiscW2.dll` | source-copied |
| [PWAN trainer sprites](pwan-trainer/) | `PokewebPwanTrainerB2.dll`, `PokewebPwanTrainerW2.dll` | source-copied |
| [Retired PWAN compatibility stub](pwan-legacy-retired/) | `PokewebPwanLegacyRetiredW2.dll` | source-copied |
| [Custom overworld weather](overworld-weather/) | `PokewebOverworldWeatherW2.dll` | source-copied |
| [Expanded-form evolution](form-evolution/) | `FormEvolutionB2.dll`, `FormEvolutionW2.dll` | source-copied |
| [Background-music toggle and streamed replacement](bgm-toggle/) | `BgmToggleB2.dll`, `BgmToggleW2.dll` | source-copied |
| [Portable PC](porta-pc/) | `PortaPCB2.dll`, `PortaPCW2.dll` | source-copied |
| [Tag-battle AI stabilization](tag-battle-stabilization/) | `TagBattleStabilizationW2.dll` | source-copied |
| [Standalone LEARNSET viewer](learnset-viewer/) | `LearnsetMenuB2.dll`, `LearnsetMenuW2.dll`, `LearnsetViewerB2.dll`, `LearnsetViewerW2.dll` | source-copied |
| [Battle Type Icons and Move Effectiveness Preview](battle-type-hud/) | B2/W2 Type Icons standard, circular, and solid variants; B2/W2 Move Effectiveness | source-copied |
| [White 2 save menu](save-menu/) | `SaveMenuW2.dll` | source-copied |
| [Specified trainer natures](trainer-nature/) | `TrainerNatureB2.dll`, `TrainerNatureW2.dll` | source-copied |
| [Following Pokémon](following-pokemon/) | Core, Events, and Field DLLs for stock B2/W2 and White2Upgrade W2 | source-copied |
| [Black2Upgrade field companion](black2upgrade-field/) | `Black2UpgradeField.dll` | source-copied |
| [Black2Upgrade Pokedex companion](black2upgrade-pokedex/) | `Black2UpgradePokedex.dll` | source-copied |
| [Black2Upgrade UI companion](black2upgrade-ui/) | `Black2UpgradeUI.dll` | source-copied |
| [PMC loader framework](pmc/) | `PMC_B2.rpm`, `PMC_W2.rpm` | source-copied |
| [Single-NPC double-battle fix](double-battle-fix/) | `DoubleBattleFixB2.dll`, `DoubleBattleFixW2.dll` | original-source-unavailable |
| [Test Battle main-menu skip](main-menu-skip/) | `MainMenuSkipB2.dll`, `MainMenuSkipW2.dll` | original-source-unavailable |

## Source gaps

Original source for **MainMenuSkipB2/W2** and **DoubleBattleFixB2/W2** was not found in the available local checkouts. Their folders explicitly record that gap; they do not contain guessed or decompiled C++ labeled as original source. DoubleBattleFix includes only the existing W2 staging/validation script as supporting material.

## Refresh and validation

This refresh registers the save-menu and trainer-nature DLLs, the circular and
solid Type Icons variants, and all nine current Following Pokémon runtime DLLs.
Their snapshots include the relevant runtime source, integration, metadata,
build inputs and tests. Following Pokémon records stock Black 2, stock White 2,
and White2Upgrade separately. The save-menu group is limited to the pinned
White 2 Following Pokémon alpha ROM described in its runtime notes. Asset
archives and validation captures remain outside this snapshot. All previously
registered groups and their bundled-artifact hashes are refreshed too.

The background-music snapshot includes runtime 3.0.0, a variable-length
replacement table with legacy migration and per-track editing/removal, the guarded native
32 KiB buffer with low-memory fallback and host-only allocation tests, the streamed-SDAT
installer/model, Music Editor UI integration, adaptive PCM16/IMA-ADPCM encoding,
independent parser tests, and full-ROM B2/W2 archive round-trip verification.
Long imports use block-seekable compression to reduce ROM size. ROM export
updates the DS-accessible region boundary after sound-archive growth, including
ROMs with stripped DSi payloads. Its
shortcut is a volume mute; genuine game pause/resume remains separate. All tracks
share one playback buffer. The installer retains its 512 MiB export safety
limit. Multi-track host/archive checks passed; gameplay verification is pending.

From the Pokeweb repository root:

```sh
node patch-sources/refresh.mjs
node patch-sources/refresh.mjs --check
node patch-sources/refresh.mjs --only=learnset-viewer
node patch-sources/refresh.mjs --only=learnset-viewer --check
```

This opt-in bookkeeping tool refreshes manifest-listed sources, discovers the
newer runtime groups' source/build/test text, normalizes private paths, and
records current source and bundled-artifact SHA-256 values. It refuses to
overwrite locally edited snapshots or silently omit an unregistered bundled
DLL/RPM, including the three Following Pokémon distributions. A second refresh is a no-op. It does not run copied scripts, launch an
emulator, rebuild modules, change bundled binaries, or delete files.
The optional `--only=GROUP` refreshes/checks that group's sources and artifacts
without changing other groups or shared files. Complete bundle-inventory
validation remains part of the unscoped command.

Repository locations default to the existing sibling layout and can be overridden
with `W2U_RUNTIME_ROOT`, `WEATHER_RUNTIME_ROOT`, and `PMC_SOURCE_ROOT`.
Generated HUD address/hook headers are included, but build binaries, ROMs,
screenshots, saves, and captured-memory reports are not. Copied integration tests
and installers remain references for their canonical Pokeweb locations, not a
standalone application source tree.

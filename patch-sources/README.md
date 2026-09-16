# Bundled patch source bookkeeping

This folder snapshots the source currently available for Pokeweb's bundled code-injection DLL/RPM patches. **It is not used by the app or by the existing build/synchronization scripts.** Edit the canonical source, rebuild there, then refresh the bundled artifact and bookkeeping copy separately.

The monolithic `Black2Upgrade.dll` implementation is excluded. Its three separately bundled Field/Pokedex/UI companions are included, as are the separate battle-logging modules. B2/W2 and B/W variants with shared implementations are grouped together. Multi-file patches keep their C++ units, headers and hook assembly together.

This is a current-source snapshot, not proof that every historical bundled binary exactly matches the current checkout. No binaries were rebuilt or replaced for this bookkeeping task. Generated B2 assembly is identified explicitly.

## Privacy and contents

Only patch source, relevant headers, build/metadata text, tests, and license material are included. No ROMs, saves, screenshots, local project settings, SDK/toolchain binaries, credentials, machine-specific absolute paths, or Git author/remotes metadata are included. Source references are repository names plus relative paths. Text line endings are normalized to LF; machine-specific paths, if present, are replaced with `<LOCAL_PATH>`.

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
| [Retired PWAN compatibility stub](pwan-legacy-retired/) | `PokewebPwanLegacyRetiredW2.dll` | source-copied |
| [Custom overworld weather](overworld-weather/) | `PokewebOverworldWeatherW2.dll` | source-copied |
| [Expanded-form evolution](form-evolution/) | `FormEvolutionB2.dll`, `FormEvolutionW2.dll` | source-copied |
| [Portable PC](porta-pc/) | `PortaPCB2.dll`, `PortaPCW2.dll` | source-copied |
| [Tag-battle AI stabilization](tag-battle-stabilization/) | `TagBattleStabilizationW2.dll` | source-copied |
| [Standalone LEARNSET viewer](learnset-viewer/) | `LearnsetMenuB2.dll`, `LearnsetMenuW2.dll`, `LearnsetViewerB2.dll`, `LearnsetViewerW2.dll` | source-copied |
| [Battle Type Icons and Move Effectiveness Preview](battle-type-hud/) | `TypeIconsB2.dll`, `TypeIconsW2.dll`, `MoveEffectivenessB2.dll`, `MoveEffectivenessW2.dll` | source-copied |
| [Black2Upgrade field companion](black2upgrade-field/) | `Black2UpgradeField.dll` | source-copied |
| [Black2Upgrade Pokedex companion](black2upgrade-pokedex/) | `Black2UpgradePokedex.dll` | source-copied |
| [Black2Upgrade UI companion](black2upgrade-ui/) | `Black2UpgradeUI.dll` | source-copied |
| [PMC loader framework](pmc/) | `PMC_B2.rpm`, `PMC_W2.rpm` | source-copied |
| [Single-NPC double-battle fix](double-battle-fix/) | `DoubleBattleFixB2.dll`, `DoubleBattleFixW2.dll` | original-source-unavailable |
| [Test Battle main-menu skip](main-menu-skip/) | `MainMenuSkipB2.dll`, `MainMenuSkipW2.dll` | original-source-unavailable |

## Source gaps

Original source for **MainMenuSkipB2/W2** and **DoubleBattleFixB2/W2** was not found in the available local checkouts. Their folders explicitly record that gap; they do not contain guessed or decompiled C++ labeled as original source. DoubleBattleFix includes only the existing W2 staging/validation script as supporting material.

## Refresh and validation

The latest scoped refresh updates LEARNSET to **1.2.0** (D-pad party navigation, branch-responsive icons,
buffered loading, compact gold stats, form abilities and cycle-safe chains). Other patch snapshots retain their
previous versions and hashes; this refresh does not certify newly added bundles
outside LEARNSET. Existing original-source gaps remain explicit.

From the Pokeweb repository root:

```sh
node patch-sources/refresh.mjs
node patch-sources/refresh.mjs --check
node patch-sources/refresh.mjs --only=learnset-viewer
node patch-sources/refresh.mjs --only=learnset-viewer --check
```

This opt-in bookkeeping tool refreshes manifest-listed sources, discovers the
two new runtime groups' source/build/test text, normalizes private paths, and
records current source and bundled-artifact SHA-256 values. It refuses to
overwrite locally edited snapshots or silently omit an unregistered bundled
DLL/RPM. A second refresh is a no-op. It does not run copied scripts, launch an
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

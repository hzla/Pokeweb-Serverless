# Trainer battle log

Status: **source-copied**.

Bundled artifacts: `Black1BattleLog.dll`, `White1BattleLog.dll`, `Black2UpgradeBattleLog.dll`, `White2UpgradeBattleLog.dll`.

Shared B/W/B2/W2 implementation; includes the resolved-target/faint trampolines and the save-block patch source. Target macros select each game profile.

These are bookkeeping copies only. Existing source/build locations remain authoritative. Shared headers and metadata are in [../shared](../shared/). See the root manifest for file hashes and repo-relative origins.

## Original source references

- `White2Upgrade-Original-pokeweb: src/battle_log/w2u_battle_log.cpp`
- `White2Upgrade-Original-pokeweb: src/battle_log/w2u_battle_log_trampolines_pp.S`
- `White2Upgrade-Original-pokeweb: src/battle_log/w2u_battle_log_save_patch.s`

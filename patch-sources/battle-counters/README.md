# Individual PK5 battle counters and KO moves

Status: **source-copied**.

Bundled artifacts: `Black1BattleCounters.dll`, `White1BattleCounters.dll`, `Black2UpgradeBattleCounters.dll`, `White2UpgradeBattleCounters.dll`.

Shared individual-counter implementation; BW2 also handles immediate KO move learning. Uses the shared PK5 and pending-move headers.

These are bookkeeping copies only. Existing source/build locations remain authoritative. Shared headers and metadata are in [../shared](../shared/). See the root manifest for file hashes and repo-relative origins.

## Original source references

- `White2Upgrade-Original-pokeweb: src/battle_log/w2u_pk5_battle_counters.cpp`
- `White2Upgrade-Original-pokeweb: tools/test_ko_move_pending.cpp`

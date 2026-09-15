# Battle-log save ownership — runtime bundle 9 (BW2) / 4 (BW1)

## Fault and prevention

Retail block 29 is Wi-Fi history. `WIFIHISTORY_Update` changes Geonet states
`01` to `10` in the bitmap at block offset `0x348`, length `0xFF0`. This overlaps
the logger from the end of record 59 onward. Normal saves then checksum the
already-rewritten records: valid block CRCs do not establish log integrity.
The rewrite can change trainer IDs, species, KO credits and player-death credits.
It is lossy; this update does not attempt to reconstruct existing damaged data.

The installer now installs a separate, resident `BattleLogSaveGuard*.dll`,
disables the daily rewrite, and retains the existing Wi-Fi-list copy suppression.
Stock subsystem accessors return **separate temporary workspaces**, not real
save blocks. The logger still accesses blocks 29–31 via the generic save API.
Neither the history record format nor the individual PK5 counter format changes.

## Source audit

BW1 and BW2 layouts must be checked separately. All final US entry and allocator
signatures are checked against US binaries before install.

| Real block | Redirected accessor | Covered retail users |
| --- | --- | --- |
| 29 | `SaveData_GetWifiHistory` | Daily Geonet aging; country/world flags; Unity Tower/united-nations data; profile history; GTS/Battle Subway; direct history pointers; trade backup/rollback copies |
| 30 | `SaveData_GetWifiListData` | Pal Pad/friend/user data; GameData shadow copy; network/IR/trade updates; getters returning mutable friend/name/DWC pointers |
| 31 | `WIFI_NEGOTIATION_SV_GetSaveData` | Trade-negotiation profiles and counters; GTS/IR/matchmaking; mutable trainer-status pointers |

The real block-ID references in retail C callers lead through these three
accessors. `savedata/save_tbl.c` also lists the blocks for the normal save
framework, which is intentionally untouched. Debug-only test callers and
Gen 4 multiboot save enums are not retail Gen 5 writers.

Important source files: `savedata/wifihistory.c`, `wifilist.c`,
`wifi_negotiation.c`, their local structure headers, `gamesystem/game_data.c`,
`field/ev_time.c`, `field/scrcmd_un.c`, `field/united_nations*.c`, and
`net_app/poke_trade/pokemontrade_save.c`. The latter's pointer/memcpy rollback paths
are why disabling only named setters would be insufficient.

## Verified hook profiles

Addresses below are function entry addresses, without the Thumb bit.

| Entry | US B2 / W2 | US B / W |
| --- | --- | --- |
| Wi-Fi history accessor | `02009B78` | `02009470` |
| Pal Pad accessor | `0200A424` | `02009D08` |
| Negotiation accessor | `0200A5E4` | `02009EC8` |
| Daily Geonet update | `02009C48` | `0200952C` |
| Legacy Wi-Fi copy guard | `02009F0C` | `020097F0` |

The module makes one lazy allocation from root application heap 1, created
before save-control/game-data setup. `system/gfl_use.c` defines that root heap;
it is not a temporary party, field, or battle heap. The allocation lives for
the application lifetime. It is zeroed before publication. An allocation
failure returns no workspace and **never exposes the real log blocks**; extreme
memory exhaustion may still terminate gameplay, rather than corrupt the log.

Memory cost: 432-byte stripped DLL plus 4-byte BSS (before small PMC allocator
overhead); 10,320 bytes of application RAM plus its allocator overhead. No PMC
heap-cap increase and no additional flash writes. Retail Wi-Fi data in these
workspaces is intentionally nonpersistent. New-game initialization and normal
save serialization, backup copies, block CRCs and load behavior are unchanged.

## Installer behavior and limits

- Exact US hook/import signatures are verified before staging. Auto-loaded
  DLLs claiming an isolation hook or allocator entry are rejected as conflicts.
- All four assets are fetched and fingerprint-checked before staging. Older
  installations, even those missing the legacy copy guard, offer **Update Battle Log**.
- Reinstall is byte-identical. Export/reload and metadata hydration retain status.
- Staged uninstall removes the guard with the logger and restores both static
  guards. It does not edit save files; resuming retail Wi-Fi ownership afterward
  can overwrite former log data. Built-in DLL removal remains unsupported.
- New DLLs may renumber optional patch-directory files. Verified retail NitroFS
  IDs remain unchanged; optional files remain reachable by their original paths.
- This isolates the audited stock users. It is not protection against arbitrary
  cheats, external save editors, unrelated memory corruption, or a ROM hack
  directly accessing the generic save API with hardcoded block numbers.
- Already-corrupted records remain unreliable, including any apparent deaths.
  Start the updated ROM normally; resuming an old emulator savestate can restore
  the old code, hooks and pointers instead of loading the new guard.

## Validation

Native C++ tests cover distinct views, complete workspace writes, the exact
Geonet transform, one-time allocation, and no real-save fallback on allocation
failure. TypeScript tests inspect compiled ARM9 relocations, symbol stripping,
ARM/Thumb allocator addresses, static patch signatures and a reproduced false
death caused by bit spillover. Installer verification checks clean US B/W/B2/W2
and Cascade Build 23, install/reinstall/export/reload, retail file IDs and staged
uninstall. No DeSmuME or browser-emulator tests are run.

```sh
npx vite-node scripts/verify-battle-log-save-guards.ts input.nds optional-output.nds
npm run battlelog:check
npm test
npm run build
```

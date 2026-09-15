# Battle Log save compatibility

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

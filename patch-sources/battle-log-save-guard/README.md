# Battle-log save ownership guard

Bookkeeping copy; canonical implementation is in White2Upgrade-Original-pokeweb.
Build with its existing Meson configuration, for example:

```sh
ninja -C build-stripped src/battle_log/BattleLogSaveGuardW2.dll
```

The other targets substitute B2, W, or B. All are stripped DLXF modules.
The build defines `GUARD_ALLOC_ADDRESS`: W2 `0x02039DC9`, B2 `0x02039D9D`,
W `0x020300B0`, B `0x02030098`. BW2 allocators are Thumb; BW1 allocators are
ARM. The corresponding small `battle_log_save_guard_bw*.yml` selects the
three ARM9 getter entries. Use the canonical `src/battle_log/meson.build`
for compiler flags and packaging, not this snapshot as a standalone SDK.

Each module uses 4 bytes of BSS and lazily reserves 10,320 bytes from root
application heap 1. Three separate views replace retail Wi-Fi history,
Pal Pad, and trade-negotiation save access. Allocation failure never falls
back to real save data. There is no extra flash save. The installer also
disables daily Geonet rewriting and retains the older Wi-Fi-copy guard.

See [the audit](../../docs/battle-log-save-ownership.md) for coverage and limits.

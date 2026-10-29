# DS/DSi runtime pointer checks

Native pointer guards must accept `[0x02000000, 0x02400000)` in DS mode and may
accept the additional range below `0x03000000` only after the checked native
DSi-mode accessor confirms DSi mode. Preserve alignment, complete-span and
overflow checks; DS mirrors are not independent heaps.

`audit.py` inventories bundled modules and canonical source candidates in
`audit.json`. Literal scans alone do not prove compatibility. `verify.py`
executes packaged pointer guards against the per-game mode getters.

```sh
python3 runtime/dsi-compatibility/audit.py
python3 runtime/dsi-compatibility/verify.py /path/cleanwhite2.nds /path/cleanblack2.nds
node scripts/sync-pwan-runtime-artifacts.mjs --check
```

`W2U_RUNTIME_ROOT` selects external source inputs. These checks cover pointer
admission, not complete gameplay, rendering, hardware or DSi timing. Export and
cold boot updated modules; emulator save states retain previously loaded code.

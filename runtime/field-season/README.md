# White 2 saved calendar policy

`calendar.cpp` provides a checked US White 2 calendar override for persistent
seasonal scenes. Saved work `0x41AE` contains `0xA7C0 | season`; unmarked saves
use the original RTC policy. The native force-season flag remains clear to keep
Save available. The exporter installs the module only for persistent scenes.

Run `python3 runtime/field-season/build.py` with ARM GNU tools on PATH or
`ARM_TOOLCHAIN_BIN`, `RPM_TOOL_JAR` and a clean White 2 ROM. Outputs are
`FieldSeasonW2.dll` and its native-signature manifest under `src/assets/cutscenes/`.
Other games, modified calendar providers, conflicting saved-work use and general
seasonal event refresh are outside this adapter's contract.

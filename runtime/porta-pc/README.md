# Porta PC

Press **Start** during normal overworld exploration to open the game's PC menu
and access Pokemon boxes. Uses the existing PC script, ID **10090** (`0x276A`),
so no replacement event scripts or save-format changes are required. The PC's
usual menus and progression-dependent options remain in effect.

The bundled `PortaPCW2.dll` and `PortaPCB2.dll` are **416 bytes each**, with
48 bytes of Thumb code, no BSS, and no unresolved imports. Both use PMC
priority 4 and version 1.0.0. Supported ROMs are US White 2 (`IRDO`) and
US Black 2 (`IREO`) with the checked field code layout.

## Source and behavior

Based on the user-provided `ButtonScript.s`. The source retains its Start key
and script ID, with three changes:

- Preserve a non-null field event already selected by the native checks,
  instead of replacing that event when Start is pressed in the same frame.
- Preserve r3 alongside r0-r2 around the key helper to maintain eight-byte
  stack alignment for native calls.
- Hook both grid and rail (`NoGrid`) event checks. Hybrid maps select between
  those providers, so both paths now reach the shortcut.

Each hook replaces its field event check's final `add sp, #0x70; pop {r3-r7,pc}`
with a Thumb BL. Both target the same code, which performs that epilogue itself.
A normal return through LR would be incorrect. Both routines use the same
r4 field pointer, r5 game-system pointer, and stack layout. Other events keep
priority; held Start does not repeatedly trigger
unless the game's pressed-key helper reports a new press.

This is an overworld shortcut, not an interrupt that opens boxes during
battles, menus, or cutscenes. Special modes using a different field event
provider are outside this hook. It opens the normal PC menu rather than
skipping directly into a particular box-management mode.

## Verified addresses

| Site | US White 2 | US Black 2 |
|---|---|---|
| Overlay 36 grid check start | `0x0218151C` | `0x021814DC` |
| Overlay 36 grid epilogue hook | `0x0218188A` | `0x0218184A` |
| Overlay 36 rail check start | `0x02181AA0` | `0x02181A60` |
| Overlay 36 rail epilogue hook | `0x02181CE8` | `0x02181CA8` |
| ARM9 pressed-key helper | `0x0203DF28` | `0x0203DEFC` |
| Overlay 36 field heap helper | `0x02180500` | `0x021804C0` |
| Overlay 12 script-event constructor | `0x021536AC` | `0x0215366C` |

Function addresses above are even; the symbol databases mark native Thumb
functions with bit zero set. Both versions were checked against their local
clean US ROMs. The installer checks the native code and detects overlapping
relocations in other patch DLLs; those checks cannot establish compatibility
with every possible indirect hook or custom event-script change.

An original `ButtonScript.dll` or `01_ButtonScript.dll`, including a renamed
copy, is identified by code and relocations. **Update Porta PC** replaces that
file in place, preserving its path and ROM file ID. A second competing DLL is
never intentionally added. Unrecognized code using a reserved name is left
untouched. A new DLL staged in the current project can be uninstalled; files
already built into an imported ROM remain protected by Pokeweb's usual rules.

## Rail-map support

The original script and the initial development build hooked only the grid provider. In the
reported Castelia City snapshot (`railbtnscript.mln`), the active field process
uses `FieldEventProvider_NoGrid` (`0x02181A69`). The grid epilogue is patched
to the loaded Porta PC code at `0x023B9090`, but the rail epilogue at
`0x02181CE8` still contains the original return instructions. The rail path
never reaches the shortcut's button check.

The bundled release includes the rail relocation without duplicating the code.
After installing and exporting, restart the game and load an ordinary in-game
save. Restoring an older emulator state restores the old hooks in RAM too.

## Build and validate

Run `python3 runtime/porta-pc/build.py`. Requires Java, Python 3, ARM GNU
Toolchain 14.2.rel1, and CTRMap's RPMTool. Defaults use the sibling workspace
toolchain and `White2Upgrade/CTRMap.jar`; override with `ARM_TOOLCHAIN_BIN`
and `RPM_TOOL_JAR`. Both small symbol databases are included here.

The build removes unused assembly constants and local labels before RPM
conversion, resolves all native calls, and strips symbol names. Assets are
written under `src/assets/codeinjection/`; build intermediates are ignored.

Run `python3 runtime/porta-pc/verify.py` with the `unicorn` package installed
to execute the actual compiled grid and rail hooks for both games on an ARM946 model. This checks
Start, non-Start buttons, simultaneous buttons, existing events, native-call
arguments, stack alignment, return values, and register/stack restoration.
Native calls are stubbed in this harness; it is not a full PC UI emulator test.
`src/test/portaPcModel.test.ts` covers the real DLL metadata/relocations,
installation, export/reimport, legacy upgrades, and compatibility rejection.

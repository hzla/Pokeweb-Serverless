# Tag Battle Stabilization

Bundled asset: `src/assets/codeinjection/TagBattleStabilizationW2.dll`.
Supported base: US White 2 (`IRDO`), with the checked battle AI layout.
This is the same symbol-stripped 496-byte runtime originally supplied as
`CascadeTagAI.dll`, version 1.0.0, SHA-256
`7ed12b4c532f4156365510bb18106c62c39fa5bbf848f0ffbdd8ce01eadd4f2a`.

Tag battles above the vanilla six opposing Pokemon, especially with larger
custom AI scripts, can exhaust the battle heap when multiple trainer AIs
hold different script buffers concurrently. This module lets one trainer's
AI run through its decision before another begins. Ownership survives frame
yields and is released on native completion; initialization and teardown
reset it. The normal busy return yields to the game instead of spinning.

The DLL uses 92 bytes of code and a four-byte owner pointer. It does not
increase the battle heap, disable AI flags, replace AI commands, or increase
party storage. It changes decision scheduling for all trainer AIs using these
clients, including the player's AI partner. Shared RNG consumption can change
the resulting move choices. Longer total decision time is possible; no added
frame delay is deliberately inserted. One script still needs to fit in memory.

## Hooks

All external relocations are Thumb BL call replacements in overlay 167:

| Call site | Native function in overlay 170 |
|---|---|
| `0x021B1848` | `TR_AI_Init`, `0x0217F641` (Thumb) |
| `0x021B5B92` | `TR_AI_Main`, `0x0217F6F1` (Thumb) |
| `0x021B18E8` | `TR_AI_Exit`, `0x0217F7C1` (Thumb) |

PMC binds the module to overlay 167 at priority 4. There are no unresolved
imports. The installer checks the call sites, native entry points, and
overlapping relocations in other patch DLLs. It recognizes the original
one-off DLL by its code and relocations, including when renamed, and avoids
installing a second copy. Checks cannot prove compatibility with every custom
runtime behavior or indirect hook.

## Build

Run `python3 runtime/tag-battle-stabilization/build.py` from the repository.
Requires Python 3, Java, ARM GNU Toolchain 14.2.rel1, and CTRMap RPMTool with
the White 2 PMC ESDB. The defaults match the sibling workspace toolchain and
`White2Upgrade` directories; override with `ARM_TOOLCHAIN_BIN`, `RPM_TOOL_JAR`,
and `PMC_ESDB`. The build writes the stripped asset and ignored intermediates.

The installer fingerprints the verified runtime. Changing the code or build
output requires reviewing that fingerprint and repeating runtime validation.

## Validation and testing

The original patch was checked with ARM946 execution of its actual stripped
code, multi-client scheduling/cleanup checks, and real battle-heap allocation
replay. A successful melonDS battle state confirmed all three installed hooks,
completed AI decisions, an empty script cache, and an intact unchanged heap.
This is not a guarantee against every possible battle crash or team size.

Pokeweb tests cover compatibility, conflicts, legacy detection, staging, and
ROM export/reimport. For in-game comparison, fully restart each ROM and enter
the same battle from an ordinary in-game save. A mid-battle emulator state
already contains runtime code and heap state and is unsuitable for toggling
this patch. Repeat both configurations because the original hang is intermittent.

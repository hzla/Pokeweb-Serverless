# Nature palettes

US revision-0 Black 2 and White 2 support nature palettes in battles and the
Pokémon summary screen. Install **Nature Palettes** from Code Injection or the
sprite editor. In the sprite editor's **Palettes** section, choose a nature,
edit Normal or Shiny, and press Apply. Export the ROM and restart normally.

Each sprite form has 25 independent normal/shiny pairs. Native front/back and
gender sprites share their palette. Imported animations have separate
**PWAN Front** and **PWAN Back** targets. Unedited colors inherit the current
source palette; Reset removes overrides. Transparent index zero is preserved.
PWAN shiny instances inherit the imported palette until given shiny overrides.
Replacing a PWAN palette layout requires accepting a reset of affected nature
variants. Project saves and exported ROMs retain variants; sprite bundle formats
do not include them.

Illusion selects the disguise's nature colors. Transform copies its target's
displayed nature colors. These are transient appearance settings and do not
alter saved Pokémon. Icons, followers, evolution, hatching, BW1, other regions,
expanded upgrade ROMs and other custom renderers are outside this patch's scope.

## Runtime and memory

Battle and summary modules load with their respective overlays. Native colors
are changed in the resource-load callback before palette upload and blending;
the existing Spinda callback is chained. PWAN colors are refreshed when the
displayed identity changes. The 25-pair collections stay on ROM, with bounded
stack reads and no patch-owned heap allocation or per-frame table reads.

The installer selects native-only modules or combined PWAN modules, keeping one
owner per hook. Installing or removing either feature preserves the other.
Removing Nature Palettes retains authored data. Unknown executable signatures
and conflicting hook owners prevent installation.

Current bundled artifacts have these static PMC costs, including allocator
alignment and headers:

| Module | Retained | Loading allocation | BSS (included) |
| --- | ---: | ---: | ---: |
| Native battle | 2,448 B | 2,512 B | 28 B |
| Native summary | 1,752 B | 1,776 B | 0 B |
| Added to existing PWAN battle | 2,560 B | 2,640 B | 92 B |
| Added to existing PWAN summary | 1,640 B | 1,648 B | 8 B |

Summary can overlap battle. The sidebar conservatively includes its cost in the
battle estimate. These sizes describe the bundled modules, not a measurement of
available native game memory. This feature does not expand the PMC heap.

## ROM data format

`pokemon/nature-palettes.bin` uses little-endian integers. Its 16-byte header
contains magic `PWNP`, version `u16 = 1`, header size `u16 = 16`, record count
`u32`, and total file size `u32`. The sorted directory contains `(key u32,
absolute payload offset u32)` entries. Payloads are contiguous.

`key = ((spriteId * 3 + source) * 25 + nature) * 2 + shiny`, where source is
Native = 0, PWAN Front = 1, PWAN Back = 2; nature is the stored Gen V nature ID
0–24; shiny is 0 or 1. `spriteId` uses the editor's resolved native sprite form.

A payload contains a nonzero `u16` color mask followed by one RGB555 `u16`
replacement for each set bit, in ascending index order. Bit zero and color bit
15 must be clear. Equal-to-base colors are omitted when authoring. An empty
variation has no directory entry. One changed color uses four payload bytes;
all 15 visible colors use 32 bytes. Each active variation also uses an eight-byte
directory entry. Missing files, missing keys and invalid records retain source
colors; records are validated before any replacement is applied.

## Build and checks

Requires Python with ndspy, ARM GNU tools, Java/RPMTool, and the matching split
PWAN source checkout. `PWAN_SOURCE_ROOT` selects that checkout; it is read only.
The checked build-time adapters produce combined candidates in ignored build
output. Set `ARM_TOOLCHAIN_BIN`, `RPM_TOOL_JAR`, `NATURE_PALETTE_W2_ROM` and
`NATURE_PALETTE_B2_ROM` when using other local tool/input locations.

```sh
python3 runtime/nature-palettes/build.py
python3 runtime/nature-palettes/verify.py --out /external/output/cpu.json
npx vite-node runtime/nature-palettes/verify_rom.ts INPUT.nds /external/output/rom
```

CPU checks require Unicorn and pyelftools. They execute compiled decoders and
adapters with explicit native-service stubs. The ROM check exercises module
installation/removal, conflict rollback, persistence and export/reload using
local inputs. Neither check alone establishes rendered gameplay behavior.
`emulator.py` accepts a prepared doubles battle ROM/save, a local headless
melonDS core, its Python bindings and an external output directory for visual
inspection. Optional `--pmc-symbols` takes a local JSON map of PMC symbol names to
RAM addresses and samples allocator free space at allocation/free boundaries
and screenshots. Its sampled peaks apply to the exercised scenes; the estimator
continues accounting conservatively for overlapping modules. Hardware and DSi
validation require separate checks.

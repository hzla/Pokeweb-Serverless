# Optional PMC heap expansion

On **Code Injection**, install or update the normal PMC runtime, then press
**Expand PMC Heap Allocation** in the sidebar. Export and restart from a normal
save. Dependency installers retain the normal bundles; expansion requires this
separate action. Later PMC updates preserve an installed expansion.

On US revision-0 Black, White, Black 2 and White 2, **Expand PMC Heap Allocation** installs the 12 KiB
loader reservation and raises the cap to 220 KiB. It also upgrades the previous
200 KiB installation in place. Normal export, Frost export, and repair
support both the 32 KiB legacy reservation and the 12 KiB compact reservation.
The compact upgrade preserves the overlay base and PMC service addresses.
Italian White 2 has a 200 KiB expanded cap. Available memory can
impose a smaller allocation on each profile.

The sidebar shows estimated battle and overworld usage against the installed
160, 200, or 220 KiB cap. These are two phases of the same heap, not separate reserves.
Each DLL's retained size excludes internal relocation data released after linking;
its loading size includes BSS expansion, eight-byte alignment and allocator
headers, counting executable code once. The phase estimate includes PMC's base
work allocation and follows module priority and ROM file order for loading peaks.
It also accounts for the initial scan of inactive patch DLLs. Recognized battle
and field overlays determine scope. BW2 overlay-12 hooks stay resident across
battles. Party, Bag, Summary and Learnset Viewer screens count toward the
on-demand loading peak, rather than the steady battle/field total. The split
C-Gear and Party UI modules unload with their own overlays; their small field
callback companions remain resident. Libraries and unclassified dependencies are
included in both phases conservatively. Unreadable DLLs make the estimate
incomplete. Additional allocations performed by patch code during play and heap
fragmentation are outside this static estimate. The cap is not a measurement of
the arena actually available to PMC, which can be smaller, especially in BW1.

Supported inputs use the current, verified Pokeweb PMC on US revision-0 Black,
White, Black 2 or White 2, or the reviewed Italian White 2 profile. Older loaders
must first be updated with **Update PMC**. Unrecognized loader code, symbol files,
hooks and conflicting DLL relocations are rejected without publishing changes.

Black/White reserve memory before creating the native game heaps and start DLLs
after game initialization. The startup budget uses the installed PMC cap.
A private copy of the DS startup table reduces only
the parent heap budget when needed, by at most 128 KiB, leaving a 24 KiB startup
reserve and at least 256 KiB in that parent budget. Child-heap definitions remain
unchanged. When those bounds cannot be met, startup uses the late, available-memory
allocation path. The native TWL table is retained. DSi paths are preserved but
require independent native DSi and hardware validation.

Existing PMC exports keep their code and data addresses, and installed DLL files
are preserved. The expanded BW1 image materializes the original BSS before
appending its private helper so existing bindings do not move. The larger PMC
reservation takes space from the game's arena; patch combinations still need
adequate native game-heap headroom.

Build the bounded Thumb helper with `python3 runtime/pmc-heap/build.py`, then the
separate packages with `npx vite-node runtime/pmc-heap/build.ts`. Set
`ARM_TOOLCHAIN_BIN` if the ARM GNU tools are outside the configured workspace
directory. `test_runtime.py` requires Python Unicorn and checks the shipped
budget and arena-accounting code. `verify_rom.ts INPUT.nds EXTERNAL_DIRECTORY`
checks the opt-in installation and ROM round trips using explicit local inputs.
Use `--legacy-200` to verify a compact upgrade from the 200 KiB profile and
export both ROMs for comparison.

## Five-Box Mode

On **Code Injection → PMC Runtime**, choose **Enable Five-Box Mode**, export,
and restart from an in-game save. This option targets US revision-0 White 2
and produces a DS-mode ROM. It provides 150 PC slots and writes all 24 box
records in the existing retail or Item Expansion (`PWI2`) format. When boxes
6–24 contain Pokémon, the game compacts boxes 1–5 in box and slot order, then
moves up to 30 Pokémon from the hidden boxes into the available slots in Box 5.
The next in-game save writes boxes 6–24 as empty and clears any overflow. Game
Sync save uploads are unavailable in this mode.

The installer preserves the verified alternate PC menu and its ARM9 helper,
and keeps a recognized relocated icon palette table at its existing address
above the PMC overlay. Other edits that conflict with the PC or storage hooks
prevent installation.

PMC recovers the verified ARM7 autoload source after ARM7 registers its OS and
card callbacks. The sidebar uses a 276 KiB estimate based on the DS-mode
allocation. PMC updates and reimport retain the option. **Restore 24 PC Boxes**
returns to the normal 220 KiB PMC profile. For a DSi-capable export after
restoring 24 boxes, use the original DSi-capable project or DSi ROM Repair.

To regenerate `src/assets/data/pmcFiveBoxRuntime.json`, build the compact
baseline and run the standalone builder with `-` as the ROM output and the
manifest path after `--reclaim-arm7-staging`.

`npx vite-node runtime/pmc-heap/five-box/verify_installer.ts INPUT.nds OUTPUT.nds`
checks the installer, export, reopen, update and restore paths against a local
ROM. Pass `--frost` to check the Frost export lifecycle as well.

From the repository root, use `npx vite-node runtime/pmc-heap/five-box/baseline.ts CLEAN.nds BASELINE.nds`.
Pass `--item-expansion` to include Item Expansion. A retail test save path after
that option creates a separate converted fixture beside the baseline ROM.
Then use `npx vite-node runtime/pmc-heap/five-box/build.ts BASELINE.nds FIVE_BOX.nds`
with the ARM GNU tools on `PATH`. Append `--reclaim-arm7-staging` to let PMC use
the retired ARM7 autoload source. This requires the verified US White 2 ARM7
image and retains the original allocation boundary until the ARM7 has registered
its OS and card callbacks. To generate a 24-box control with the same raised cap,
pass `--arena-control` to the second command and choose another output filename.

`probe.py` reads the live PMC arena and save allocation using the melonDS
headless Python bindings. Run it against a test ROM and a copied `.sav` beside
it. Use `--verify-flash` to verify all block CRCs in both copies. Use
`--trace-arm7` to check ARM7 accesses to the reclaimed range and its DS mirrors.

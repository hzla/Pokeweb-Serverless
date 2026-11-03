# Optional PMC heap expansion

On **Code Injection**, install or update the normal PMC runtime, then press
**Expand PMC Heap Allocation** in the sidebar. Export and restart from a normal
save. Dependency installers retain the normal bundles; expansion requires this
separate action. Later PMC updates preserve an installed expansion.

The expanded packages raise the ceiling to 200 KiB. Available memory can impose
a smaller allocation. Their allocator accounts for its context and alignment
inside that reservation. The original PMC packages remain bundled unchanged.

Supported inputs use the current, verified Pokeweb PMC on US revision-0 Black,
White, Black 2 or White 2, or the reviewed Italian White 2 profile. Older loaders
must first be updated with **Update PMC**. Unrecognized loader code, symbol files,
hooks and conflicting DLL relocations are rejected without publishing changes.

Black/White reserve memory before creating the native game heaps and start DLLs
after game initialization. A private copy of the DS startup table reduces only
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

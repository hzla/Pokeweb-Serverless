# BW2 Summary IV/EV Viewer

Independent PMC companions for English US Black 2 (`IREO`) and White 2
(`IRDO`), version 1.0.2. Compatible hacks must retain the verified Summary
hooks, helper entry points, and native title/footer resources. BW1 and other
language/revision profiles are unsupported.

## Installation

In Pokeweb, open **Code Injection → Graphical/UI Enhancements → Summary IV/EV
Viewer**. **Include EV view** is checked by default. Install, then export the
ROM. PMC is installed automatically when needed. No Following Pokémon,
Learnset Viewer, or Custom UI installation is required.

Reopening an exported ROM restores the installation and its EV setting.
**Apply Settings** replaces the recognized module at its existing filesystem
path. A recognized renamed module is also updated in place. **Remove** follows
the existing staged-DLL removal rules; DLLs already built into a loaded ROM
cannot currently be deleted through this card.

Version 1.0.0 and 1.0.1 installations are recognized and offer **Update Viewer**.
The update replaces the same DLL and keeps the selected EV option. Version
1.0.2 corrects Black 2's sound-helper call during navigation and refreshes only
the top screen when switching Stats/IVs/EVs. The HP alignment and outlined
horizontal bar-chart icon from 1.0.1 are retained. Export again and boot the
updated ROM normally; an older save state can restore the previous DLL code.

Installation checks code signatures, graphics members, bundled-module
integrity, configuration, duplicate modules, and competing relocation ranges.
PMC adoption/installation and the DLL update are staged on copies of the
mutable project domains. Validation or staging failure leaves the project
unchanged. Source ROMs and saves are not written by the installer.

## Controls

Left/Right follows **Status → Stats → IVs → EVs → Ribbons**, omitting EVs when
disabled and Ribbons when unavailable. Navigation stops at the endpoints.
Left from normal Stats retains the native return to Status.

The bar-chart footer tab opens IVs. Tapping Stats returns to normal Stats. Opening
Summary starts with a normal native page; IV/EV selection survives native
Pokémon changes and move-detail returns within that session. Eggs and
restricted Summary modes keep the native restrictions.

IVs/EVs replace the six numbers in native display order: HP, Attack, Defense,
Sp. Atk, Sp. Def, Speed. HP displays one number aligned with the other values;
the real current-HP bar remains
native. These are stored values, including zeroes and EV values up to 255.
Labels, nature coloring, abilities, artwork, moves, and other controls remain
native.

## Runtime and resources

- The native page IDs and fixed actor arrays are retained. Session-owned
  variants distinguish Stats, IVs, and EVs while the native page remains Stats.
- Seventeen localized Thumb call hooks cover entry/exit, input, drawing,
  title loading, and the six stat reads. The hook veneers preserve the original
  stack and `r3`, including calls with seven or ten arguments.
- Native Pokémon accessors read IVs/EVs. No Pokémon setters or gameplay
  mutations are introduced. The two separate HP-bar accessor calls are not
  replaced.
- ARM9 entry points use explicit per-game mappings, checked against matching
  retail function bytes and available Summary call sites. In particular, the
  sound helper is at the same address in both games, unlike later UI helpers.
- Stats variants retain the native page and its windows/actors. Only the six
  numeric CPU font buffers are cleared, then the native Stats drawing function
  runs within the native Pokémon read lock. Its existing dirty flag makes
  SkillUpdate wait for queued text before uploading the top windows and title.
  The HP-bar bitmap and bottom move resources stay intact. Actual page changes
  to/from Status and Ribbons retain native full-page transitions.
- One separately owned actor/unit borrows the native footer animation bank and
  palette. Its selected sequence uses the same animated palette as native
  tabs, without a separate flashing timer. Native controls from x=120 onward
  keep their positions and touch rectangles.
- Without Ribbons, tab allocations are 40 pixels at x=0, 40, 80. With Ribbons,
  allocations are 30 pixels at x=0, 30, 60, 90. Compacted borders preserve native
  icon pixels. The IV/EV icon contains three outlined horizontal bars, sharing
  a left spine and using the native selected/flashing palette.
- Three prebuilt 2,304-byte character banks use 6,912 bytes of OBJ VRAM and
  three native character-resource slots. They are prepared during native
  initialization before reveal; later updates only change actor proxies.
- IVS/EVS use 20 previously unused tiles in the existing title character bank
  (640 bytes, no extra BG allocation). Title maps use immutable module storage
  and the native window/map upload flow. Native bar palettes are retained.
- Session BSS is 108 bytes. The private unit/actor structures request 252 bytes
  from the native heap, in addition to native resource-manager bookkeeping.
  Each bundled DLL is 11,472 bytes. This is not a measured peak-heap budget.
- Exit removes the actor, deletes the unit, then releases the private character
  banks before native animation-bank teardown. Resource-registration failures
  release successful earlier registrations and retain vanilla behavior.

## Build and verification

Requirements: Python with `ndspy`, an ARM GNU toolchain, Java and RPMTool,
and, for the native harness, `unicorn` and `pyelftools`.

```sh
SUMMARY_W2_ROM=/path/to/cleanwhite2.nds \
SUMMARY_B2_ROM=/path/to/cleanblack2.nds \
ARM_TOOLCHAIN_BIN=/path/to/arm-none-eabi/bin \
RPM_TOOL_JAR=/path/to/CTRMap.jar npm run summarystats:build

npm run summarystats:verify
npx vitest run src/test/summaryStatViewerModel.test.ts src/test/codeInjectionEditor.test.ts
npm run build
npm run summarystats:verify-rom -- /path/to/cleanwhite2.nds
npm run summarystats:verify-rom -- /path/to/cleanblack2.nds
```

The native harness uses the default workspace input filenames and toolchain
path from `build.py`; `ARM_TOOLCHAIN_BIN` overrides its toolchain. Build outputs
go to `src/assets/codeinjection/` along with the versioned compatibility
manifest. Intermediate files stay in the ignored `build/` directory.

The real-ROM verifier exports and reloads in memory by default. An explicit
`--output /path/to/separately-named-test.nds` creates an EV-enabled test ROM,
refusing to overwrite an existing file. It does not copy or change saves.

See [VALIDATION.md](VALIDATION.md) for verified results, test limitations, and
the pending user emulator checklist.

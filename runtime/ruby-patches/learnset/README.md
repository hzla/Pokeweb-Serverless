# Ruby Learnset viewer for BW2

This experimental port rewrites the BW2 Learnset viewer's behavior in typed Ruby
source. It includes the field-menu command, request lifetime, tutor wrappers,
party/family navigation, level-up list parsing, archive caches, text wrapping,
upper-panel rendering, icon animation, and native allocation helpers. Both
Black 2 and White 2 compile to the existing pair of PMC `DLXF` companions.

The DS runs generated ARMv5T/Thumb code. Ruby runs only as a build-time parser.
This is a restricted native dialect, not unrestricted Ruby. ABI record headers,
low-level field/address primitives, pinned hook trampolines, and resource
generation remain native/build infrastructure. The original viewer behavior
sources are not compiled into the Ruby candidates.

## Source map

| File | Behavior |
| --- | --- |
| [menu.rb](menu.rb) | Party command, dispatch and cross-overlay session ownership |
| [viewer.rb](viewer.rb) | Viewer lifecycle, input, native rows/details, list refresh |
| [info.rb](info.rb) | Archive/text readers, species/form information, caches and rendering |
| [logic.rb](logic.rb) | Learnset validation, sorting, labels, party scan |
| [info_logic.rb](info_logic.rb) | Evolutions, family traversal, abilities, text/pixel algorithms |
| [runtime.rb](runtime.rb) | Game bindings and shared list construction |
| [memory.rb](memory.rb) | Freestanding copy/fill implementations |
| [config.rb](config.rb) | Installer configuration records |
| `abi/` | Native record layouts, constants and bridge primitives |

[../AUTHORING.md](../AUTHORING.md) documents the language and authoring workflow.
Keep behavior changes in these Ruby files, and keep this source map and validation
record current when capabilities or coverage change.

## Build and verify

Run from the repository root:

```sh
ruby runtime/ruby-patches/test_native_compiler.rb
python3 runtime/ruby-patches/learnset/build.py
python3 runtime/ruby-patches/learnset/verify.py
```

Requirements are Ruby with Ripper/JSON/Minitest, Python with ndspy/Unicorn/
pyelftools, Java/RPMTool, the existing ARM toolchain, a host C++ compiler, and the
repository's Node dependencies. Local clean US revision-0 Black 2 and White 2
ROMs supply the existing hook/resource verification and retail graphics data.
The builder accepts the native Learnset builder's `LEARNSET_W2_ROM`,
`LEARNSET_B2_ROM`, `ARM_TOOLCHAIN_BIN` and `RPM_TOOL_JAR` overrides; `RUBY` selects
the parser runtime and `CXX` selects the host-test compiler.

Candidates, generated sources, ELF files, receipts and previews are ignored under
`build/`. Candidate filenames retain the existing companion names:

- `build/candidates/LearnsetMenuW2.dll` and `LearnsetViewerW2.dll`
- `build/candidates/LearnsetMenuB2.dll` and `LearnsetViewerB2.dll`

The builder redirects the native build's source and output directories and keeps
bundled DLLs untouched. The separate BW1 source/builds remain unchanged.

## White 2 test export

After successful verification:

```sh
npx vite-node runtime/ruby-patches/learnset/export_test_rom.ts \
  /path/to/cleanwhite2.nds /path/to/NEW-ruby-learnset-W2.nds
```

Use an ordinary battery save and cold boot; an old emulator state can restore
old native code. Copy a save to the test ROM's matching basename if needed, while
retaining your original. No save is created or changed by the exporter.

Open Party in the overworld and select LEARNSET. The native menu needs a free
slot; Eggs and item/mail or battle contexts should not offer the command. Check:

- Opening, scrolling, move details and exiting across several party slots.
- Empty/long learnsets, alternate forms, types, stats and hidden abilities.
- L/R family browsing without a fade; D-pad Left/Right party changes with the
  native transition; silent endpoints and the intended navigation sounds.
- Repeated opening/closing, followed by normal menus, battles and ordinary tutors.
- Read-only behavior: the party's moves, held items and Pokémon data remain intact.

The test export embeds the Ruby candidates under the standard companion
filenames and retains native version metadata `1.5.0` for installer compatibility.
Reinstalling the app's bundled viewer replaces them with the C++ release.
The build/export receipts identify which experimental code was tested.

## Verification record

The record frontend has rejection tests for dynamic Ruby, interpolation, invalid
type escapes and mismatched parameters, plus ABI/reference and binding cases.
The verifier runs the existing host logic tests against Ruby-generated headers,
both games' instrumented runtime wrappers and graphics checks, full information
panel cases using retail font/icons, and packaged DLL import/configuration tests.
Reports remain in `build/`; a successful report names the checks and exact hashes.

The initial port passes both host suites, B2/W2 runtime and graphics fixtures,
full information-panel tests, focused family-navigation/cache/Custom UI cases,
and all four packaged DLL import/configuration checks. The two Ruby compiler
suites pass 14 tests with 106 assertions; the existing Learnset/BW1/PMC app
regression suites pass 90 tests.

Each game's menu DLL is 3,600 bytes, matching the native baseline's size. Each
viewer DLL is 19,120 bytes versus 19,152 bytes for the bundled C++ baseline.
The binaries differ, so the checks are behavioral evidence rather than proof of
byte identity. `Pokeweb-Ruby-Learnset-W2-v0.1.0.nds` is the initial separate test
export; its receipt confirms configured Ruby DLL contents and successful reload.

Native-call boundaries are instrumented in CPU tests. Export/reload verifies
installation and DLL contents, not a game boot. Full-game emulator/hardware
acceptance of the Ruby implementation remains pending until a test run records it.

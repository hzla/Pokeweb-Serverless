# C-Gear Quick Actions

Development package for English US White 2 (`IRDO`) and Black 2 (`IREO`), revision 0, and derivatives that preserve the checked native interfaces. Install through **Code Injection → Quality of Life → C-Gear Quick Actions**. PMC is the only dependency.

## Controls

| Button | Center | Text outline | Behavior |
|---|---|---|---|
| REPEL | 60, 116 | Green, RGB 24/216/120 | Unlimited native Repel filtering; native spray sound once when enabled |
| PC | 196, 116 | Orange, RGB 248/120/0 | Native PC script 10090, including its normal menus |
| BIKE | 88, 152 | Magenta, RGB 216/48/248 | Native bicycle check and mount/dismount transition |
| MAP | 172, 152 | Purple, RGB 192/104/240 | Native Fly map with an eligible non-egg party member knowing Fly; otherwise ordinary Town Map |

Each button uses a 32×32 sprite with five-pixel-high black lettering, a one-pixel colored outline, and an outer one-pixel black outline. The ring follows the native middle-ring color, and active Repel/Bike uses a bright ring. A shown but unavailable action is dimmed and consumes its own touches. A held touch activates once.

REPEL is always shown on the C-Gear screen. BIKE is hidden without the Bicycle (item 450); MAP is hidden without the Town Map (item 442). PC is shown by default and hidden when its configured saved event flag is set. Hidden buttons release their touch regions to native controls. Gates are checked again before dispatching an action.

The installer exposes **PC hide save flag**, accepting decimal or `0x` hexadecimal. The default is `0x05ED` (1517), in the unused gap before the native trainer flag range starting at 1520. Build checks confirm no occurrence in either clean English game's script or entity archives. Choose an available flag for a hack that assigns its own flags. Setting the flag hides PC; clearing it restores PC. Installation reads this flag and never sets or clears it.

The native **wrench** also drags these buttons. Their positions are saved during normal saving. The wrench remains visible with wireless off. Tapping the native **C-Gear logo** cycles the same five inner designs as the native buttons, including with wireless off. Both gender-specific pattern sets are copied from the loaded ROM during installation.

Buttons appear after C-Gear is obtained while its normal field screen is displayed. They remain visible during Bike transitions and dim with native PC dialogs. Input is blocked while another field event owns it. Menus and other applications retain priority. Installing the patch does not enable wireless.

## Save data

Unlimited Repel uses Options bit 12. Retail settings and the Following Pokémon bit 11 are preserved. Native item identifiers and remaining steps remain untouched: their countdown is paused while unlimited Repel is enabled and resumes when disabled. Empty parties use the native encounter behavior.

Button coordinates use a magic, version and checksum in the reserved C-Gear bytes 16–29. Native colors, panel coordinates, design, power and picture settings remain intact. Invalid or absent coordinate data falls back to the default layout. Normal in-game saving persists both settings; emulator states created before installation restore older code and should not be used to judge a new installation.

## Runtime and ownership

- Separate B2/W2 native profiles pin hook bytes, native helper entries, save accessors, ring layout and the graphics-system pointer. Code addresses and global-data addresses have different offsets between the games.
- Native C-Gear unit creation adds four actor slots, retaining its original 84 slots. The native unit and render surface own display scheduling. The patch removes its actors before outer or inner native teardown and reattaches when applications rebuild the same subscreen. It does not destroy the borrowed unit or renderer.
- The private archive is `quick-actions/ui.narc`, format 4. It contains configuration (including the PC hide flag), NCLR/NCER/NANR resources, four banks of button poses and ten native inner patterns. The installer validates the bundled code/art and the copied patterns separately. Known format 3 installations migrate in place.
- Four single-cell actors use 2 KiB of character data and palette banks 7–10 (128 bytes). Installation rejects conflicting native palette use. CPU pose banks, patterns and retained upload buffers total 15 KiB, plus resource headers, four native actor slots and runtime state. Initialization requires 32 KiB free heap and an 8 KiB contiguous allocation.
- Character uploads happen only when appearance changes; a visible-frame palette refresh is 128 bytes. Worst-case character upload is 2 KiB per display update. Upload sources are retained main-RAM allocations because DS DMA cannot read stack data located in DTCM. No per-frame heap allocation or display-register replacement is used.
- PC delegates request ownership to the native script event. MAP owns its request in a parent game event through completion/cancellation and native Fly travel dispatch. It uses ordinary Town Map when the party has no eligible Fly user or the current location prohibits Fly. The field screen is rebuilt through the native lifecycle on return.
- The Porta PC Start hooks are separate. Installer checks reject overlapping PMC hooks and unknown native modifications; these checks cannot establish compatibility with every indirect change in an arbitrary hack.

**Install/Update** stages a checked DLL and archive atomically. Repeated installation reuses the existing paths and ROM file IDs. **Disable** leaves saved preferences dormant and restores native behavior. A newly staged installation can also be removed. Exported installations follow Pokeweb's protected-file rules and can be disabled.

## Build and verification

Requires Python 3 with `ndspy`, Pillow, Unicorn and pyelftools, Java with RPMTool, the ARM GNU toolchain, and matching local clean US B2/W2 ROMs. `ARM_TOOLCHAIN_BIN`, `RPM_TOOL_JAR`, `QUICK_ACTIONS_W2_ROM` and `QUICK_ACTIONS_B2_ROM` override local build inputs. No reference checkout is a build dependency.

```sh
npm run cgear:build
npm run cgear:verify
npx vitest run src/test/cgearQuickActionsModel.test.ts
npm run cgear:verify-rom -- /path/to/input.nds --output /path/to/separately-named-test.nds
QUICK_ACTIONS_FRAMES=3000 npm run cgear:emulator -- /path/to/input.nds --bicycle
QUICK_ACTIONS_FRAMES=3300 npm run cgear:emulator -- /path/to/input.nds --scenario pc
QUICK_ACTIONS_FRAMES=1650 npm run cgear:emulator -- /path/to/input.nds --scenario bike --bicycle
QUICK_ACTIONS_FRAMES=1800 npm run cgear:emulator -- /path/to/input.nds --scenario map --no-fly
QUICK_ACTIONS_FRAMES=1050 npm run cgear:emulator -- /path/to/input.nds --scenario gates --no-map --hide-pc
QUICK_ACTIONS_FRAMES=2600 npm run cgear:emulator -- /path/to/input.nds --scenario travel
npm run build
```

The CPU harness executes compiled Thumb code and selected retail resource parsers/accessors with isolated native-call stubs. It verifies request ownership, register/stack preservation, main-RAM upload sources, all ten pattern compositions, item/flag gates, adjacent flag preservation, touch ownership, priority, Repel counters, coordinate persistence, delayed dimming, inner C-Gear reconstruction, allocation failure and cleanup. It does not replace full gameplay testing.

The emulator driver uses a copied bundled fixture. It never writes to an input ROM or user save. The optional Bicycle, Fly, badge and C-Gear fixture edits apply only in emulator memory. Screenshots, traces, copied saves and intermediate objects live in ignored `build/`. See [acceptance report](acceptance.md) for completed checks and remaining manual cases.

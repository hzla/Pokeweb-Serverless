# Direct save-to-battle harness

Build a separate test ROM/save pair that loads an existing save and starts the requested trainer battle automatically. No main-menu selection, movement, or NPC interaction is required. Both sides’ active Pokémon start on the field with their HP bars; trainer introductions, opening messages and ball throws are skipped. The battle uses the real trainer ID, not an NPC or proxy trainer slot. The trigger runs once per boot; returning from battle does not start another battle.

The version 5 trigger intercepts game startup after loading the save and game data, before field initialization. It enables both display engines through the native display wrapper and launches the native battle process directly: no map, player/NPC/follower actors, season banner, encounter effect, or startup field script runs before battle. This display handoff replaces initialization normally performed by the field; without it, the bottom-screen controls remain interactive but render as white. Trainer music still plays. A one-shot hook keeps native battle screen initialization, then selects the native direct-placement opening for singles, doubles, triples and rotation. A small adapter reverses the native helper’s argument order to match the procedure callback. The normal short fade and resource wait remain; no trainer models, introduction messages or ball effects are created. Entry abilities and subsequent switches retain native battle handling. Wins initialize the saved overworld afterward; defeats use native blackout recovery with the field still closed. The trigger cannot launch a second battle on return.

Currently supported: US White 2 revision 0 and compatible White2Upgrade ROMs. The builder checks each executable adapter/hook signature; ordinary data edits are accepted. It uses the existing PMC and main-menu-skip tooling. Nothing is added to ordinary Pokeweb exports or follower packages.

Pokeweb's trainer **Test Battle** and move-animation test actions use this automatic trigger on these ROMs. They retain the existing team-import controls, enable move animations, and grant badges in the temporary test save. The selected trainer's real ID is used without modifying its text, copying it to a proxy slot, or adding an NPC. Other ROM families retain the older test path. **Cmd+Option+P** still launches the ordinary overworld with the unchanged bundled save and no active battle trigger.

Generated White2Upgrade test ROMs and Pokeweb overworld previews also adjust the retail field startup guard that rejects species above 649. This keeps expanded party entries valid while loading the save; the original ROM is untouched.

From the repository root, keep the saved party and existing trainer team:

```sh
npm run battle:harness -- --rom /path/game.nds --save /path/game.sav --trainer 123 --out /path/test.nds
```

Use [example.json](example.json) to replace both teams:

```sh
npm run battle:harness -- --rom /path/game.nds --save /path/game.sav --config runtime/battle-harness/example.json --out /path/test.nds
```

The builder accepts raw 512 KiB BW2 saves and DeSmuME `.dsv` files. It creates `.nds`, `.sav`, `.dsv`, and a JSON manifest with the scenario and hashes, all under the output basename. Existing outputs are never overwritten. Omitting `--out` writes a timestamped pair to `../.pokeweb-local-archive/current/battle-harness/`. Inputs are read-only. Native tools use `ARM_TOOLCHAIN_BIN` and `RPM_TOOL_JAR`, with the same local defaults as the other runtime builds. Python checks require Unicorn, Capstone and pyelftools.

## Scenario fields

`trainerId` is required. `battleType` may be `Singles`, `Doubles`, `Triples`, or `Rotation`; omitted uses the trainer's current battle type. Trainer and player edits are optional. With no player edit, the supplied save is preserved byte for byte, including HP, status, moves, PP, held items and identities.

`trainer.team` and `player.team` replace a side's complete party with one to six Pokémon. Alternatively, `player.edits` changes existing Pokémon by zero-based `slot` while keeping the other slots and unspecified fields. For example:

```json
{
  "trainerId": 123,
  "player": {
    "edits": [{ "slot": 0, "currentHp": 25, "status": "burn", "pp": [0, 10, 10, 10] }]
  }
}
```

| Pokémon field | Meaning |
|---|---|
| `speciesId` | ROM species ID; required for a replacement team |
| `form`, `level`, `itemId` | Native form index, level 1–100, held item ID; replacement defaults 0, 50, 0 |
| `moves` | Up to four numeric move IDs; empty move slots use 0 |
| `abilitySlot` | Personal slot 1, 2 or 3 (hidden); replacement default 1 |
| `abilityId` | 1–255; player overrides its stored ability byte, trainer authors the selected Personal slot in the temporary test project |
| `gender` | 0 male, 1 female, 2 genderless; trainer omission preserves native gender generation |
| `ivs` | Object with `hp`, `atk`, `def`, `spe`, `spa`, `spd`; replacement default 31 |
| `evs`, `nature` | Player only: EV object (default 0, total ≤510), nature ID 0–24 (default 0) |
| `currentHp`, `status`, `pp` | Player only: HP 0–max, condition, exactly four PP bytes |

Status names are `healthy`, `sleep` (two remaining sleep turns), `poison`, `burn`, `freeze`, `paralysis`, and `toxic`. A numeric status word up to `0xfff` can specify sleep/toxic counters. Omitted conditions on replacement Pokémon start healthy, with full HP and the moves' base PP. Partial edits preserve conditions; changing species, level, nature or stats recalculates EXP and battle stats and clamps existing HP to the new maximum. PID/OT identity and authored nicknames remain intact. Trainer NARCs use one shared IV quality per Pokémon, so all six trainer IVs must match. Trainer natures retain native generation; the harness does not install the optional Trainer Nature patch.

An explicit trainer `abilityId` temporarily edits that species/form's chosen Personal ability slot, and the trainer data selects the slot for native party generation. Omitted IDs retain Personal data. Because Personal is shared, the edit also affects other Pokémon using that species/form/slot in the fixture. Conflicting IDs for the same slot in one team are rejected; use different slots. The input ROM is not modified, and only explicitly authored Personal rows are exported by the CLI builders.

`trainer.ai` accepts the native AI bitmask, and `trainer.trainerClass` sets the class byte. The requested trainer's team must contain enough Pokémon for its format. A saved player party must have at least one living non-Egg Pokémon. Valid redundant party blocks and checksum-table entries are updated together; unrelated save blocks are preserved. Trainer difficulty uses the saved zone and native difficulty setting. Background uses the saved zone and trainer override; season and clock are read from game data. Terrain defaults to lawn and weather to none because the map is never loaded. Native trainer-party seasonal form handling and entry abilities remain active. This is a controlled battle test, not a reproduction of a particular overworld tile or its startup scripts.

## Verification

### Unattended move/ability interaction MVP

For humans and agents adding tests, see [Writing automated move and ability tests](INTERACTION-TESTS.md) for usage examples, scenario design, native assertions and extension requirements.

Run the real White2Upgrade battle engine without a browser or agent:

```sh
npm run battle:test -- --suite fluffy
npm run battle:test:move -- --move ruination --rom /path/game.nds --full-turn-smoke
```

By default this reads `../../White2Upgrade.nds` and the bundled test save. For another compatible US White 2 revision 0 upgrade build, pass `--rom /path/game.nds`; optionally pass `--save /path/game.sav` (raw BW2 or `.dsv`). Install the project dependencies with `npm ci` first. Python 3, Pillow, and the melonDS headless Python package/shared library are required. Set `MELONDS_PYTHON_PATH` and `MELONDS_HEADLESS_LIB`, or pass `--melon-python /path/python --melon-lib /path/library`. The existing workspace headless build is discovered automatically when present; the emulator itself is not bundled here. This command uses the shipped CPU-verified battle trigger and does not require a native compiler, Unicorn, Capstone, or pyelftools.

The suite exports one shared ROM and one checksum-valid save. Player-controlled level-50 Mew knows all four attacks, and the AI's level-50 Snorlax knows only Splash. The temporary Personal NARC holds Run Away in Snorlax slot 1 and Fluffy in slot 2. Each ability variant cold-boots once, selecting its slot via a single validated trainer-data byte patch in a temporary ROM copy. At the first command menu, the runner takes an in-memory snapshot and restores it before each player-selected move. Eight damage observations therefore need only two cold boots; only the defender's ability changes within each pair.

Interaction fixtures force the in-game Battle Scene option Off in both save halves, preserving other options and refreshing checksums. Browser trainer/move-animation tests still enable animations. Old cached fixtures must be regenerated without `--fixtures`; the runner checks both the manifest and actual save option bytes before running.

| Attack | Property | Required Fluffy multiplier |
|---|---|---|
| Tackle | Contact, not Fire | 0.5× |
| Swift | Non-contact, not Fire | 1× |
| Flamethrower | Non-contact Fire | 2× |
| Fire Punch | Contact Fire | 1× (both effects cancel) |

Assertions check native ability registration, identical paired stats and pre-modifier damage, the engine's final damage multiplier, its calculated damage, and actual HP loss. Native battle RNG still executes, but its returned battle draws are controlled to avoid critical hits, use the same 85% damage roll, and avoid secondary effects. Normal tests never replace the ability handler or damage/HP results. This isolates Fluffy, rather than testing the RNG distribution. Executable probe signatures and ROM move contact/type data must match the supported ABI; unknown layouts fail instead of producing a misleading pass. Dynamically loaded handlers are exercised at their actual runtime addresses without hardcoding child DLL addresses.

For a real-emulator negative control that deliberately neutralizes Fluffy's contact multiplier and requires the oracle to reject it:

```sh
npm run battle:test -- --suite fluffy --verify-detector
```

This extra attack is restored from the same Fluffy checkpoint, explicitly fault-injected and recorded separately; it adds no cold boot. Its rejection is required for this command to succeed. Verify isolation by running the moves in reverse order:

```sh
npm run battle:test -- --reverse-cases --verify-detector
```

Fast oracle, rollback and deadline unit checks need no emulator:

```sh
npm run battle:test:unit
```

Exit status is `0` only when every required case passes, otherwise `1`. No input ROM or user save is overwritten. Outputs go to a fresh timestamped `work/battle-interactions/` directory: fixture hashes/scenarios, `result.json`, per-move JSON/screenshots, and per-variant batch JSON/native logs. Each ability variant runs in its own process against parent-owned temporary ROM/save copies. The default limits are 2,400 frames for boot and each move case, and a hard 90-second wall-clock deadline for the whole variant batch; override with `--max-frames` and `--trial-timeout`. A timeout is a failure, not a skipped test. `--out` must name a new directory. The single exported ROM uses approximately the input ROM size on disk; temporary copies also need space where reflinks are unavailable.

Snapshots are never written to disk. Restore checks the emulated frame counter and both battlers' raw state, and separately resets Python observations, pending RNG returns, keypad and touch input. The checkpoint is released at batch completion or failure. Parent-owned temporary ROM/save copies are cleaned even when a worker is killed by the deadline. Reports include cold-boot/restore counts, checkpoint size/hash and cleanup status, not snapshot contents.

The runner also deletes its newly generated `fixtures/battle.nds` at completion, including builder failures and worker timeouts. It keeps `battle.sav`, `suite.json`, logs and reports. Fresh runs generate a save from the current test setup, so changed tests do not reuse an outdated save. Add `--keep-fixtures` to retain the exported ROM for reuse; fixture directories explicitly supplied through `--fixtures` are never modified or deleted. Cleanup errors fail the run and are recorded in `result.json`.

All generated output is Git-ignored: the default `work/` tree is ignored, and both the runner and standalone fixture builder add a scoped `.gitignore` containing `*` to every newly created output directory. This also protects custom `--out` locations within the repository, including the generated ignore file itself.

Opt in to keeping the exported ROM, then reuse the fixtures to skip exports (their hashes are checked):

```sh
npm run battle:test -- --out work/fluffy-reusable --keep-fixtures
npm run battle:test -- --fixtures work/fluffy-reusable/fixtures
```

Fixture reuse tests that captured ROM build, not a newer ROM supplied alongside it. Omit `--fixtures` after changing handlers. Cached version 1 fixtures must also be regenerated for snapshot batching. The ability MVP covers these four first-hit Fluffy cases only, not ability suppression, Protective Pads, switching or multi-battles. The focused move runner covers named singles power, effectiveness, priority, accuracy, item and multi-hit stat-effect suites, including native setup actions, switching, Instruct and selected item/ability interactions; see [the test reference](INTERACTION-TESTS.md) for usage and exact scope. Child-DLL changes require a rebuilt full ROM, not a core-only override. Add controlled scenarios and explicit native outcome assertions for other mechanics; a screenshot alone is not a behavioral assertion. Visual/audio acceptance remains separate.

### Battle trigger verification

Every build executes the packaged DLL on an ARM946 CPU model: direct startup, all four formats, large trainer IDs, new-game/disabled passthrough, ABI preservation, music groups, saved zone/time/season, display enable before the battle process, cleanup ordering, win and loss event transitions, and repeated startup requests are covered. The actual native procedure runner and placement helpers execute in the CPU checks: each format must show every active Pokémon and HP bar exactly once, fade from either brightness direction, wait for busy resources, clear the procedure, and leave later battle openings unchanged. The display check executes the audited wrapper's sub-screen register update and verifies that existing layer settings survive. The version 5 trigger has 776 bytes of code/configuration and 4 bytes of state (780 bytes, excluding PMC bookkeeping). Skipping the opening adds 100 resident bytes over version 4 and no new heap allocation. There are 1,400 packaged CPU checks. Its temporary event is 68 bytes before allocator overhead, freed after battle. Native battle setup, parties and return-process allocations use the game's normal lifecycle. There is no per-frame allocation. Each manifest records the actual packaged size and CPU check count.

The browser configures a checked 16-byte data block in the bundled DLL; users need no native compiler. After a runtime update, generate a new test ROM and cold-boot it: an older emulator state restores the previous injected code and display registers. Refresh the template and its source-hash/CPU receipt with:

```sh
python3 runtime/battle-harness/build.py --trainer 1 --rule 0 --out runtime/battle-harness/build --bundle
```

```sh
npx vitest run src/test/battleHarness.test.ts src/test/testBattleBoot.test.ts src/test/testBattle.test.ts src/test/testBattleTeam.test.ts
```

For a real cold boot, install/use the headless melonDS Python API, set `PYTHONPATH` to its Python package and `MELONDS_HEADLESS_LIB` to its shared library, then run:

```sh
python3 scripts/test-battle-harness-headless.py /path/test.nds --report /path/headless-result.json
```

This copies the ROM/save to a temporary directory before running, supplies no input, checks the native trainer ID and format, compares the native player party against the prepared save (including HP/status/PP), verifies authored trainer fields, and writes a screenshot and JSON result. It asserts that no field initialization or season banner ran before battle, that all active Pokémon and HP bars are placed directly, the command menu is reached, the sub-screen output is enabled and its UI renders, and does not modify the input save. To play a simple singles scenario through native Fight/first move inputs and verify cleanup and field return, add `--finish-battle --max-frames 12000`. This mode sends A only after the automatic battle opening; it does not navigate startup menus. Human testing remains useful for visual/audio acceptance and more complex battle scenarios.

Direct cold boots passed for all four battle formats on White 2, an unchanged saved party, edited HP/status and form variants, and an expanded White2Upgrade party with hidden abilities. The final bundled runtime also passed Pokeweb-generated trainer and move-animation tests on both supported ROM families, including pending trainer and animation edits. Every direct boot reached battle without field initialization or a season banner. Version 5 direct-placement captures were inspected for each format; command and move screens passed button and touch selection on White 2 and White2Upgrade. A White 2 mid-battle switch retained the native recall and send-out effects; the updated display regression check rejects the blank-screen version 3 runtime. Overworld quick launch passed from ordinary projects and reloaded automatic-test ROMs, with no input, no battle, and a checksum-valid saved party.

Simple White 2 singles scenarios completed both a win and a defeat through the native battle-return processes. Each freed the battle setup once, returned to an idle field without starting a second battle, and retained a checksum-valid party; defeat recovery healed the party. Complete doubles, triples, rotation, and White2Upgrade battles remain outside these completion checks. Visual and audio acceptance remains a human check.

For the same Pokeweb White 2 trainer scenario, the battle opening moved from frame 853 on the previous field-triggered path to frame 456 on the direct path: approximately 14.2 to 7.6 seconds at 60 frames per second, or 47% sooner. This measures emulated frames from cold boot, not browser export or wall-clock emulator performance.

For the same unchanged White 2 trainer/save pair, version 5 reached the first command menu at frame 485 versus frame 1,418 with version 4: approximately 8.1 versus 23.6 seconds at 60 frames per second, saving 15.6 seconds (66%). Both versions began opening setup at frame 457; the savings come from skipping the presentation after setup. Native entry-ability messages can still delay the first command menu. This measures cold-boot emulated frames, not browser export or emulator wall-clock performance.

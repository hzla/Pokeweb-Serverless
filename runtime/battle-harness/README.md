# Direct save-to-battle harness

Creates a separate test ROM/save pair that starts a trainer battle immediately
after loading game data. It uses the actual trainer ID, battle rules, AI, party
generation and entry abilities while skipping field startup and introductions.
Ordinary exports do not include this test launcher.

Supports US revision-0 White 2 and compatible White2Upgrade layouts. Other ROM
families use their existing launch paths. Native hook signatures are checked.

```sh
npm run battle:harness -- --rom /path/game.nds --save /path/game.sav --trainer 123 --out /path/new-test.nds
npm run battle:harness -- --rom /path/game.nds --save /path/game.sav --config runtime/battle-harness/example.json --out /path/new-test.nds
```

The CLI accepts raw 512 KiB saves or DeSmuME DSV files. Outputs include ROM, SAV,
DSV and a JSON manifest; existing outputs are refused. Inputs are read-only.
Native builds use `ARM_TOOLCHAIN_BIN` and `RPM_TOOL_JAR`.

Scenario JSON requires `trainerId`. `battleType` optionally selects Singles,
Doubles, Triples or Rotation. `trainer.team` and `player.team` replace a party;
`player.edits` changes existing members by zero-based `slot`. Pokémon fields
include species/form, level, moves, item, ability slot/ID, gender, IVs and EVs.
Player edits also support nature, HP, status and four PP bytes. Replacement teams
contain one to six members. Trainer IVs must be uniform per member. See
`src/pokeweb/battleHarness.ts` for the validated schema and defaults.

Player status is a native condition ID, not a bit mask; sleep duration and Toxic
escalation must arise through native effects. Trainer ability overrides edit the
shared Personal slot in the temporary fixture. Difficulty/background use saved
zone data; terrain defaults to lawn and weather to none because no map is loaded.
This does not reproduce an overworld tile's scripts or environment. Complete
battle-return behavior requires gameplay testing for each format and ROM profile.

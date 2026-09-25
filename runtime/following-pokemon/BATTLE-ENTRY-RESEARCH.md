# Already-out follower at battle entry: binary investigation

This is an implementation investigation, not an installed battle feature. No game emulator was run. The first target is ordinary single wild and trainer battles; special, multi, facility, online, and scripted openings retain retail behavior unless individually audited.

## Reference behavior

HeartGold/SoulSilver constructs its follower as a field map object and, when a visible follower is present, writes the lead usable party index to the player entry of the battle setup's `unk1CC` array. Otherwise that array is initialized to `0xFF`. See [`battle_setup.c`](https://github.com/pret/pokeheartgold/blob/master/src/battle/battle_setup.c) around `sub_02051D18`. This confirms that follower visibility is intentionally passed to the battle system; it does not by itself establish the animation command used later.

The ordinary HGSS encounter script runs `ThrowPokeball` and `PokemonSlideIn`
as distinct commands for the player's first Pokémon in both wild and trainer
battles. See [`subscript_0000_StartEncounter.s`](https://github.com/pret/pokeheartgold/blob/master/files/battledata/script/subscript/subscript_0000_StartEncounter.s).
The user's observation that the trainer points while the already-out Pokémon
slides in is consistent with this split. The currently available source does
not identify the follower-specific visual branch inside the throw command, so
the exact pointing pose remains a visual acceptance item.

## White 2 path inspected

- The field module recalls its actor when `before()` sees native battle activity (`reason` bit 32). Its overlay-36 unload path deletes the actor without a ball effect. Avoiding the visible recall requires a handoff before field teardown; leaving the full field DLL loaded in battle is unnecessary.
- The ordinary initial send-out command in overlay 167 enters at `0x021B70E0`. It schedules the view command at `0x021D0088` and waits for completion. The view command reaches `0x021D3394` through the call at `0x021D0136`; overlay 168 owns additional visual effect code. The call site's bytes and ABI need to be pinned in the stock/Upgrade contract before patching.
- `0x021D3394` always calls the actor/visual helper at `0x021DF85C`, then conditionally starts effect `0x026D` through `0x021DF39C` based on its fifth argument. The fifth argument comes from `IsChapterSkipMode`, not follower state. Effect `0x026D` may include the trainer pose and ball together; changing that flag without decoding the effect would be an unsafe shortcut and could leave the send-out wait state or visual transition wrong.
- The existing `BattleViewCmd_Effect_BallThrow` at `0x021DF670` is reached by the capture-ball server command, so it is not a valid shortcut for removing the player's initial send-out animation.

## Split-module implementation boundary

Keep a small, versioned one-shot battle ticket in the resident core bridge: selected party slot and Pokémon identity, visible-at-transition flag, and generation. Arm it only on an audited field-to-battle transition, consume it once in a separate overlay-167/168 DLL, and clear it on cancellation, field reload, and battle teardown. The battle DLL must validate ordinary single battle type/style, non-link mode, player-side first send-out, and battle Pokémon identity before altering the native animation path; otherwise it forwards unchanged. The field DLL remains scoped to overlay 36 and is absent during combat.

Before release, identify the exact trainer-throw effect and already-out slide path, pin their instructions and data layouts on each target binary, and execute packaged CPU regressions for one-shot consumption, wrong party member, no visible follower, fainting, repeated battles, cancellation, and retail fallbacks. Human visual acceptance remains pending by request.

# BW2 follower script-command review

The stock US White 2 dispatch table has 755 opcode slots (`0x000`–`0x2F2`).
The supplied command sheet contains 660 of those IDs, including one blank name.
The revised runtime policy admits **373 commands**: 173 already admitted before
the first review, **135 added after source review**, **47 further named commands**,
and **18 child-event/application commands** admitted by project decision. The complete opcode-by-opcode decision
is in [script-command-review.csv](script-command-review.csv). The separate
[non-allowlisted command register](NON-ALLOWLISTED-COMMANDS.md) gives a reason
for each of the other 382 standard slots. `0x2C2` remains permitted only for
the verified Repel-continuation script.

Command numbers were taken from the stock US White 2 dispatch table and each
new handler is pinned by its address and first 16 bytes in `event-policy.json`.
The command implementations informed the behavior review, but their command
table does not have the same numeric ordering as the US ROM. A matching name
alone is therefore insufficient evidence to transfer an opcode number. The
allowlist only decides whether to recall before native dispatch; the existing
child-callback, actor movement, placement, deletion, mode, and teardown guards
still run afterward.

## Newly admitted commands

| Behavior | US opcodes | Reason |
| --- | --- | --- |
| Trainer and current-player state | `078`, `07F`, `082`, `083`, `084`, `088`, `08A`, `092`, `093`, `095`–`097` | Reads trainer/actor state or edits trainer flags without moving an actor. |
| Bag and money | `0B5`–`0BD`, `0F9`–`0FB`, `237`, `2D4` | Synchronous inventory and currency operations; no party selection or field handoff. |
| Day Care queries | `0EB`, `0EE`–`0EF`, `0F2`–`0F6`, `0F8` | Read or calculate Day Care state without depositing, withdrawing, or hatching a Pokémon. |
| Party and box queries | `0FE`–`103`, `108`, `10A`, `10D`, `110`, `112`–`116`, `118`–`11B`, `121`, `1B5`, `1D1`–`1D3`, `1D5`, `223`–`224`, `24E`, `2C0` | Read species, form, moves, health, parameters, eligibility, or storage counts. In particular, `116` is a general move query and no longer needs the Repel-only exception. |
| Save and progress state | `0D6`, `0D8`, `0DD`–`0DF`, `0E2`, `11D`–`11E`, `138`, `13A`–`13B`, `1C4`–`1C8`, `1CF`, `1EF`, `1F1`–`1F2`, `1F5`, `227`–`228`, `233`, `271`, `273`, `29F`, `2AF`, `2CF`–`2D0`, `2DE`, `2EE`–`2EF` | Queries and isolated save-data changes do not change the active actor or party identity. |
| Other queries | `1FB`–`1FC`, `21E`, `225`, `239`, `26E`, `272`, `27A`–`27F`, `294`, `29E`, `2A0`–`2A1`, `2BA`, `2BC`–`2BD`, `2DD`, `2DF` | Return a result or calculate text/game data without creating a field scene. |
| Word formatting | `05D`, `11F`, `21A`, `22F`, `236`, `23E`, `26C`–`26D`, `299`–`29B`, `2DC` | Populate the current script's word buffer. |
| Sound and counters | `23A`, `24C`, `2B8`–`2B9` | `23A` uses the same verified cry child layout as `0AB`; `24C` resumes ambience synchronously; the counter commands only change saved step counting. |

There are **142 named commands deliberately deferred** for movement, party
mutation, battles, field changes, or presentation sequences.
This includes fades: `1A3`, `1A4`, and `1A7` still have the existing narrow PC
continuity exception, but are not globally allowed. These deferred commands
and their categories are enumerated in the CSV.

## Child events and applications admitted by project decision

The nine asynchronous child-event commands `08B` TrainerBGMPlayPush, `08F`
TrainerClassBGMPlayPush, `090` TrainerBGMPlay, `0F7` DayCareCallPokeSelect,
`1C2` ElevatorBuildListMenu, `1D0` UnityTowerCallFloorSelect, `235` BGMPlayEx,
`238` BGMChangeMapEx, and `274` FunfestMissionStart are now globally allowed at
opcode dispatch. The nine child-application commands `149` CallFriendlyShopBuy,
`14D` CallRecordSystem, `14E` CallBag, `150` CallMailbox, `151`
CallPokedexDiploma, `152` CallGeonet, `155` CallXTransceiver, `1F0`
TrialHouseDownloadBattleTest, and `23F` CallPlaceNameDisp are likewise allowed.

This admission only bypasses recall **before those 18 commands execute**.
Subsequent child callbacks and field-mode changes retain their separate guards;
some of these commands may still cause recall after dispatch. Their callback
lifetime is not established as safe for global retention.

## Additional named commands admitted by project decision

The following **47 named commands** are now in the global opcode allowlist as
requested. Their stock US handler pointers and first 16 bytes are pinned, and
the Black 2 and Italian handler addresses are checked against their own dispatch
tables. The remaining concerns below are **not resolved by admitting the opcode**:
an asynchronous child event, field transition, or actor change can still invoke
the existing scene guards and recall the follower. They should receive targeted
script-lifetime checks before being described as safe in every cutscene.

| Opcodes and sheet names | Remaining scene-lifetime concern |
| --- | --- |
| `08D` TrainerBattleIsVictory; `177` WildBattleIsVictory; `178` WildBattleGetResult | Query-like battle results, but the event may be in a field restart or battle-return chain. |
| `0D9` FieldSetTeleportZone; `0DA` MapReplaceSetEvent; `0DB` FieldSetNextZoneHere; `0DC` FieldSetNextZone | Need to distinguish staging a destination from immediately changing field ownership or actor placement. |
| `0E3` PlayerEnableRunningShoes; `134` CasteliaRushInit; `136` FieldSetWeather; `19A` CGearControlWarning; `19B` PlayFieldEffect; `24B` FieldSubscreenDisable | May change player presentation, lighting, effects, or subscreen ownership. |
| `0EC` DayCareBreed; `0ED` DayCareResetSeed | Change breeding state; verify that no party or egg callback occurs in the same handler. |
| `137` SaveDataWrite; `139` GameCommDisconnect | May suspend the script or alter field lifecycle and communication state. |
| `1C1` ElevatorSetTablePtr; `1E1` StadiumLoadTrainerTable; `1E2` StadiumFreeTrainerTable; `1E5` StadiumResetTrainerFlags; `1E6` TrialHouseWorkInit; `1E7` TrialHouseWorkDelete; `1EA` TrialHousePrepareOpponent; `1ED` TrialHouseSetUseDownloaded; `1EE` TrialHouseUpdateBattleTestRank; `1F3` TrialHouseSaveData; `1FA` PepQuizGenerate | Work/table setup or teardown may own temporary actors or a different field heap. |
| `1EB` TrialHouseMsgDisp; `230` MsgAbyssalRuins; `278` FunfestDispSalesmanMessage | Special message paths need child-callback and cleanup checks. |
| `1FF` SurveyGetCurrentQuestionID; `200` SurveyGetCurrentAnswerIDs; `201` SurveyGetPopularOptionMsgID; `204` SurveyGetTime | Handlers live in an additional overlay; callback and scene-lifetime behavior still need checking. |
| `20D` PokePartyFindEx; `252` ActorPairGetTrID | Getter-looking commands, but the extended party and actor-pair paths need direct US behavior checks. |
| `245` BGMFadeOut; `246` BGMFadeOutAll; `279` FunfestBGMReturn; `2BB` Gym0601FanAmbienceStart | Check whether they start an audio child event, as other BGM commands do. |
| `295` HiddenHollowReset; `2C6` JoinAvenueStoreStart; `2C7` JoinAvenueStoreEnd; `2E1` MedalDiscoverInitial; `2E3` LensFlareRequest; `2E5` HiddenHollowSet | May alter field event ownership, spawn effects, or perform broader initialization. |

The sheet also uses placeholder `CMD_*` names for **143 still-unresolved
commands**. Their IDs remain outside the allowlist so none silently become safe
through a name guess:

```text
0C9 0CA 0CE 0E4 0E5 0E6 0E7 0E8 13C 13D 13E 15B
15C 15F 163 164 165 166 167 168 169 16A 16E 170
172 17A 17B 17C 17D 186 187 18C 18D 18E 18F 190
191 1A1 1AF 1B0 1B2 1B3 1CC 1CD 1CE 1DB 1DC 1DD
1DE 1DF 1F6 1F7 1F8 1F9 1FD 1FE 202 203 207 208
209 20A 20B 20C 20E 20F 210 211 212 213 215 216
218 219 21D 21F 220 221 222 226 22A 22B 22D 22E
232 23B 23C 23D 240 241 249 24A 24D 25A 25B 25C
25D 25F 262 263 264 265 266 267 268 269 275 28E
28F 291 292 2A2 2A3 2A4 2A5 2A6 2A7 2A8 2A9 2AE
2B1 2B2 2B3 2B4 2B5 2B6 2B7 2C3 2C4 2C5 2CB 2D1
2D3 2D5 2D7 2D8 2D9 2DA 2E8 2E9 2ED 2F1 2F2
```

Another **95 opcode slots are absent from the supplied sheet**; all 95 have
null pointers in the stock US dispatch table. Opcode `298` has an empty sheet
name but a non-null handler, so it remains unresolved. They are separately
marked in the CSV and the non-allowlisted command register. None was admitted.

No emulator was run. Source and binary checks establish the command-level
policy, not visual acceptance of every field event. An unexpected recall
should be reported with the script ID, executed opcode, callback address (if
any), and `FollowingSceneDebug.reason`.

## Verification status

Stock White 2, Black 2, Italian White 2, and White2Upgrade base/full builds and packaged CPU
scene checks passed with all 373 admissions, including ordinary Yes/No and list
choice callbacks. All 373 handler pointers match the four available profile
ROMs; stock White 2 and White2Upgrade also match their pinned handler bytes.
No emulator was run. All four profiles' base/full
field and event bundles were republished after their full packaged CPU suites.

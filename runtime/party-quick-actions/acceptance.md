# Party toolbar acceptance — 0.1.5

Verified on 2026-10-10. CPU harness checks, app tests and emulator observations are separated below. Physical hardware and general hack compatibility are not certified.

## Passed checks

- Separate English revision-0 B2/W2 profiles verify hook destinations, callback words, native APIs, field-request construction, saved-flag reader/bounds, next-level EXP, nickname copying, confirmation printing, palette proxies/uploads, party selector animation, navigation sound 1352 and potion recovery sound 1391. Native Full Restore item 23 resolves to its checked graphics/palette pair in each game. Extracted graphics match between games.
- Compiled ARM harness in both profiles: registers/stack; HP bounds/repeat/slot lock; status apply/clear and HP-mode exit; XP confirmation/cancellation, nickname acknowledgement and held-touch suppression; L/A navigation through nine icons; native movement sound, one-pixel selector and native-color fade; fixed glyph/icon/HP-underline colors; owned Candy requests and evolution callbacks.
- Heal Team harness: exact “Heal Party? A:Yes B:No” prompt; A/Yes acceptance, B/No cancellation, slot lock, no party writes before acceptance, held-touch/key suppression, allocation failure and prompt teardown. Both paths restore toolbar selection. After acceptance, every existing non-fainted member heals and loses its status; fainted members, Eggs, an all-fainted team and slots beyond the actual party count remain untouched. Selected Eggs do not prevent healing the rest of the team. EXP/PP and item quantities stay unchanged. HP adjustment exits, the recovery sound plays once, and held touches do not repeat the action.
- Optional flag harness: blank and legacy configurations stay on; saved flags 1, 0x05EE and 3059 gate the toolbar and native prompt suppression. Set flags restore vanilla input and do not hide native controls. Missing/mismatched request ownership and invalid flags fall back to the original menu. Flag bytes and neighboring bits remain unchanged, and captured references clear on teardown.
- Resource harness: nine actors/character uploads, three palette banks and persistent 96-byte palette data; occupied-bank conflicts; heap/VRAM capacity checks; every initialization allocation-failure point, including later native prompt restoration after failure; repeated cleanup; no per-frame allocations. Native prompt-map edits stay inside their owned rectangle and preserve actual message windows.
- **87 focused app tests across four files**, including thirty-two toolbar tests. Tests cover automatic Infinite Rare Candy installation, conflicting item-slot rejection, atomic rollback, repeated installation/disable/enable, save-flag parsing/bounds/preservation/clearing, export/reopening, in-place upgrades from 0.1.0–0.1.4, changed hooks/graphics, conflicting modules and bundle retrieval failures. The requested two-line description and flag field are checked. Existing Code Injection, Enhanced Party Menu and C-Gear installer tests pass.
- TypeScript and the production Vite build pass. The existing bundle-size advisory remains.

## Emulator observations

| Setup | Observed behavior |
| --- | --- |
| B2, C-Gear off, six hurt members, no Infinite Candy | Heal Team is available without Candy or Full Restore ownership. Touch displays the exact confirmation and exits HP adjustment; held touch cannot confirm. B and tapping No leave every member unchanged. Tapping Yes restores HP/status for all five conscious members, leaves fainted Oshawott at 0/46 with its original status, and preserves every member's EXP/PP. L/A opens the same question; B cancels back to the same toolbar item and A confirms. Holding A does not heal again. Party close/reopen preserves the changes. |
| W2, C-Gear on, six hurt members, companions, flag 0x05EE clear | The same confirmation text, touch/key cancellation, team-healing, fainted-member preservation, HP-mode exit, keyboard activation and close/reopen checks pass with the optional hide flag configured. Companion modules: Battle Log, Enhanced Party Menu, Learnset Viewer, Summary enhancements, Porta PC and C-Gear Quick Actions. |
| Earlier 0.1.4: both games, six members, flag 0x05EE set | No toolbar session initializes. The standard prompt, gray control, red X and blue Back remain. L/tapping the custom icon positions does not activate custom actions; native Party closes/reopens normally. |
| Earlier 0.1.4: B2, C-Gear off, six members, default configuration | Nine-icon layout: L locks the member; arrows navigate; A activates HP, XP and sleep status. XP touch/keyboard cancellation retains EXP; confirmation edges Oshawott from 2,035 to 2,534 EXP while level stays 15 and shows “Oshawott's xp was edged!”. Party reopening preserves EXP. The selector tracks the native completed-frame palette through scheduled uploads: a 64-frame cycle with 24 distinct teal shades. The red X and checkmark box are hidden and their old touch areas are inactive; blue Back remains. |
| Earlier 0.1.4: W2, C-Gear on, six members, companions, flag 0x05EE clear | Holding Candy applies once: Oshawott 16 → 17, native messages/move learning and evolution to Dewott, then normal Party selection and the toolbar return. The new flag-owner capture does not break the evolution return. |

Both healing rows were rerun against the final 0.1.5 bundle. Other emulator rows are retained as explicitly labeled 0.1.4 observations; their action routes are unchanged. The 0.1.5 compiled harness reruns XP, navigation, flags, Candy/evolution ownership and resource regressions in both profiles.

## Delivery and manual acceptance

The versioned delivery folder contains separately named B2/W2 ROMs and copied initial saves, confirmation/healing screenshots, an optional flag-set fixture, controls and this checklist. The delivered DLLs match the bundled assets, and all thirteen private archive members/configuration are checked. Original ROMs, saves and earlier deliveries are preserved.

- [ ] Install/update the toolbar in Pokeweb; confirm the exact two-line description and optional flag field.
- [ ] Leave the flag blank: enter normal field Party, see the toolbar, and navigate with L/arrows/A or touch.
- [ ] Use Heal Team with damaged/statused members and a fainted member: verify “Heal Party? A:Yes B:No”, cancel with B/No without changing the party, then accept with A/Yes. Conscious members heal, fainted members stay fainted, and the native potion recovery sound plays only after acceptance.
- [ ] Check held-touch suppression, status toggles, HP bounds/locking, XP confirmation/acknowledgement and native Candy/evolution flows.
- [ ] Configure a saved flag: set it through the game's script/save tooling, verify the original Party menu returns; clear it and reenter Party to restore the toolbar.
- [ ] Export/reopen in Pokeweb; confirm the chosen flag survives, and clearing the installer field removes the condition.
- [ ] Save/reload edited Pokémon in the game, listen to sounds on hardware/emulator audio, and cover prolonged play and unusual/cancelled evolutions.

## Limits

English revision-0 BW2 only; BW1, other languages and changed checked handlers are rejected. No upgrade build was gameplay-tested. Infinite Rare Candy's reserved-item compatibility rules still apply. Non-field Party requests retain native behavior, but the complete matrix of battle/trade/item-target modes has not been gameplay-tested. Eggs, all-fainted parties, level 100 and allocation failures are covered by isolated tests rather than the entire emulator matrix. Audible comparison, physical hardware, long sessions and actual save/reload still need manual coverage. Menu close/reopen persistence is distinct from saving/reloading. Test scripts grant items/change flags only in copied fixtures; installation and activation never write visibility flags.

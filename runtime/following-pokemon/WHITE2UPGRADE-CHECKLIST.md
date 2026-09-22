# White2Upgrade follower 0.7.15-alpha — human emulator checklist

All rows start NOT RUN. Automated CPU tests are not DS emulator results.
Cold boot the versioned ROM with its same-basename ordinary save. Do not load a
state captured under another ROM version. The prior 0.7.5 save was copied for
continuity; source saves remain intact. Keep expansion save copies separate from
stock White 2 once later-generation Pokémon are obtained.

Start with U01, U17 and U16, then U07a at Floccesy Town / Route 20, U15 and U02–U08. Test in melonDS; record the emulator version,
ROM hash, species/form/gender/shiny, location, result and screenshot/state for any
failure. Existing detailed cases remain in [EMULATOR-CHECKLIST.md](EMULATOR-CHECKLIST.md).

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
| U17 | Run I01–I05 from EMULATOR-CHECKLIST with a stock follower and a wide Gen 6–9 follower. | The native directional idle loop runs only while visible ordinary following is active. Dialogue, menus, PC presentation, safe scenes and ball effects keep the current frame frozen. | NOT RUN |
| U16 | Run W01–W05 from EMULATOR-CHECKLIST with narrow and wide Gen 6–9 art, forms, shinies and a placeholder. | Spacing follows maximum visible side width, up to six extra world units. Conversations, turns, stairs, menu/PC retention and seamless crossings remain correct. | NOT RUN |
| U01 | Cold boot White2Upgrade-Following-0.7.15-alpha.nds with an ordinary matching save. Walk, run, reverse and stop. | Exactly one follower appears; no startup freeze, stuck input or duplicated actor. | NOT RUN |
| U01a | After startup, close the X menu, enter/leave PC storage without party changes, then cross a seamless zone boundary. Separately test a door and a battle. | Menu closure and seamless crossings retain the follower. Unchanged PC lead returns visibly without ball effects. Doors/battles use normal recall/reseed; capture a state if absent. | NOT RUN |
| U02 | Put Chespin (650), Rowlet (722), Grookey (810), and Iron Crown (1023) at the front in turn. Test all four directions. | Every lead uses its own artwork, including Iron Crown; none is skipped as an invalid species. | NOT RUN |
| U03 | Use Sprigatito, Meowscarada, Koraidon, Miraidon, Poltchageist and Iron Crown, both normal and shiny. Then try an explicitly substituted alternate form. | Base species display matching artwork with correct directions and transparency. Alternate-form substitutions match UPGRADE-ASSET-COVERAGE.json without changing species or nickname. | NOT RUN |
| U04 | Try shiny Gen 6–8 leads, female Pyroar/Meowstic/Indeedee/Basculegion, Vivillon patterns, Hisuian Goodra, Hoopa Unbound, Zygarde 10%/Complete, and available upgraded forms. | Mapped art matches. Unmapped, Mega or missing variants use the documented substitution; no next-species sprite or bright-magenta pixels. Record the exact form ID. | NOT RUN |
| U05 | Repeat D04/D07–D12 of EMULATOR-CHECKLIST with Zekrom, Sigilyph and a new large follower. | The accepted 0.6.10 stair and overlap behavior is retained; no building clipping regression. | NOT RUN |
| U06 | Talk to a Gen 6–9 lead from every direction, including one displaying a placeholder. Test HP/status responses and repeated A/B presses. | Real nickname/status drive the conversation, no stuck controls, and follower stays after dismissal. Record native cry behavior separately; this patch adds no cry assets. | NOT RUN |
| U07a | Run stock checklist X01–X07 with later-generation followers, including a same-species different-personality lead swap in PC storage. | Unchanged lead stays out; changed selected Pokémon replaces after walking. Seamless boundaries retain the actor; scene conflicts still recall. | NOT RUN |
| U07 | Talk to NPCs/signs, open the X menu and PC boxes, withdraw/deposit/reorder later-generation party members, then return. | Follower pauses visibly where field ownership permits, refreshes identity, and returns exactly once. PC field reconstruction does not leave stale pointers. | NOT RUN |
| U08 | Trigger a forced-movement scene, story partner, battle, healing, blackout, Surf, cycling, stairs, door and map transition. | Existing pause/recall rules apply and normal player control returns. Upgrade battles and forms continue working. | NOT RUN |
| U09 | Enter and leave battle/field 100 times in mixed sequences, with menus/dialogue/PC operations between transitions. Spend at least 10 minutes in a crowded area. | No accumulating allocation, duplicate actor, missing texture, growing lag or stuck input. Log PMC/field heap and texture counts, or mark allocation checks UNMEASURED. | NOT RUN |
| U10 | Reorder with fainted leads, Eggs, and an all-fainted party. Evolve or change the form of a later-generation lead. | First healthy non-Egg follows; fallback fainted selection works outside blackout; selected identity and art refresh safely. | NOT RUN |
| U11 | Save normally, cold boot this patched ROM, then open a COPY of that save in the original compatible White2Upgrade ROM. | No follower saved into native actor records. Upgrade save features remain intact. Do not use expanded-species saves in stock White 2. | NOT RUN |
| U15 | Run N01–N08 from EMULATOR-CHECKLIST with a Gen 6–9 lead, then repeat with a small Gen 1–5 lead. | Wandering NPCs wait at the follower; player and trainer sight remain unaffected. Scripted conflicts still recall; blocked follower trail reseeds safely. | NOT RUN |
| U13 | Rapidly switch among stock Unown forms, Vivillon patterns, shiny/non-shiny and gender variants through the party and PC. Return to the field and talk each time. | Page changes preserve the correct appearance and real identity; no missing follower, stale form or delay that grows with repeated changes. | NOT RUN |
| U14 | Complete 100 conversations rotating species 650, 722, 810 and 1023. Use long nicknames and normal/low HP; walk and open a menu between conversations. | All supported later-generation leads respond, text closes normally, one follower remains, and no accumulating effects or stuck controls occur. Mark allocation checks UNMEASURED without telemetry. | NOT RUN |
| U12 | In Pokeweb reinstall, disable, reenable, export/reopen, remove and reinstall the follower. | Correct expansion profile is retained, no duplicate DLLs, and White2Upgrade modules/imported assets remain present. | NOT RUN |

Hardware acceptance is separate and untested. For U09 record checkpoints 0 / 10 / 25 / 50 / 75 / 100, actor count, controls, visible effects and measured allocation counts.

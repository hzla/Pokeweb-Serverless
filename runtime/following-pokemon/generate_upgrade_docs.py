"""Generate expansion asset coverage and the human-only acceptance checklist."""
from pathlib import Path
import json
HERE=Path(__file__).resolve().parent
manifest=json.loads((HERE.parents[1]/'src/assets/following/white2upgrade/later-followers.json').read_text())
rows=[]
for generation,lo,hi in [(6,650,721),(7,722,809),(8,810,905),(9,906,1023)]:
    entries=[e for e in manifest['appearances'] if lo<=e['species']<=hi]
    exact={e['species'] for e in entries if e['form']==0 and not e['shiny'] and not e['placeholder']}
    rows.append(dict(generation=generation,species=hi-lo+1,baseArtwork=len(exact),missingBaseSpecies=[n for n in range(lo,hi+1) if n not in exact],appearances=len(entries),placeholderAppearances=sum(e['placeholder'] for e in entries)))
coverage={'profile':'white2upgrade','speciesMax':1023,'generationCoverage':rows,'placeholders':[e for e in manifest['appearances'] if e['placeholder']]}
(HERE/'UPGRADE-ASSET-COVERAGE.json').write_text(json.dumps(coverage,indent=2)+'\n')
cases=[
('U17','Run I01–I05 from EMULATOR-CHECKLIST with a stock follower and a wide Gen 6–9 follower.','The native directional idle loop runs only while visible ordinary following is active. Dialogue, menus, PC presentation, safe scenes and ball effects keep the current frame frozen.'),
('U16','Run W01–W05 from EMULATOR-CHECKLIST with narrow and wide Gen 6–9 art, forms, shinies and a placeholder.','Spacing follows maximum visible side width, up to six extra world units. Conversations, turns, stairs, menu/PC retention and seamless crossings remain correct.'),
('U01','Cold boot White2Upgrade-Following-0.7.23-alpha.nds with an ordinary matching save. Walk, run, reverse and stop.','Exactly one follower appears; no startup freeze, stuck input or duplicated actor.'),
('U01a','After startup, close the X menu, enter/leave PC storage without party changes, then cross a seamless zone boundary. Separately test a door and a battle.','Menu closure and seamless crossings retain the follower. Unchanged PC lead returns visibly without ball effects. Doors/battles use normal recall/reseed; capture a state if absent.'),
('U02','Put Chespin (650), Rowlet (722), Grookey (810), and Iron Crown (1023) at the front in turn. Test all four directions.','Every lead uses its own artwork, including Iron Crown; none is skipped as an invalid species.'),
('U03','Use Sprigatito, Meowscarada, Koraidon, Miraidon, Poltchageist and Iron Crown, both normal and shiny. Then try an explicitly substituted alternate form.','Base species display matching artwork with correct directions and transparency. Alternate-form substitutions match UPGRADE-ASSET-COVERAGE.json without changing species or nickname.'),
('U04','Try shiny Gen 6–8 leads, female Pyroar/Meowstic/Indeedee/Basculegion, Vivillon patterns, Hisuian Goodra, Hoopa Unbound, Zygarde 10%/Complete, and available upgraded forms.','Mapped art matches. Unmapped, Mega or missing variants use the documented substitution; no next-species sprite or bright-magenta pixels. Record the exact form ID.'),
('U05','Repeat D04/D07–D12 of EMULATOR-CHECKLIST with Zekrom, Sigilyph and a new large follower.','The accepted 0.6.10 stair and overlap behavior is retained; no building clipping regression.'),
('U06','Talk to a Gen 6–9 lead from every direction, including one displaying a placeholder. Test HP/status responses and repeated A/B presses.','Real nickname/status drive the conversation, no stuck controls, and follower stays after dismissal. Record native cry behavior separately; this patch adds no cry assets.'),
('U07a','Run stock checklist X01–X07 with later-generation followers, including a same-species different-personality lead swap in PC storage.','Unchanged lead stays out; changed selected Pokémon replaces after walking. Seamless boundaries retain the actor; scene conflicts still recall.'),
('U07','Talk to NPCs/signs, open the X menu and PC boxes, withdraw/deposit/reorder later-generation party members, then return.','Follower pauses visibly where field ownership permits, refreshes identity, and returns exactly once. PC field reconstruction does not leave stale pointers.'),
('U08','Trigger a forced-movement scene, story partner, battle, healing, blackout, Surf, cycling, stairs, door and map transition.','Existing pause/recall rules apply and normal player control returns. Upgrade battles and forms continue working.'),
('U09','Enter and leave battle/field 100 times in mixed sequences, with menus/dialogue/PC operations between transitions. Spend at least 10 minutes in a crowded area.','No accumulating allocation, duplicate actor, missing texture, growing lag or stuck input. Log PMC/field heap and texture counts, or mark allocation checks UNMEASURED.'),
('U10','Reorder with fainted leads, Eggs, and an all-fainted party. Evolve or change the form of a later-generation lead.','First healthy non-Egg follows; fallback fainted selection works outside blackout; selected identity and art refresh safely.'),
('U11','Save normally, cold boot this patched ROM, then open a COPY of that save in the original compatible White2Upgrade ROM.','No follower saved into native actor records. Upgrade save features remain intact. Do not use expanded-species saves in stock White 2.'),
('U15','Run N01–N08 from EMULATOR-CHECKLIST with a Gen 6–9 lead, then repeat with a small Gen 1–5 lead.','Wandering NPCs wait at the follower; player and trainer sight remain unaffected. Scripted conflicts still recall; blocked follower trail reseeds safely.'),
('U13','Rapidly switch among stock Unown forms, Vivillon patterns, shiny/non-shiny and gender variants through the party and PC. Return to the field and talk each time.','Page changes preserve the correct appearance and real identity; no missing follower, stale form or delay that grows with repeated changes.'),
('U14','Complete 100 conversations rotating species 650, 722, 810 and 1023. Use long nicknames and normal/low HP; walk and open a menu between conversations.','All supported later-generation leads respond, text closes normally, one follower remains, and no accumulating effects or stuck controls occur. Mark allocation checks UNMEASURED without telemetry.'),
('U12','In Pokeweb reinstall, disable, reenable, export/reopen, remove and reinstall the follower.','Correct expansion profile is retained, no duplicate DLLs, and White2Upgrade modules/imported assets remain present.'),
('U18','Walk slowly on stairs and curved paths with a wide Gen 6–9 follower, reverse direction, then cross a seamless zone boundary.','The reduced 64-record trail keeps the follower on the actual path without an unexpected recall or shortcut. Record any recall and exact path.'),
('U19','Cold boot 0.7.21 with the matching save and Mewtwo as lead at the location of noshadow.mln. Walk two tiles until it appears, then stop and inspect its feet. Repeat with a small Gen 6–9 lead on flat terrain and stairs, and after a door or seamless boundary.','A single native shadow appears under Mewtwo and each other follower, tracks ground height, disappears on recall, and never duplicates or detaches from its feet. If absent, save a new 0.7.21 state.'),
('U20','Compare grounded Gen 1–5 and Gen 6–9 followers with Flying-type followers on flat ground and stairs, both idle and walking.','Grounded artwork aligns with its existing native shadow; Flying artwork keeps its previous height. The player, shadow position, and depth ordering remain unchanged.'),
('U21','For diagnosis only, compare the same grounded follower at the same position in 0.7.19 and 0.7.20.','The extra three pixels in 0.7.20 also move the native shadow. This is the known regression corrected by 0.7.21.'),
('U22','Cold boot 0.7.21 with a small grounded follower and Serperior; compare their shadows with the player on flat ground and stairs.','Lowered follower artwork remains in place, while complete follower shadows return to the player ground plane. No half-shadow or duplicate shadow appears.'),
('U23','Cold boot 0.7.22 with Serperior and compare facing up/down on flat ground and stairs, including the complete shadow. Repeat left/right with a wide follower.','Up-facing shadow and art shift upward by about seven and five pixels; down-facing shadow and art shift downward by about six pixels. Lateral spacing and depth behavior remain stable.'),
('U24','Cold boot 0.7.23 with Serperior and walk north until it overlaps the player. Repeat with a wide later-generation follower, then check stairs and a building frontage.','The north-facing follower wins the player overlap while its artwork and native shadow stay in place; stairs and building depth do not regress.'),
]
text='''# White2Upgrade follower 0.7.23-alpha — human emulator checklist

All rows start NOT RUN. Automated CPU tests are not DS emulator results.
Cold boot the versioned ROM with its same-basename ordinary save. Do not load a
state captured under another ROM version. The prior alpha save was copied for
continuity; source saves remain intact. Keep expansion save copies separate from
stock White 2 once later-generation Pokémon are obtained.

Start with U01, U17, U16 and U18, then U07a at Floccesy Town / Route 20, U15 and U02–U08. Test in melonDS; record the emulator version,
ROM hash, species/form/gender/shiny, location, result and screenshot/state for any
failure. Existing detailed cases remain in [EMULATOR-CHECKLIST.md](EMULATOR-CHECKLIST.md).

| ID | Steps | Expected | Result / evidence |
|---|---|---|---|
'''+''.join(f'| {i} | {steps} | {expected} | NOT RUN |\n' for i,steps,expected in cases)
text+='\nHardware acceptance is separate and untested. For U09 record checkpoints 0 / 10 / 25 / 50 / 75 / 100, actor count, controls, visible effects and measured allocation counts.\n'
(HERE/'WHITE2UPGRADE-CHECKLIST.md').write_text(text)
print(json.dumps(rows,indent=2))

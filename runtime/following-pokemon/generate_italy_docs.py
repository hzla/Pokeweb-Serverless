"""Generate the Italian follower release notes, validation record and human checklist."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPOS = HERE.parents[3]
ASSETS = HERE.parents[1] / "src/assets/following/white2italy"

CASES = [
 ("I01", "Cold boot 0.6.33 from an ordinary Italian IRDI save. Walk and run in four directions with a healthy non-Egg lead.", "Exactly one follower appears after walking; movement and controls remain responsive."),
 ("I02", "Try an empty party, Eggs only, a fainted lead, and an all-fainted party before blackout.", "Selection follows the stock rules; no invalid actor or access during blackout."),
 ("I03", "Use small and large species, normal and shiny, alternate forms and gender differences; inspect up/down frames.", "Correct species/form palette and direction, with no placeholder except identified missing art."),
 ("I04", "Idle, turn rapidly, reverse into the follower and walk laterally beside a building.", "Idle animation works; overlap is passable and depth priority remains stable without building clipping."),
 ("I05", "Walk up/down stairs and across left/right stair segments with a large Zekrom or Kyurem follower.", "No player/follower priority flicker, sinking or railing clipping beyond the known visual limits."),
 ("I06", "Traverse ledges and consecutive jumps; cross bridges and floors at different heights.", "Recorded transitions replay without a visible teleport or following across disconnected geometry."),
 ("I07", "Walk a curved rail path and a non-grid area, then return to normal grid movement.", "Follower trails the actual route with no recall solely because of movement mode."),
 ("I08", "Cross a seamless boundary such as Floccesy Town to Route 20 and back repeatedly.", "The same follower remains visible without recall/send-out animation."),
 ("I09", "Enter/exit doors, stairs, elevators and a warp; use Fly or escape where available.", "Required recalls happen before field replacement and one follower returns after walking."),
 ("I10", "Open/close the bottom menu, party, summary and Bag repeatedly.", "Follower stays visible and paused; no control freeze or duplicate actor."),
 ("I11", "Open the PC, view boxes without changing the lead, then deposit/withdraw or replace that Pokémon.", "Unchanged lead stays out; changed selection refreshes after field control returns."),
 ("I12", "Talk to stationary NPCs, moving NPCs, signs and furniture/trash cans.", "Safe dialogue keeps the follower visible; idle NPC routes do not force an unnecessary recall."),
 ("I13", "Trigger a stationary scene, camera pan, emote and sound cue; then an NPC route crossing the follower.", "Safe presentation retains the actor; a true occupied-space conflict recalls before movement."),
 ("I14", "Trigger scripted player walking/jumping, a battle, a story partner and a field teardown.", "Follower recalls before unsafe actions and never changes native partner or battle state."),
 ("I15", "Talk to the follower from all four directions, including on rail/non-grid maps.", "Pokémon faces player, performs reaction/cry/emote and resumes following after dialogue."),
 ("I16", "In 0.6.31, talk with full HP, low HP, poison, sleep, burn, freeze, paralysis and varied friendship.", "Italian generic reactions follow the same HGSS conditions and probability order; accented è renders correctly."),
 ("I17", "Try nicknames/player names with supported accented characters and advance text at slow/fast speeds.", "Name substitutions and native text pagination render without raw tokens or truncation."),
 ("I18", "Author one Aspertia City species/zone dialogue rule in Pokeweb, export and cold boot.", "Matching lead gets authored text; other leads use Italian generic reactions."),
 ("I19", "Author a one-time gift, claim it, save/reload, then talk again; repeat with a full Bag.", "First successful claim adds one item; claim persists; full Bag displays the Italian retail response without consuming the claim."),
 ("I20", "Reorder party, use PC, evolve or hatch a Pokémon, then talk and test a gift.", "Identity, nickname, cry and per-Pokémon gift claim belong to the current Pokémon."),
 ("I21", "Cycle, Surf, Dive, fish and return to walking; visit communication or special activity modes if available.", "Follower recalls only for guarded activities and reconstructs afterward."),
 ("I22", "Save, close the emulator, cold boot the same ROM/save, and separately open a copy of the save in clean Italian White 2.", "One reconstructed follower in patched game; save remains readable by clean Italian game."),
 ("I23", "Repeat 100 mixed conversations and transitions; every tenth cycle use a menu or PC and every twentieth cross a map seam.", "No stuck input, duplicate follower, accumulating allocations or lingering emotes/window/locks."),
 ("I24", "Compare prior language and grounding alphas with 0.6.31 only if diagnosing a regression.", "Italian dialogue and the lower sprite position remain; 0.6.31 separates sprite positioning from the native shadow."),
 ("I25", "Compare grounded Bulbasaur or Mewtwo with Flying-type Pidgeot or Charizard on flat ground and stairs; inspect feet and shadows while idle and walking.", "Grounded artwork sits at its existing native shadow without a transparent-row gap. Flying artwork keeps its prior height; shadow position, player sprite and stair depth stay unchanged."),
 ("I26", "For diagnosis only, compare the same grounded follower at the same position in 0.6.29 and 0.6.30.", "0.6.30 adds three pixels to the sprite but also moves the native shadow; this is the reported regression corrected by 0.6.31."),
 ("I27", "Cold boot 0.6.31 with a small grounded follower and Serperior; compare their shadows with the player on flat ground and stairs.", "The sprite keeps its lowered artwork position while its full shadow stays at ground level, aligned with the player shadow. Serperior has a complete shadow rather than only its top half."),
 ("I28", "Cold boot 0.6.32 with Serperior. Face up and down on flat ground, then walk in both directions on stairs. Inspect the full shadow as well as the sprite; check left/right afterward.", "Facing up shifts shadow about seven pixels and art about five pixels upward; facing down shifts both about six pixels downward. Left/right positioning stays unchanged."),
 ("I29", "Cold boot 0.6.33 with Serperior, walk north until it overlaps the player, then check stairs and lateral movement beside a building.", "The north-facing follower draws in front of the player at the overlap; the confirmed sprite/shadow position and other depth cases remain stable."),
]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def generate():
    audit = json.loads((HERE / "build/white2italy/binary-audit.json").read_text())
    manifest = json.loads((ASSETS / "runtime.json").read_text())
    localized = json.loads((ASSETS / "interactions.json").read_text())
    directional = REPOS / "White2Italy-Following-0.6.33-alpha.nds"
    if manifest["version"] != "0.6.33-alpha" or localized["language"] != "it":
        raise ValueError("Italian release inputs differ from the audited package")
    lines = ["# Italian White 2 Following Pokémon", "",
             "The IRDI revision-0 port is installed through Pokeweb's Following Pokémon page. It includes stock species 1–649, movement, scenes, interactions, gifts and the existing Gen 5 art bundle.", "",
             "The current test ROM is available:", "",
             f"- `White2Italy-Following-0.6.33-alpha.nds`: retains the facing-specific artwork/shadow anchors and restores the north-facing follower's prior foreground depth against the player; SHA-256 `{sha(directional)}`.", "",
             "Only the exact clean IRDI revision-0 source ROM is accepted. Italian saves use the `White2Italy-Following-*.sav` family; no US save is copied into it. If no Italian save is present, create one normally in the emulator.", "",
             "## Rebuild and verify", "",
             "Set `ITALIAN_W2_ROM` to the exact clean IRDI ROM and `ITALIAN_HGSS_ROM` to the Italian HeartGold ROM before running these commands from the Pokeweb repository root.",
             "", "```sh", "python3 runtime/following-pokemon/italy_port.py ../cleanwhite2.nds \"$ITALIAN_W2_ROM\"",
             "python3 runtime/following-pokemon/generate_italian_pmc_contract.py ../cleanwhite2.nds \"$ITALIAN_W2_ROM\"",
             "npx vite-node scripts/build-italian-pmc.ts",
             "python3 runtime/following-pokemon/import_interactions.py \"$ITALIAN_HGSS_ROM\" --language it",
             "python3 runtime/following-pokemon/build_italy_language.py --language it --rom \"$ITALIAN_W2_ROM\"",
             "python3 runtime/following-pokemon/verify_italian_binary.py ../cleanwhite2.nds \"$ITALIAN_W2_ROM\"",
             "FOLLOWING_PROFILE=white2italy python3 runtime/following-pokemon/build.py \"$ITALIAN_W2_ROM\" --publish",
             "npx vite-node scripts/verify-following-italy-install.ts \"$ITALIAN_W2_ROM\" runtime/following-pokemon/build/white2italy/White2Italy-Following-0.6.33-alpha.nds",
             "npx vite-node scripts/verify-following-italy-upgrade.ts runtime/following-pokemon/build/white2italy/White2Italy-Following-0.6.32-alpha.nds runtime/following-pokemon/build/white2italy/italy-upgrade-check.nds",
             "npx vite-node scripts/verify-following-italy-assets.ts \"$ITALIAN_W2_ROM\"",
             "npx vite-node scripts/verify-following-grounding.ts ../../White2Italy-Following-0.6.33-alpha.nds",
             "python3 runtime/following-pokemon/audit_italy_memory.py ../../White2Italy-Following-0.6.33-alpha.nds",
             "```", "",
             "The prior alpha ROM in the build directory is retained for upgrade verification. Older release ROMs may be unavailable locally; the commands above build the current 0.6.33 package without overwriting saves.", "",
             "## Verification limits", "",
             f"Static audit: {audit['sites']} follower sites, {audit['scriptTableEntries']} script-table entries, {audit['safeCommands']} allowed commands, {audit['pmcHooks']} PMC hooks and {audit['pmcImports']} PMC imports checked.",
             "Packaged ARM946 instruction and relocation tests passed; clean install, reinstall, export/reopen, disable, removal and English-to-Italian update passed without launching an emulator. Italian retail message/script archives and stock object-code rows were preserved in the exported ROM.",
             "Packaged field tests include 100 simulated follower conversations and 100 retained-actor scene cycles. A replacement artwork test passed through export/reopen without recompiling a DLL. The descriptor audit checks grounded/Flying offsets and unchanged retail rows; visual alignment remains for melonDS acceptance.",
             "A later Pokeweb install report exposed a W2I/W2 DLL identity error after project persistence. Pokeweb now uses the loaded IRDI code when in-memory ROM bytes are absent and passes the retrieved source ROM to module staging. A focused identity test and clean-ROM installation/export round trip with a browser-storage stand-in pass; live browser confirmation remains pending.",
             "Game-emulator and DS hardware behavior are unverified. Use the separate human checklist for acceptance; a clean boot is required because a saved emulator state contains old runtime code.", ""]
    (HERE / "ITALY.md").write_text("\n".join(lines))
    checklist = ["# Italian White 2 follower — human melonDS checklist", "",
                 "Cold boot a versioned IRDI ROM from an ordinary Italian save. Do not load a savestate created by a US ROM or an older alpha. Record emulator version, ROM SHA-256, save origin, map/coordinates and screenshots for failures. All cases below are **NOT RUN** until you test them.", "",
                 "| ID | Action | Expected result | Result |", "|---|---|---|---|"]
    checklist.extend(f"| {ident} | {action} | {expected} | NOT RUN |" for ident, action, expected in CASES)
    checklist += ["", "For any recall in I12–I14, capture `FollowingSceneDebug` reason/opcode/action and the field generation if possible. At I23, note actor count, heap use and texture/palette allocations when telemetry is available; mark them UNMEASURED otherwise.", ""]
    (HERE / "ITALY-CHECKLIST.md").write_text("\n".join(checklist))
    validation = ["# Italian White 2 follower validation", "",
                  "Automated work executed for 0.6.33-alpha:", "",
                  f"- Exact IRDI SHA-256 and {audit['sites']} mapped hook/adapter signatures passed; {audit['translatedPointers']} translated pointers and {audit['translatedThumbCalls']} translated Thumb calls accounted for.",
                  f"- All {audit['scriptTableEntries']} script-table entries, {audit['safeCommands']} safe commands and {audit['safeFinishers']} finishers matched the target binary.",
                  f"- {audit['pmcHooks']} PMC hook sites and {audit['pmcImports']} imported entries matched. Exported PMC boot calls the Italian native initializer and overlay loader.",
                  "- W2I DLLs passed packaged ARMv5T call, relocation, stack, and movement-trail checks at three load addresses.",
                  "- Packaged-runtime tests passed 100 simulated follower conversations, 100 conversation returns and 100 retained-actor scene cycles, including event-command policy checks and an Italian full-Bag response/rollback path.",
                  "- Pokeweb clean install, idempotent install, export/reopen, disable/enable and removal passed. The 0.6.27-to-0.6.28 update preserved authored dialogue and gift rules.",
                  "- A reported Pokeweb W2I/W2 installation error was traced to ROM bytes moving into browser storage. The DLL identity check now uses the loaded IRDI code when project bytes are absent; follower module staging receives the retrieved source ROM. A focused identity test and clean-ROM install/reinstall/export/reopen/disable/remove round trip with a browser-storage stand-in passed. Live browser recheck remains pending.",
                  "- Replacing one appearance asset passed export/reopen without rebuilding the DLLs.",
                  "- Grounding audit checked all 2,574 Italian appearances: 2,266 non-Flying and 308 Flying. Every appended descriptor Y is zero, and original stock descriptor rows and native shadow flags remain unchanged.",
                  "- Packaged draw-pass tests checked sprite-only vertical translation, immediate billboard restoration, and an unchanged native effects pass, including repeated flat and stair draws. GPU submission was simulated; no emulator visual test was run.",
                  "- Packaged control-offset checks verified north/south adjustments affect only the follower's native control-Z byte, leaving world/grid/collision coordinates unchanged. The north two-pixel artwork correction is draw-only; visual pixel alignment requires emulator review.",
                  "- A north-facing draw regression compares the corrected submission with the pre-anchor foreground depth while preserving its new projected position and the native shadow/effect pose. Stair, lateral and unrelated actor depth policies are unchanged; emulator visual acceptance remains pending.",
                  "- Italian HeartGold reaction/motion/emote archives matched pinned layouts. All 27 selected messages imported without truncation; accented è and substitutions were validated. The Bag-full response matches Italian White 2 retail text.",
                  "- Italian retail text/script archives, personal data, appearance data and original object-code rows were byte-preserved by export.", "",
                  "The user confirmed the tested sprite/shadow positioning, then reported that the player covered Serperior while walking north. Visual acceptance of the 0.6.33 depth correction is **pending**. DS-family hardware results: **not tested**. Automated checks cannot establish in-game field timing, native heap behavior or visual correctness.", ""]
    (HERE / "ITALY-VALIDATION.md").write_text("\n".join(validation))
    print("Generated Italian release notes, validation record and 29 human emulator cases; no emulator test was run.")


if __name__ == "__main__":
    generate()

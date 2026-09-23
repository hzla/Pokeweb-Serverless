"""Generate the stock Black 2 follower emulator acceptance checklist."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
VERSION = "0.6.32-alpha"

CASES = [
    ("B01", "Cold boot an ordinary Black 2 save, walk one tile, then walk and run in all four directions.", "Exactly one party Pokémon appears and follows the recorded route without blocking movement."),
    ("B02", "Enter and leave a house or Pokémon Center twice, then use a door, stairs, and an elevator.", "Required transitions recall once and the follower returns once after walking; controls remain responsive."),
    ("B03", "Open and close the X menu, then use the Pokémon Center PC without changing the party.", "The follower remains visible and paused, then resumes without a recall or send-out effect."),
    ("B04", "Reorder the party and deposit or withdraw the selected Pokémon, then return from the PC and walk.", "An unchanged identity is retained; a changed identity is selected safely with one follower."),
    ("B05", "Cross the Floccesy Town / Route 20 seamless boundary in both directions while walking and running.", "The same visible follower crosses without recall, send-out, duplicate actor, or stale trail."),
    ("B06", "Talk to a follower from all four directions, then talk to a wandering NPC, read a sign, and inspect furniture.", "Follower reactions work; safe external interactions keep the follower visible and paused."),
    ("B07", "Trigger a trainer battle and a wild battle, heal, fish, cycle, Surf, and return to normal walking.", "Activity guards recall before ownership changes and restore one current follower afterward."),
    ("B08", "Use small, 64-pixel, shiny, gender-different, and alternate-form Gen 5 leads.", "Correct art, palette, facing, spacing, draw order, cry, and identity are used without palette bleed."),
    ("B09", "Walk sideways near buildings and traverse straight and diagonal stairs with a large follower.", "No alternating player/follower priority, railing head clipping, stair sinking, or building clipping."),
    ("B10", "Talk in a matching contextual-dialogue zone and claim a configured gift; repeat after saving and reloading.", "Dialogue selectors match the live zone. Each gift slot is claimable once per Pokémon and persists."),
    ("B11", "Run a story scene with forced movement and another scene where the player remains stationary.", "Forced movement recalls before it starts. Verified stationary presentation retains the paused follower."),
    ("B12", "Complete 100 mixed menu, dialogue, battle, door, seamless-map, PC, and save/reload cycles.", "No freeze, duplicate actor, stuck input, lingering effect, missing NPC, or accumulating allocation is observed."),
    ("B13", "Walk very slowly through stairs and curved paths with the widest follower, then reverse, stop, and cross a seamless map boundary.", "The 64-record trail follows continuously without an unexpected recall or shortcut. Record any recall and the exact path."),
    ("B14", "On ordinary ground, walk until the follower emerges and check its feet while stationary and moving. Repeat on stairs, grass, and during recall/return with a small and a 64-pixel follower.", "One native ground shadow follows the Pokémon's feet, uses terrain height, disappears with the follower, and does not duplicate after transitions or alter the player's shadow."),
    ("B15", "Compare grounded Bulbasaur or Mewtwo with Flying-type Pidgeot or Charizard on flat ground and stairs, both idle and walking.", "Grounded artwork sits at its existing shadow; Flying-type artwork keeps its prior height. Shadow position, player depth and stair draw order stay stable."),
    ("B16", "For diagnosis only, compare the same grounded follower at the same position in 0.6.28 and 0.6.29.", "The extra three pixels in 0.6.29 also move the native shadow. This is the known regression corrected by 0.6.30."),
    ("B17", "Cold boot 0.6.30 with a small grounded follower and Serperior; compare their shadows with the player on flat ground and stairs.", "The lowered sprite position is retained. Both follower shadows are complete and aligned to the player ground plane, with no cut-off lower half."),
    ("B18", "Cold boot 0.6.31 with Serperior. Face up and down on flat ground, then walk in both directions on stairs; check the full shadow as well as the sprite.", "Upward facing moves the shadow about seven pixels and art about five pixels upward; downward facing moves both about six pixels downward. Left/right and collision positions remain stable."),
    ("B19", "Cold boot 0.6.32 with Serperior and walk north through a player overlap; then check north-facing stairs and lateral movement beside a building.", "The follower has the foreground draw priority during the overlap without changing its artwork/shadow location or reintroducing stair/building clipping."),
]

def generate():
    lines = [
        f"# Stock Black 2 Following Pokémon {VERSION} — emulator checklist",
        "",
        f"Use `Black2-Following-{VERSION}.nds` with a same-basename `.sav`. Cold boot the ROM; do not resume a state made with another ROM. Emulator execution is assigned to the human tester and every row remains **NOT RUN** until results are recorded.",
        "",
        "Start with B01–B06 and B13. If those pass, continue through B12. For a failure, save a state immediately before the trigger and record emulator/version, location, party lead, direction, and the ROM SHA-256.",
        "",
        "| ID | Steps | Expected | Result / evidence |",
        "|---|---|---|---|",
    ]
    lines += [f"| {identifier} | {steps} | {expected} | NOT RUN |" for identifier, steps, expected in CASES]
    lines += [
        "",
        "Black 2 uses its own three PMC modules and binary contract. White 2 or expansion savestates do not validate this port because they retain different loaded code and addresses.",
        "",
    ]
    (HERE / "BLACK2-CHECKLIST.md").write_text("\n".join(lines))

if __name__ == "__main__":
    generate()

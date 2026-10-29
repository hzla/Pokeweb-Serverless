# White 2 debug helpers

Independent PMC modules for checked US White 2 revision 0, available under
**Code Injection → Debug Helpers**. Native signatures and overlapping hooks are
checked; PMC is installed automatically.

| Shortcut | Action |
| --- | --- |
| L + R + Start | Toggle player grid-collision bypass; off at boot, never saved. |
| A + B + Start | End an eligible local battle with a native victory result. |

Release a button before repeating a chord. Return to a walkable tile before
disabling collision bypass. It does not create geometry, remove NPC collision
globally or replace scripted/rail movement. Unusual maps and water/height
transitions require gameplay checks.

Victory waits for the native input-close handshake and preserves result/party
synchronization and teardown. It skips remaining knockout EXP and does not
simulate each defeated opponent. Communication, facility, demo, replay and
already-decided battles are excluded.

Run `python3 runtime/debug-helpers/build.py` and
`python3 runtime/debug-helpers/verify.py /path/cleanwhite2.nds` from the repository
root. Broad map/battle-format coverage and hardware timing remain unverified.

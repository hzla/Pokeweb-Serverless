# Stationary follower animation

Stock 0.6.17-alpha and White2Upgrade 0.7.8-alpha let a visible follower use
the native directional billboard loop while it is stationary. The loop follows
the follower's last movement direction and uses the appearance's existing
animation frames; no new sprite, descriptor, registry record, actor field or
heap buffer is added.

The field callback clears the native animation-pause flag only when the actor
is visible and the follower is in ordinary `Following` state. It sets the flag
while the follower is waiting, hidden, interacting, retained by an external
event, suppressed, being destroyed, or while a private send-out/recall effect
is active. This retains the current frame during conversations, X menu and PC
presentation, safe dialogue/scene pauses, and ball effects. After normal field
control returns, the existing actor resumes its directional loop without
reseeding the trail or changing its position, depth policy, spacing or collision
state.

The build verifies every state/visibility/effect combination in the final ARM
module at three load addresses. The interaction and retained-scene CPU fixtures
also verify 100 returns to ordinary following with the loop enabled, while
conversation and menu pause paths retain the pause flag. These are native-service
fixtures, not game-emulator tests. Human acceptance is I01–I05 in
[EMULATOR-CHECKLIST.md](EMULATOR-CHECKLIST.md) and U17 in
[WHITE2UPGRADE-CHECKLIST.md](WHITE2UPGRADE-CHECKLIST.md).

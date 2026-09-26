# Following Pokémon ball effects

The imported compiled HeartGold IPKE resources in `a/1/0/3` supply the ball,
send-out flash, and texture animation. `import_effects.py` packages members 129,
104, and 164 into `src/assets/following/hgss-effects.narc` and records their
hashes in `src/assets/following/effects.json`. The runtime validates the archive
before loading it. These assets are shared across profiles.

Send-out shows the ball for two field updates, followed by eight flash
updates as the follower appears. Recall now takes twelve updates on all four profiles.
A private copy of the follower texture is mapped to the flash's light
cyan and white, then the detached billboard holds for three updates, shrinks
over five, and ends with four updates of the existing ball model. The normal
follower palette and other actors are untouched. If no billboard snapshot can
be taken, the ball stays visible through recall instead of leaving a blank gap.

The stock US White 2 battle-effect archive's switch-out return script (effect
620, member 59) and send-out script (effect 621, member 60) both play SE 1383.
Effect 619/member 58 is Sunny Day and plays SE 1565; the prior 0.6.71 recall
used that twinkling cue by mistake. The field effect now plays SE 1383 once
when recall starts and once when the ball opens at send-out update 2. Failed
effect setup plays neither cue. The packaged CPU check pins all three battle
script members and verifies the field calls; audible timing still requires a
cold boot.

The private recall texture uses the installed registry's validated resource
count, so imported follower sprites beyond the retail archive's 975 members
can use the same effect. The 0.6.68 build incorrectly used that retail limit.
The 0.6.69 build loaded the private texture but cleared the cloned billboard's
draw-enable and map-light bits. The current clone retains those bits and uses
the last submitted ground/depth-corrected pose before shrinking in place.

The profile-pinned field-player direction hook returns the native no-direction value
while recall is active. The resident event bridge also defers an unsafe native
field callback until the effect completes, so a door or script cannot advance
through the callback and unload the field early. Other game systems continue to
update and render. If effects are unavailable, no recall wait is imposed. Field
unload releases owned render objects and cancels any remaining effect.

Packaged ARM946 checks cover each profile's movement hook, callback wait,
effect frames, fallback, palette isolation, resource ownership and teardown.
These checks do not establish live-game visual timing or alignment. Cold-boot
cases are in [the emulator checklist](EMULATOR-CHECKLIST.md); no emulator was
run for the current profile builds.

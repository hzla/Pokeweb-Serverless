# Seamless land mount and Surf transitions — stock White 2

Status: implemented in stock White 2 0.6.53-alpha; the automatic-lead slot
handoff was corrected in 0.6.55-alpha after the user found a blocked-water
bump in 0.6.53 and 0.6.54. Version 0.6.56 turns the player actor to the
newly pressed water direction before the native task creates its effect,
and derives the no-hop tile transfer from that saved direction. The native
task otherwise reads the prior facing, which can draw the mount to one side
or stop the player short of water. Failed task/event creation restores the
old facing. Exact hook and adapter bytes match the pinned
revision-0 ROM. Packaged ARM946 checks pass; human visual acceptance is
pending. Black 2, Italian
White 2 and White2Upgrade are unchanged.

The land mount keeps the player in normal land mode. On an attempted water
step, the field-event hook requires the mounted Pokémon's party identity,
Surf (move 57), HM03 (item 422), supported custom art, water terrain, and
native Surf frontage, height, zone and scene permission. The native Surf task
still creates the effect and ripple and changes to Surf mode. Its jump call is
replaced with one or two short grounded tile movements. The mount token pins
the same Pokémon rather than selecting another party Surf user. The resolved
party slot is read from the active mount after its identity check; the
automatic follower selection can carry `-1` even when that mount is party
slot 0.

The native collision decision creates the shore-exit event. Its jump call is
replaced with short movements. After the native event returns to land mode,
the original Pokémon is revalidated and mounted again; a changed identity or
missing land art leaves the player on foot. The transient identity token can
survive safe outdoor seams and is discarded on field unload. Land rider
textures are released before Surf textures load, and the reverse happens on
shore. No second permanent archive buffer is allocated.

The audited stock Surf-hop sound is `PMSND_PlaySE(1374)`. It plays once on a
successful manual A+B mount. Automatic water entry also requests it once
because the substituted movement has no jump sound. Failed mounts and manual
dismounts make no sound.

The packaged test covers all sixteen combinations of old and pressed facing,
HM03, Surf, water terrain,
frontage/height rejection, task and event handoff, two-step shore movement,
remount identity and once-only sound. Repeated crossings, draw order, rider
placement, ripple, map seams, interruption and resource lifetime remain
human cold-boot checks.

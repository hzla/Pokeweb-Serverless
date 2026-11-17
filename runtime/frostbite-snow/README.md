# Frostbite, Snow and Modern Status Effects

Install a patch under **Code Injection → Major Features/Expansions** on a
compatible US revision-0 Black, White, Black 2, or White 2 ROM. Each installer
stages one PMC module and its text or animation edits together. Export the ROM
to keep the changes.

Frostbite uses the existing Freeze status ID, including in saves and recipe
conditions. It halves special move damage and causes one sixteenth of maximum
HP in end-of-turn damage (minimum 1 HP). The holder can act and retains the
status until cured. Native immunity and cures still apply. Frostbite uses the
frozen effect animation as a placeholder, changes the stock status badge to
FBT, and lets the Pokémon's sprite keep animating. For ROMs with the original
Frostbite patch, choose **Update Frostbite** and export the ROM again.

Snow uses the existing Hail weather ID. Ice types get 1.5× Defense in effective
Snow. The native weather event still runs for Ice Body and other weather effects,
with no weather chip. Move 258 becomes Snowscape and uses the bundled animation by
Log(n). Its move data and references retain the same slot. Snow's defense check
uses the existing effective weather query.

Modern Status Effects uses Pokémon Champions rules for burn, paralysis, sleep,
freeze and confusion. Burn deals 1/16 max HP and Facade ignores its physical
damage penalty. Paralysis halves Speed, stops one in eight move attempts,
and cannot be inflicted on Electric types. Default sleep wakes on the second
attempt one third of the time and always on the third. Freeze has a 25% chance
to thaw before each of the first two attempts and always thaws on the third.
Scald can thaw a target it damages directly. Confusion has a 33% self-hit
chance. Sleep and freeze progress are kept when switching. Rest, explicit
custom sleep durations, poison, and each move's configured infliction chance
use their existing rules.

With both status patches installed, Frostbite supplies the status in Freeze's
slot. Either install order supports the same combined rules. When updating
an older Frostbite ROM, the installer retains the battle text and sprite assets.

Build the bundled templates with `python3 runtime/frostbite-snow/build.py`. The
build checks native instruction sites in the four clean US ROMs and requires
the ARM toolchain and RPMTool used by the other PMC patches.

# Hard Level Caps for stock US BW2

This PMC DLL adapts the Hard Level Caps feature from PW2Code by **Dararo** for
retail US Black 2 and White 2. Build with `npm run levelcaps:build` and
exercise the compiled hooks with `npm run levelcaps:verify` (requires Unicorn).

Set game work variable **16415** in a script, for example
`EventWorks.Set(16415, 30)`. A value of 0 (the untouched save default), or a
value outside 1–100, uses level 100. Changing the variable later changes the
cap immediately. The installer only adds the code; it does not edit saves or
scripts.

The five hooks clamp battle EXP after normal bonuses, cap Day Care experience
and level previews, and disable Infinite Candy (item 622) at the cap. Regular
Rare Candy (item 50) remains usable through level 100, matching PW2Code's
default setting. Battle EV calculations and other item eligibility paths stay
in the retail code. The installer checks the stock US hook bytes and rejects
overlapping PMC modules. Upgrade ROMs have different battle code and are not
supported by this build.

The cap reader follows the global game-beacon pointer, then reads the game-data
pointer at offset 4 within that beacon. Reading offset 4 at the global symbol
itself yields unrelated data and crashes when an item checks the cap. The
compiled-hook verifier models both pointer reads.

Party Pokémon parameters use field `0x05` for species, `0x6F` for form, and
`0x9E` for level. The item and Day Care guards read `0x9E` when comparing with
the cap; the verifier includes a level-11 Pidove (species 519) at cap 20.

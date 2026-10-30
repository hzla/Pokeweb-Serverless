# Hard Level Caps

Adapts **PW2Code by Dararo** for checked stock US Black 2/White 2 layouts.
Set work variable 16415 in a script, for example `EventWorks.Set(16415, 30)`.
Values 1–100 set the cap; zero or out-of-range values use 100. Changes apply
immediately. Installation adds code without editing saves or scripts.

Hooks clamp battle EXP and Day Care EXP/level previews and disable the selected
Infinite Candy item at the cap. Ordinary Rare Candy remains usable to level 100.
Pokeweb reads the installed Candy ID and configures the cap DLL to match. If
Candy is installed after Hard Level Caps, the existing cap DLL is updated as
needed. The older fixed-item-622 DLL is recognized and can be updated in place.
EVs and other item eligibility remain native. Upgrade battle layouts and
overlapping hooks are unsupported.

Build with `npm run levelcaps:build`; compiled verification uses
`npm run levelcaps:verify` and Unicorn. Party field `0x9E` is the level field;
`0x05` is species and must not be used for cap comparisons.

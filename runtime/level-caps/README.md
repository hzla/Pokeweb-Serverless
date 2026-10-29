# Hard Level Caps

Adapts **PW2Code by Dararo** for checked stock US Black 2/White 2 layouts.
Set work variable 16415 in a script, for example `EventWorks.Set(16415, 30)`.
Values 1–100 set the cap; zero or out-of-range values use 100. Changes apply
immediately. Installation adds code without editing saves or scripts.

Hooks clamp battle EXP and Day Care EXP/level previews and disable Infinite Candy
(item 622) at the cap. Ordinary Rare Candy remains usable to level 100. EVs and
other item eligibility remain native. Upgrade battle layouts and a different
Infinite Candy ID are unsupported; overlapping hooks are rejected.

Build with `npm run levelcaps:build`; compiled verification uses
`npm run levelcaps:verify` and Unicorn. Party field `0x9E` is the level field;
`0x05` is species and must not be used for cap comparisons.

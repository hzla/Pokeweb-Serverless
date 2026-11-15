# Challenge Mode Stat Fix

Open **Code Injection → Quality of Life → Challenge Mode Stat Fix**, select **Apply Stat Fix**, and export the ROM. The patch supports US Black 2 and White 2 revision 0. It can be applied to an edited ROM when the relevant ARM9 routines still match and no loaded module patches them.

Easy and Challenge Mode calculate opposing Pokémon's stats at their adjusted levels. The patch follows the game's existing difficulty selection, level modifiers, and party selection. Normal Mode follows the retail path. The Key System still controls difficulty availability.

`src/pokeweb/challengeModeStatsModel.ts` stages a 24-byte edit in the decompressed ARM9. After setting the adjusted level, it calls the native stat calculation that uses the stored level. The patch has no PMC dependency.

DaSquyd documented the bug and a native fix. [Original research](https://www.reddit.com/r/PokemonROMhacks/comments/1envfvj/fix_blackwhite_2_challengeeasy_mode_level_bug/)

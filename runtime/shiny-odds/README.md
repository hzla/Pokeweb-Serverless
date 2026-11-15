# Shiny Odds

Open **Code Injection → Quality of Life → Shiny Odds**, choose 1–1,024 PID rolls, and export the ROM. Setting 1 restores retail odds. The installer supports US Black, White, Black 2 and White 2 revision 0 with matching encounter code. It installs PMC if needed.

The generated module replaces one call in the wild Pokémon initializer in overlay 21 (BW) or 36 (BW2). For ordinary wild PID generation, it calls the original encounter-specific generator up to the configured number of times and stops on the first PID that passes the retail shiny check. The displayed base chance is approximately `1 - (8191/8192)^rolls`. Each Shiny Charm or Pass Power attempt in BW2 also uses the configured number of rolls, and explicit wild encounter shiny policies use the native behavior. The global shiny check is unchanged. Eggs, gifts, NPC trades, and other acquisition paths that bypass the hooked call are outside the patch's scope.

`src/pokeweb/shinyOddsModel.ts` generates the Thumb code and its call-site relocation when the patch is applied. It verifies the field initializer, PID generator, and stock shiny predicate against the supported ROM and checks installed modules for overlapping relocations.

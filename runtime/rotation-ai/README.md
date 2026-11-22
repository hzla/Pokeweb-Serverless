# Rotation Battle AI

Install **Rotation Battle AI** under **Code Injection → Infrastructure**, then export the ROM. Supports US revision-0 Black, White, Black 2, and White 2. Pokeweb installs PMC if needed and checks for conflicting battle AI hooks.

On a trainer’s attack turn, the AI scores the legal moves from its front and both side Pokémon against the player's current front Pokémon. The normal checks for forced actions, trainer items, and party switches still run first.

- Basic and Expert use their regular scripts when enabled on the trainer. Expert can still vary scores at random.
- Strong adds four points for an estimated KO at the minimum damage roll. Type effectiveness contributes through the damage estimate.
- Highest score wins, then highest estimated damage. Exact ties favor staying in, then the earlier party slot and move slot.
- If a side Pokémon wins, the game queues its rotation and attack together. The attack resolves against whichever Pokémon is in front at execution time.

Damage estimates use the game’s battle engine with the candidate’s registered ability and held-item handlers active for the calculation. Effects that depend on the actual rotation or later actions can change the result.

Build with `python3 runtime/rotation-ai/build.py --black BLACK.nds --white WHITE.nds --black2 BLACK2.nds --white2 WHITE2.nds --rpm-tool CTRMap.jar`. The build needs Python with `ndspy`, Java, and ARM GNU tools on PATH or supplied with `--toolchain-bin`.

# Trainer Customization

With the Trainer Customization Patch installed, you are able to add more variation and customization to your trainer battles.

## Battle Start Settings

First you can set a pokemon's starting status, hp, nature, and shininess.

## Move Pools

You also have the option to give a pokemon a pool of moves to choose from for each slot. For example you can have their move 1 be a 50% choice between Reflect and Lightscreen, or have their second move be 80% Close Combat and 20% Mach Punch. The chance for a move to be chosen within a pool can be adjusted by setting a `Weight` value.

## Alternate Parties

You are also now able to have a set a trainer to have a random chance to choose between different parties. This is done with the **+ Party** button. Like with move pools, you are able to set a percentage chance for a party to be chosen.

## Rules

If you don't want a party to be chosen randomly, you can add more control or predictability over how a roster is chosen by adding a `Rule`.

- For example, you can have roster be determined by if the player has a specific pokemon in their party.
- You can do a check for the number of a specific type of pokemon in the player's party for a trainer that dynamically adjusts their party to counter the player's party choices.
- You can have a roster be chosen based on the player's highest leveled pokemon if you want a trainer to have a party scaled to the point of the player's in game progression.
- Or you can have a roster be determined by a player's starter choice.

> There are already ways to accomplish some of the above just using in game scripting but this patch enables you to implement this behavior more easily.

## Pokémon Pools

In addition to variable rosters, you are also have pokemon pools within a party. There are 2 variations of the pool system.

### Lead / Ace

The first a port of pokeemerald-expansion's trainer party pool's feature. Basically you can define a pool of pokemon, tag up to 2 of them as a **Lead** to come out first and up to 2 as **Ace** to come out last. Every other untagged pokemon will then be selected to fill out the middle of the party.

For example, say you have a pool of 6 pokemon, you tag 2 as Lead and 2 as Ace. If the trainer is set to a party of 3, it will choose between Charmander and Tepig for the lead, choose between Squirtle or Oshawott as the second pokemon, and between Ivysaur and Snivy for the last pokemon.

> **Tip:** Once a pool is set up, you can set the `Weight` of the original roster to 0 to have the game always choose to use your configured pool.

### Per Slot

The second variation is a per-slot draw mode. Basically, the same as the above where pools are added to move slots, except here you can choose to add a pool of pokemon for each party slot. First you choose your party size and choose a "Pool" for each slot. Then from your roster of pokemon, you can then assign any number of "Pool" tags to a pokemon. When the trainer is fought, the game will then build a team using the pokemon in the group assigned to each slot. So here:

| Slot | Pool | Candidates |
| --- | --- | --- |
| Slot 1 | Group A | 50/50 Charmander, Tepig |
| Slot 2 | Group B | 50/50 Oshawott, Squirtle |
| Slot 3 | Group C | 50/50 Ivysaur, Snivy |

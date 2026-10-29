# Following Pokémon runtime

The Following Pokémon page supports separate stock US White 2, stock US Black 2,
Italian White 2 and White2Upgrade profiles. Each has a pinned binary contract,
package and save family. Stock species are 1–649; the expansion profile supports
through 1023. Use the manifests in `src/assets/following/` for current versions.
Saves and emulator states are not interchangeable between profiles.

New installs use the base package: grounded following, L/R party selection,
dialogue, gifts, ball effects and scene guards. The optional full package adds
A+B land riding and custom Surf. This choice is locked until removal/reinstall.
Base retains retail Surf and contains no mount assets. Cycling does not reorder
the party. Full Surf prefers the selected eligible follower, then the first
non-Egg Surf user; the land selection returns afterward.

The in-game Options row toggles followers through reserved Options bit 11;
existing saves default on. Pokeweb's ROM-wide enable setting is independent.
Followers are temporary field actors and are never saved. Safe menus/dialogue
retain them; unsafe scenes, doors, battles and genuine actor conflicts recall
them. In eligible local singles, a healthy grounded follower matching party slot
1 can remain out for the native battle opening. Other formats use normal recall.

Artwork uses two columns (idle/step) and four direction rows: 64×128 sheets for
32-pixel poses or 128×256 for 64-pixel poses, transparency and at most 15 opaque
BGR555 colors per pose. Species/form/gender/shiny mapping is explicit. Walking
gaps, rider anchors, conditional dialogue and gifts are authored in the asset
workspace and exported under `following/`. Repair affected artwork through the
editor before exporting. Dialogue/gift coordinate bounds are capability-gated;
they use signed matrix-tile coordinates, inclusive edges and optional zone IDs.

The core handles native event forwarding; field/event, Options and battle-intro
modules follow their overlay lifetimes. Bounded trails, caches and archive readers
reject malformed resources. Scene admission is governed by `event-policy.json`;
retain movement, ownership, collision and native cleanup guards when changing it.
Other languages/revisions need independent contracts. Alpha status and compiled
checks do not establish complete story, visual, DSi or hardware coverage.

Build/check from the repository root:

```sh
npm run following:build -- /path/cleanwhite2.nds --publish
npm run following:build-black2 -- /path/cleanblack2.nds --publish
npm run following:build-upgrade -- /path/compatible-upgrade.nds --publish
npm run following:build-italy -- /path/italian-white2.nds --publish
npm run following:verify-core
npm run following:test
```

Italian builds require their own language/PMC inputs; use `ITALIAN_W2_ROM` and
`ITALIAN_HGSS_ROM` for the port/import tools. Native builds require ARM GNU tools,
Java/RPMTool and Python dependencies. Asset imports do not require recompiling
the runtime. Always cold boot a new export with its matching ordinary save;
states contain old loaded code. Keep existing saves intact.

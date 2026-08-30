# Move metadata source enrichment

Use the enrichment command when a ROM update changes move crit rates, recoil,
damage drain, or direct healing and the existing Dynamic Calc and DDex sources
need to be refreshed.

```sh
npm run moves:enrich-sources -- \
  --rom /absolute/path/to/hack.nds \
  --source /absolute/path/to/dynamic-calc/backups/hack.js \
  --source /absolute/path/to/ddex/data/overrides/hack.js
```

The command reads the ROM's move NARC, writes reduced Showdown fractions such
as `[1, 4]`, and updates only `critRatio`, `willCrit`, `recoil`, `drain`, and
`heal`. A missing ROM value does not remove a source's existing value, so older
ROMs and sources retain their vanilla fallbacks.

Moves are matched by normalized name, then `move_replacements`, and finally by
the stable ROM slot (`num` in DDex or move order in Dynamic Calc). By default,
the command stops before writing if a metadata-bearing ROM move cannot be found
in every source. Use `--allow-missing` only when that omission is intentional.

Verify that committed sources match a ROM without writing them:

```sh
npm run moves:enrich-sources -- \
  --rom /absolute/path/to/hack.nds \
  --source /absolute/path/to/dynamic-calc/backups/hack.js \
  --source /absolute/path/to/ddex/data/overrides/hack.js \
  --check
```

Check mode exits nonzero when either source would change. Every run also prints
the ROM SHA-256, metadata-bearing move count, changed/current counts, and any
unmatched moves.

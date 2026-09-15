# Calculator item-name validation

Calc downloads and direct calc sync use the checked-in item-name catalog in
`src/assets/data/calc_item_names.json`. It is generated from every generation in
Dynamic Calc's `calc/data/items.js` `ITEMS` export, including custom hack items.
No neighboring repository is required at browser runtime or for a normal build.

An exact spelling wins. Otherwise, names are lowercased and punctuation/spacing
removed (`Tera K Rock` → `terakrock` → `Tera K-Rock`). Ambiguous normalized names
are not guessed. Unknown names are preserved and listed in the expandable item
validation report under Publish Calc after export or sync. This is a held-item
catalog, so non-held items such as trainer rewards may legitimately be unmatched.

Validation covers trainer held items, rewards, wild held items, and exported
replacement targets. Replacement-map values remain normalized IDs, as required
by the existing calc format. The validation report is local metadata, not part
of the exported dataset or bridge message. ROM names, DDex and text-doc exports
are unchanged. Existing generated datasets must be re-exported to benefit.

Refresh and verify the catalog after adding calculator items:

```sh
npm run calc:items:sync
npm run calc:items:check
```

By default these commands use the sibling
`calc-analytics/Dynamic-Calc-Hgengine/calc/data/items.js`. A different source can
be passed as an argument, e.g. `npm run calc:items:sync -- path/to/items.js`.
The snapshot records a relative source label and source SHA-256, never a local
absolute path. Refreshing is deterministic and includes the calculator's own
canonical capitalization and punctuation.

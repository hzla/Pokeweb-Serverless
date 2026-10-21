# C-Gear Shops — BW2 0.5.6

## Authoring

1. Open **Items → C-Gear Shops**. Add a shop, choose its name and currency, then add inventory rows and whole-number costs.
2. A shop has one currency: Poké Dollars, or a native stackable bag item. Key items and TMs/HMs are excluded as currencies. Stock may include TMs and ordinary items together.
3. Item search shows each TM/HM's currently assigned move, such as **TM01 — Hone Claws**. Search by machine number or move name.
4. Open **More → C-Gear Buttons**, add a button, and select **C-Gear Shops**. Its suggested label is **SHOP**. Existing appearance, position and read-only visibility controls apply; the eight-button limit is unchanged.
5. Apply shop changes and button changes. Drafts autosave; export carries both draft and last applied source. A draft does not replace runtime stock until Apply succeeds.

The game picker contains Pokémart, the custom shop names, and Cancel. Pokémart uses the current badge count and native stock/prices from the loaded ROM. Custom shops use their own prices without editing ordinary item data. Leaving a Buy list returns to the shop picker. Cancel from the picker returns to the overworld. The Party/Bag launch sound plays once when the owned request is accepted; shopping sounds remain native.

Limits: sixteen custom shops; 45 unique stock rows per shop; 24 English characters per name; costs 1–999 for item currencies or 1–9,999,999 Poké Dollars. The verified native bag table covers item IDs 1–638. Unsupported expanded item tables require an adapter audit.

For item currencies, the native balance panel displays the ROM's item name, its downscaled 16px icon at the left of the next row, and its quantity aligned right. Ordinary Pokémart/NPC balance panels keep their native rendering.

## Runtime ownership

`bw2/shop.inc` owns one parent field event. It checks heap headroom, loads the owned archive and starts native global script 10110. After verifying the private native script copy, it replaces that copy with a bounded compiled picker. The native VM owns the replacement code. Native list cleanup owns its buffer-backed text object; the parent retains the text bytes until child completion.

Each completed shop frees its per-shop message sources and resets price/payment state before recreating the picker’s native text object. A failed return-menu allocation exits the owned script cleanly. Version-1 archives from 0.5.5 recover and recompile to the looping picker without changing their draft/applied shop definitions.

The Buy command is native command `0x149`. This retail route uses native field windows and a completion callback; it is not a generic MapRequest application. Native code owns shop initialization, navigation, descriptions, quantity/confirmation messages and teardown. Adapters act only for the owned process/request. Native NPC shops fall through unchanged.

Native stock, prices and the shop text bank are redirected only for custom shops. Each TM row uses the game's move-name and owned-TM renderer. Selection chooses the native TM or ordinary-item confirmation path per item, allowing mixed stock. The currency icon borrows the native item animation and owns one extra actor, 512 character bytes and one palette. Its palette uses Main OBJ bank 2; native UI and selected-item palettes retain banks 0 and 1. Its queued image source stays allocated until native graphics teardown.

Native code pays before attempting to add the item and ignores that addition's result. Custom transactions defer payment until the matching item/quantity arrives, recheck balance and capacity, snapshot the entire bag, remove item currency and add the stock item. Failure restores the bag byte-for-byte. Poké Dollars are debited only after successful addition. Item-currency purchases leave money and the money-spent counter unchanged; the transaction count still advances. Native purchase bonuses remain on their original route.

## Source and ROM files

| File | Purpose |
|---|---|
| `src/systemShops/document.ts` | Editable definitions and TM example |
| `src/systemShops/compiler.ts` | Validation, picker/text compilation and integrity/recovery |
| `src/systemShops/graphics.ts` | Currency icon extraction/scaling |
| `src/pokeweb/systemShopsModel.ts` | Loaded-ROM assets, staging and source persistence |
| `src/ui/systemShopsEditor.ts` | Items navbar editor |
| `runtime/cgear-quick-actions/bw2/shop.inc` | Owned picker, native adapters, payment and icon lifecycle |
| `runtime/cgear-quick-actions/build.py` | Independent B2/W2 signatures and DLL generation |
| `scripts/generate-system-shop-bindings.ts` | Trusted picker sizes/hashes and harness fixtures |

The owned `system-shops/shops.narc` has a version-1 header and 424-byte shop records. Member 0 is compiled configuration; 1 is draft/applied JSON; 2 is the trusted picker; 3 is its native text bank. The next N members hold private shop messages, followed by N pairs of currency character/palette data. Record, script, menu, message and icon fingerprints protect the compiled data. Recovery also compares compiled names/stock with applied source.

Native resources remain in place: `a/2/8/2` stock, `a/2/8/3` counts, `a/0/2/4` item data, `a/0/2/5` item graphics, `a/0/0/2` item names, `a/0/0/3` shop text, and `a/0/5/6` scripts. Badge counts 0–8 select rows `0,1,1,2,2,3,3,4,5`. The installer verifies native interfaces/resources, recognizes 0.5.5, 0.5.4 and earlier supported DLLs, and stages the runtime/archive atomically. BW1 is unchanged and does not offer C-Gear Shops.

## Reproducible checks

From the Pokeweb-Serverless root, with the configured local retail fixtures/toolchain:

```sh
npm run cgear:build
npm run cgear:verify
npx vitest run src/test/systemShops.test.ts src/test/cgearButtons.test.ts src/test/cgearQuickActionsModel.test.ts src/test/cgearQuickActionsBw1.test.ts src/test/projectDocument.test.ts
npm run build
```

The ignored `build/` directory contains emulator traces/screenshots. `emulator.ts` supports `--action systemShop`, `--tm-shop`, `--scenario shopTMSave`, `--scenario shopTMReload`, `--scenario shopBadges`, `--shop-edits`, `--no-currency`, `--eight`, `--mixed-shop`, and both wireless power fixtures. `--append-shop` preserves all six preset buttons and adds SHOP at (128,96); `--write-rom` refuses to overwrite an existing output and copies only the isolated fixture save.

## Acceptance checklist

Automated CPU checks cover trusted pickers at 0/1/16 shops, parent/VM/text ownership, native touch priority/held suppression, flags, checked allocation failure and repeated cleanup, retail bag access, owned-TM/full-capacity rejection, insufficient currency, rollback after failed addition, mixed renderers and the extra icon's retained upload source/cleanup. Installer/compiler tests cover limits, currency validation, source integrity, old-version upgrade, draft/applied separation, rollback, disable/re-enable, autosave documents and export/reopen. Browser checks cover Items navigation, adding/applying the TM example, page reload recovery and editor contrast. Custom UI is absent from More and its route is blocked.

DS emulator checks include TM01 purchase for one Heart Scale, owned-TM rejection, cancelled TM02 with no charge, unchanged Poké Dollars, native saving/checksums, eight simultaneous buttons, insufficient item currency, and return with both C-Gear power states across B2/W2. All badge counts 0–8 passed in B2 with wireless off; all counts with authored stock/price edits passed in W2 with wireless on. Both games retained their purchased TM and 499 Heart Scales through normal saving and cold reload. A mixed TM/Poké Ball shop charged exactly 1 + 3 Heart Scales in W2. B2 repeated native purchases, a full stack, W2 insufficient money and B2 insufficient item currency passed without invalid deductions. A failed diagnostic run is not acceptance evidence.

Before a public release, retain separate human acceptance for:

- [ ] Full playthrough coexistence with companion patches and the intended hack's authored scripts/items.
- [ ] Every native quantity control, maximum-price/name combination, pocket capacity and Poké Ball bonus combination.
- [ ] Retail NPC Buy/Sell scripts during ordinary play, repeated long sessions and interrupted saving.
- [ ] Live DS/DSi hardware timing, flash storage behavior and resource exhaustion.

CPU tests and DS emulation do not establish hardware acceptance.

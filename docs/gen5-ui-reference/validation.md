# Gen 5 UI reference validation

Checked on 2026-09-18. This record covers the documentation and standalone browser
companion, not adoption of the styling in the live editor.

## Completed checks

- Reviewed the five supplied images against their source captions and the guide's
  observed/inferred/proposed distinctions. The summary collage is labelled as an
  adapted reference throughout. Individual White 2 captures remain enlarged/cropped
  references, not measured native assets.
- Opened the page through the local development server in the in-app browser.
  All five reference images and four sample sprites loaded successfully. No
  browser warning/error logs were reported during the interactive checks.
- Inspected desktop (1440 CSS pixels), tablet (768), and narrow mobile (360)
  layouts. Document scroll width equalled viewport width. A deliberately long
  record name wrapped without horizontal page overflow. Also checked a 720×500
  CSS viewport, equivalent to the reflow space of a 1440×1000 viewport at 200%.
- Checked combined name/type filtering, zero results, clearing filters, focus
  return from the disappearing empty-state action, and independent card expansion.
  Expanding Samurott left Serperior expanded.
- Checked a speed draft of 300: validation appeared and the displayed card value
  remained 113. Changing the draft to 114 updated the card and sample-change
  indicator. Confirming reset restored 113 and the unchanged state.
- Used Enter for expansion and dialog opening, Tab inside the dialog, Escape to
  cancel, and arrow-key selection in the radio group. Initial dialog focus went
  to “Keep editing”; closing returned focus to the opener. Cancelling preserved
  changes. The selected “All” type filter retained its selection while also
  showing the separate keyboard focus outline.
- Corrected the standalone invalid input from 300 to 113 and observed its valid
  state. Reviewed the reduced-motion CSS rule: it sets the transition duration
  token to zero. The reference has no automatic animation or audio.
- Calculated representative contrast ratios from the actual CSS colors:

  | Pair | Ratio |
  | --- | --- |
  | Primary text / record surface | 13.55:1 |
  | Muted text / raised surface | 6.26:1 |
  | Accent text / selected surface | 6.74:1 |
  | Error text / input surface | 10.04:1 |
  | Control boundary / raised surface | 3.98:1 |
  | Focus outline / raised surface | 10.80:1 |
  | Primary button text / accent fill | 10.22:1 |

- Checked local HTML/Markdown links, anchor targets, duplicate static IDs, and PNG
  chunk integrity. Audited the companion for remote resource references and app,
  storage, or ROM dependencies; its assets and script are local and self-contained.
- `node --check docs/gen5-ui-reference/reference.js` passed.
- `npm run privacy:check` passed for working files and staged changes.
- `npm run build` passed. Vite reported mixed static/dynamic imports and large
  bundles in the application. The documentation page is not a production entry
  point, so the build is an application regression check, not its publication.

## Limits and remaining manual checks

- Native browser zoom could not be controlled through the available browser
  interface. The 720px reflow check is **not** a claim of testing actual 200% zoom.
- Reduced motion was checked through the loaded stylesheet, not an emulated or
  changed operating-system preference. Forced colors and screen-reader speech
  were not exercised. Keyboard and semantic inspection is not a full accessibility
  audit, and the contrast table does not certify screenshot contents.
- The browser security policy blocked a direct `file://` navigation. Local asset
  resolution and the non-module script were inspected, but direct-from-disk launch
  remains a manual check. Local HTTP serving was verified.
- No stock-game font/palette extraction, BW1 comparison, ROM modification, native
  engine resource validation, or in-game/emulator verification was performed.
- No model/parser/export tests were added or run; no application code or project
  schema changed. Mock navigation outside Pokémon is intentionally unavailable.

For a final manual check, open `index.html` from this folder in a regular browser,
set page zoom to 200%, and enable the system's reduced-motion preference. Confirm
that fields remain usable, focus stays visible, and transitions are removed.

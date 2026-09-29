# Custom UI usability review

Reviewed on September 29, 2026 after the editor layout cleanup. This is a review of the browser editor, not emulator or native-runtime verification.

## Completed in this pass

- Centered the complete editor, including its header and toolbar.
- Grouped history, asset import, and ROM controls.
- Replaced the mode button with an accessible **Interactable** switch above the previews. Preview game controls appear when it is on.
- Removed bundle import/export buttons from the graphical page; the shared bundle API and CLI remain available.
- Moved **Configure Accessibility** into a persistent card beneath the properties inspector. Draft settings survive screen/component selection; saving is one undoable change.
- Added green plus icons to add/import/duplicate actions and red cross icons to deletion actions. Text labels remain visible.

## Recommended next improvements

These are recommendations, not additional implemented features.

| Priority | Observed friction | Suggested change |
| --- | --- | --- |
| 1 | **Add to top/bottom** selects an insertion target; it does not add anything until the separate component selector is used. | Open a component palette directly from each screen's plus button. Show Text, Image, Button, Panel, List, and Pokémon with small examples. |
| 1 | Disabled ROM buttons are separated from the explanation in the left sidebar. Saving a design, saving accessibility settings, applying changes, and exporting a ROM are distinct steps with limited status feedback. | Put **Preview only**, **Ready to apply**, or **Applied** beside the ROM controls, with the specific blocking reason. Add visible saved/unsaved indicators and an unapplied-changes count. |
| 2 | Components from both physical screens share a flat list. Finding one becomes harder as the design grows. | Group layers under **Top screen** and **Bottom screen**; add search, visibility/lock controls, and drag-to-reorder. Keep native locked regions visually distinct. |
| 2 | A selected button produces a long inspector containing geometry, colors, data, actions, states, and focus links. All enabled access methods also make a very long configuration card. | Group properties into **Layout**, **Appearance**, **Data**, and **Interaction**. Use expandable access sections with an enabled summary and keep their save state/actions easy to reach. |
| 2 | Both 2× screens extend below the viewport on common laptop sizes. Requested zoom is constrained by the available column width without explaining the effective scale. | Add **Fit both screens** and show the effective scale. Offer an optional side-by-side preview on wide displays while retaining clear top/bottom and touch labels. |
| 3 | Large technical paragraphs occupy the top of the left sidebar, pushing screen and layer tools downward. Raw binding names and sample JSON also require implementation knowledge. | Replace the repeated introductory text with concise status/help disclosures. Add a labeled binding picker with examples and a form-based sample-data editor. Keep the technical details available. |

## Browser checks

- At a 1920-pixel viewport, the 1142-pixel editor had equal 389-pixel outer margins; both previews were 512×384.
- At a 1000-pixel viewport, the editor stayed within the viewport and both previews retained their 4:3 proportions.
- The switch worked by pointer and keyboard, retained keyboard focus, and controlled preview navigation visibility.
- Accessibility remained beneath the inspector with no dialog. An unsaved command label survived changing the selected screen.
- Save, undo, redo, invalid single-button shortcut rejection, and reset were checked against the isolated browser test project.
- Bundle buttons and the duplicated Access buttons were absent.

No emulator testing was performed for this presentation change.

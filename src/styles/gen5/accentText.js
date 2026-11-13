/**
 * Gen 5 theme: Pokeweb's one accent (`--amber`) is both a fill and a text colour. The theme makes it the menus'
 * selection blue, which works as a fill but is too dark to read as text on the charcoal panels. This PostCSS pass
 * points text-like uses (text, links' underlines, the caret, focus outlines) at `--amber-text` instead, falling back
 * to `--amber` where the theme isn't loaded. Fills and borders keep the accent itself.
 */

const SKIP = /mastersheetViewer|[\\/]gen5[\\/]|gen5Theme/u;
const PROPERTIES = new Set(["color", "outline", "outline-color", "text-decoration-color", "caret-color"]);

export function gen5AccentText() {
  // PostCSS visits a declaration again after it changes; rewrite each one once.
  const done = new WeakSet();
  return {
    postcssPlugin: "gen5-accent-text",
    Declaration(decl) {
      if (done.has(decl) || !PROPERTIES.has(decl.prop)) return;
      if (SKIP.test(decl.source?.input.file ?? "")) return;
      done.add(decl);
      if (decl.value.includes("var(--amber)")) decl.value = decl.value.replaceAll("var(--amber)", "var(--amber-text, var(--amber))");
    },
  };
}
gen5AccentText.postcss = true;

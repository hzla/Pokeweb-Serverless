/**
 * Gen 5 theme (experimental branch): steps up the editor's type sizes. Every stylesheet sets its own pixel sizes, so
 * this PostCSS pass rewrites them as Vite loads the CSS: small text (11 px and under) gains 2 px, body sizes up to
 * 16 px gain 1 px, and headings stay as they are. The Mastersheet Viewer keeps its own scale.
 */

const SKIP = /mastersheetViewer/u;

/** 10 → 12, 11 → 13, 12 → 13, 13 → 14, … 16 → 17; 17 and up unchanged. */
export function gen5FontSize(px) {
  if (px <= 0) return px;
  if (px <= 11) return px + 2;
  if (px <= 16) return px + 1;
  return px;
}

const scalePx = (match, value) => `${gen5FontSize(Number(value))}px`;

export function gen5TypeScale() {
  // PostCSS visits a declaration again after it changes; scale each one once.
  const done = new WeakSet();
  const once = (decl) => {
    if (done.has(decl) || SKIP.test(decl.source?.input.file ?? "")) return false;
    done.add(decl);
    return true;
  };
  return {
    postcssPlugin: "gen5-type-scale",
    Declaration: {
      "font-size"(decl) {
        if (!once(decl)) return;
        // Plain pixel sizes only; clamp(), rem and em scale with their own rules.
        decl.value = decl.value.replace(/^(\d+(?:\.\d+)?)px(?=\s*(?:!important)?$)/u, scalePx);
      },
      font(decl) {
        if (!once(decl)) return;
        // The shorthand's size is the first pixel value, optionally followed by /line-height.
        decl.value = decl.value.replace(/(?<![\w.-])(\d+(?:\.\d+)?)px(?=\s|\/|$)/u, scalePx);
      },
    },
  };
}
gen5TypeScale.postcss = true;

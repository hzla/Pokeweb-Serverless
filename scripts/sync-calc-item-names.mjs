import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Import every generation, including the calculator's custom hack items.
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const source = resolve(root, args.find((arg) => arg !== "--check")
  ?? "../../calc-analytics/Dynamic-Calc-Hgengine/calc/data/items.js");
const target = resolve(root, "src/assets/data/calc_item_names.json");
const { ITEMS } = createRequire(import.meta.url)(source);
if (!Array.isArray(ITEMS) || !ITEMS.every((items) => Array.isArray(items)
  && items.every((name) => typeof name === "string" && name.length > 0))) {
  throw new Error("Expected calc/data/items.js to export an array of item-name arrays as ITEMS.");
}
const names = [...new Set(ITEMS.flat())].sort();
if (!names.length) throw new Error("Refusing to replace the catalog with an empty item list.");
const contents = JSON.stringify({
  source: "Dynamic-Calc-Hgengine/calc/data/items.js",
  sourceSha256: createHash("sha256").update(readFileSync(source)).digest("hex"),
  names,
}, null, 2) + "\n";
if (args.includes("--check")) {
  if (readFileSync(target, "utf8") !== contents) throw new Error("Calc item catalog is stale. Run npm run calc:items:sync.");
  console.log(`Verified ${names.length} calculator item names.`);
} else {
  writeFileSync(target, contents);
  console.log(`Copied ${names.length} calculator item names.`);
}

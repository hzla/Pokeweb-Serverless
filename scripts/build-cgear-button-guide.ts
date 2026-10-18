/** Refresh the guide's real source excerpts and decoded sprite examples. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NARC } from "../src/nds/narc";
import { preview } from "../src/cgearButtons/compiler";
import { encodePng } from "../src/customUi/assets";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = resolve(root, "docs/cgear-buttons");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((a) => a !== "--check"))
  throw new Error("Use --check or no arguments.");
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
function extractFunction(source: string, name: string): string {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const definition = new RegExp(
    `^(?:export |extern "C" )?[^\\n;{}]*\\b${safe}\\([^;{}]*?\\)\\s*(?::[^{}]+)?\\s*\\{`,
    "m",
  ).exec(source);
  if (!definition) throw new Error(`Function not found: ${name}`);
  const start = definition.index,
    open = start + definition[0].lastIndexOf("{");
  const tokens =
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[{}]/g;
  tokens.lastIndex = open + 1;
  let depth = 1,
    token: RegExpExecArray | null;
  while ((token = tokens.exec(source))) {
    if (token[0] === "{") depth++;
    if (token[0] === "}" && --depth === 0)
      return source.slice(start, tokens.lastIndex).trim();
  }
  throw new Error(`Unclosed function: ${name}`);
}
const htmlPath = resolve(directory, "index.html");
let html = await readFile(htmlPath, "utf8");
const blocks = [
  ...html.matchAll(
    /(<code\b[^>]*data-file="([^"]+)"[^>]*>)([\s\S]*?)(<\/code>)/g,
  ),
];
for (const block of blocks.reverse()) {
  const path = resolve(directory, block[2]);
  if (!path.startsWith(root))
    throw new Error("Source panels must use repository files.");
  const source = await readFile(path, "utf8");
  const symbol = /data-symbol="([^"]+)"/.exec(block[1])?.[1];
  const text = symbol ? extractFunction(source, symbol) : source.trim();
  const replacement = block[1] + escape(text) + block[4];
  html =
    html.slice(0, block.index) +
    replacement +
    html.slice(block.index! + block[0].length);
}
const manifest = JSON.parse(
  await readFile(
    resolve(root, "src/assets/codeinjection/cgearQuickActionsManifest.json"),
    "utf8",
  ),
);
html = html.replace(
  /(<span data-runtime-version>)[^<]*(<\/span>)/,
  `$1${manifest.version}$2`,
);
const hooks = [
  "QaCGearInit",
  "QaCGearUpdate",
  "QaGearUnit",
  "QaInput",
  "QaButtonHit",
  "QaCGearEvent",
  "QaGearEnd",
  "QaCGearExit",
  "QaRepelStep",
  "QaRepelDepleted",
];
const rows = hooks
  .map((hook) => {
    const w = manifest.games.W2.signatures.find(
      (s: { label: string }) => s.label === hook,
    );
    const b = manifest.games.B2.signatures.find(
      (s: { label: string }) => s.label === hook,
    );
    if (!w || !b) throw new Error(`Missing hook profile: ${hook}`);
    return `<tr><td><code>${hook}</code></td><td>${w.module}</td><td><code>0x${w.address.toString(16)}</code></td><td><code>0x${b.address.toString(16)}</code></td></tr>`;
  })
  .join("\n");
html = html.replace(
  /(<tbody data-hook-table>)[\s\S]*?(<\/tbody>)/,
  `$1\n${rows}\n$2`,
);
let verified = 0;
async function stage(path: string, bytes: Uint8Array | string) {
  const next =
    typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes);
  let before: Buffer | undefined;
  try {
    before = await readFile(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (!before?.equals(next)) {
    if (check)
      throw new Error(`Guide output is stale: ${path.slice(root.length)}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, next);
  }
  verified++;
}
await stage(htmlPath, html);
const archive = new Uint8Array(
  await readFile(
    resolve(root, "src/assets/codeinjection/cgearQuickActions.narc"),
  ),
);
const source = JSON.parse(
  new TextDecoder().decode(new NARC(archive).files[13]),
);
for (const action of ["repel", "pc", "party"]) {
  const index = source.applied.buttons.findIndex(
    (button: { action: string }) => button.action === action,
  );
  if (index < 0) throw new Error(`Missing sample artwork: ${action}`);
  for (const [pose, name] of ["normal", "active", "pressed"].entries()) {
    await stage(
      resolve(directory, `assets/${action}-${name}.png`),
      encodePng(preview(archive, index, pose)),
    );
  }
}
console.log(
  `${check ? "Verified" : "Refreshed"} ${blocks.length} source panels, ${hooks.length} hook rows and ${verified} guide files.`,
);

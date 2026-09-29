import { addSummaryPage } from "../src/customUi/summaryCatalog";
import { SUMMARY_PAGES } from "../src/customUi/document";
import { nativeLearnsetPreset } from "../src/customUi/nativeCatalog";
import { compileLearnsetNative } from "../src/customUi/learnsetNative";
import { withLearnsetData } from "../src/customUi/learnsetData";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { newProject } from "../src/customUi/document";
import { exportBundle, importBundle, archive } from "../src/customUi/bundle";
import { parseDocument, validate } from "../src/customUi/validate";
import { compile, preview } from "../src/customUi/compiler";
import { romAssets } from "../src/customUi/romAssets";
import { start } from "../src/customUi/interaction";
import { fixtures } from "../src/customUi/fixtures";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { NintendoDSRom } from "../src/nds/rom";

const [command, ...args] = process.argv.slice(2);
function option(name: string): string | undefined { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; }
async function main() {
  if (command === "new") { const output = args[0]; if (!output) throw new Error("new requires an output .pwui.zip path"); writeFileSync(output, exportBundle(newProject())); return; }
  if (!["validate", "compile", "compile-native", "preview", "unpack", "pack", "learnset-template", "summary-template"].includes(command)) throw new Error("Usage: npm run customui -- new output.pwui.zip | learnset-template --out output.pwui.zip | validate project.pwui.zip | unpack project.pwui.zip --out directory | pack project.json --out project.pwui.zip | compile|compile-native|preview project.pwui.zip --rom game.nds --out directory [--fixture empty|full|long|egg]");
  if (command === "summary-template") {
    const out = option("--out"); if (!out) throw new Error("summary-template --out design.pwui.zip");
    const p = newProject(); p.document.screens = []; p.document.launchers = {}; p.document.name = "Summary layouts";
    SUMMARY_PAGES.forEach(page => addSummaryPage(p.document, page)); writeFileSync(out, exportBundle(p)); return;
  }
  if (command === "learnset-template") {
    const out = option("--out"); if (!out) throw new Error("learnset-template --out design.pwui.zip");
    writeFileSync(out, exportBundle(nativeLearnsetPreset())); return;
  }
  const input = args[0]; if (!input) throw new Error("Input file is required.");
  if (command === "pack") {
    const document = parseDocument(JSON.parse(readFileSync(input, "utf8"))), files: Record<string, Uint8Array> = {};
    for (const a of document.assets) files[a.path] = new Uint8Array(readFileSync(resolve(input, "..", a.path)));
    const bytes = exportBundle({ document, files }); importBundle(bytes); writeFileSync(option("--out") ?? `${input}.pwui.zip`, bytes); return;
  }
  const design = importBundle(new Uint8Array(readFileSync(input)));
  if (command === "validate") { const diagnostics = validate(design.document); console.log(JSON.stringify({ valid: !diagnostics.some(d => d.severity === "error"), diagnostics }, null, 2)); return; }
  const directory = option("--out"); if (!directory) throw new Error("--out directory is required."); mkdirSync(directory, { recursive: true });
  if (command === "unpack") {
    writeFileSync(resolve(directory, "project.json"), JSON.stringify(design.document, null, 2) + "\n");
    if (design.document.assets.length) mkdirSync(resolve(directory, "assets"), { recursive: true });
    for (const a of design.document.assets) writeFileSync(resolve(directory, a.path), design.files[a.path]); return;
  }
  const romPath = option("--rom"); if (!romPath) throw new Error("--rom is required to resolve native assets.");
  const bytes = new Uint8Array(readFileSync(romPath)), project = await loadProjectFromRomBytes(bytes, romPath), rom = new NintendoDSRom(bytes, { fileData: "view" });
  const assets = romAssets(project, rom, design), result = compile(design.document, assets);
  const native = compileLearnsetNative(design.document);
  writeFileSync(resolve(directory, "diagnostics.json"), JSON.stringify({ valid: result.valid, nativeInstallable: !!native.bytes, diagnostics: result.diagnostics, nativeDiagnostics: native.diagnostics, budgets: result.screens.map(s => ({ id: s.id, ...s.budgets })) }, null, 2));
  if (!result.valid) throw new Error("Compilation failed; see diagnostics.json.");
  if (command === "compile-native" && !native.bytes) throw new Error("Native compilation failed; see diagnostics.json. Freeform designs currently support preview only.");
  writeFileSync(resolve(directory, "custom-ui.narc"), archive(design, result, native.bytes));
  if (command === "preview") {
    const fixture = fixtures[option("--fixture") ?? "full"]; if (!fixture) throw new Error("Unknown fixture."); const sample = withLearnsetData(project, fixture);
    for (const screen of design.document.screens) for (const frame of [0, 8]) {
      const session = start({ ...result.document, launchers: { field: screen.id } }, sample, "field"); session.frame = frame; if (screen.target) session.stack[0].moveSelection = { source: "moves", index: 0 };
      const rendered = preview(result, assets, sample, session);
      for (const physical of ["top", "bottom"] as const) { const image = new PNG({ width: 256, height: 192 }); image.data = Buffer.from(rendered[physical].pixels); writeFileSync(resolve(directory, `${screen.id}-${physical}-${frame}.png`), PNG.sync.write(image)); }
    }
  }
  console.log(`Wrote ${command} output to ${directory}.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

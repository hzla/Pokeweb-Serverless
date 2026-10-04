import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { NintendoDSRom } from "../src/nds/rom";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { prepareBw2TestBattleCodeInjection, stageCodeInjectionDll } from "../src/pokeweb/pmcModel";
import { rawSaveBytesFromDesmumeDsv, toDesmumeDsv } from "../src/pokeweb/testBattle";
import { parseHarnessConfig, patchHarnessExpandedPartyGuard, patchHarnessSave, patchHarnessTrainer, validateHarnessRom } from "../src/pokeweb/battleHarness";
import { detectBw2Upgrade } from "../src/pokeweb/black2UpgradeModel";

const usage = "npm run battle:harness -- --rom INPUT.nds --save INPUT.sav --config SCENARIO.json --out OUTPUT.nds";
const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (key === "--help") { console.log(usage); process.exit(0); }
  if (!["--rom", "--save", "--config", "--out", "--trainer"].includes(key) || !value || args.has(key)) throw new Error(usage);
  args.set(key, value);
}
if (!args.has("--rom") || !args.has("--save") || !(args.has("--config") || args.has("--trainer"))) throw new Error(usage);
const input = resolve(args.get("--rom")!), saveInput = resolve(args.get("--save")!);
const defaultDirectory = fileURLToPath(new URL("../../.pokeweb-local-archive/current/battle-harness/", import.meta.url));
const config = parseHarnessConfig(args.has("--config") ? JSON.parse(await readFile(resolve(args.get("--config")!), "utf8")) : { trainerId: Number(args.get("--trainer")) });
if (args.has("--trainer") && args.has("--config")) throw new Error("Use --trainer or --config, not both");
const output = resolve(args.get("--out") ?? `${defaultDirectory}/trainer-${config.trainerId}-${Date.now()}.nds`);
if (!/\.nds$/iu.test(output)) throw new Error("--out must end in .nds");
const prefix = output.slice(0, -4);
if ([output, `${prefix}.sav`, `${prefix}.dsv`].includes(input) || [output, `${prefix}.sav`, `${prefix}.dsv`].includes(saveInput)) throw new Error("Outputs must be separate from input files");
// All output files are created exclusively; never overwrite a working save.
const bytes = new Uint8Array(await readFile(input)), inputSave = new Uint8Array(await readFile(saveInput));
const inputRom = new NintendoDSRom(bytes, { fileData: "view" });
validateHarnessRom(inputRom);
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw new Error(`Expected bundled local asset: ${url}`);
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const project = await loadProjectFromRomBytes(bytes, basename(input), { selectedNarcs: ["message_texts", "personal", "moves", "trdata", "trpok"] });
const rule = patchHarnessTrainer(project, config);
const save = patchHarnessSave(rawSaveBytesFromDesmumeDsv(inputSave), project, config);
const expandedPartyBootGuard = detectBw2Upgrade(project) === "white2-upgrade";
if (expandedPartyBootGuard) patchHarnessExpandedPartyGuard(project, inputRom.loadArm9Overlays([36]).get(36)!);
// Keep only explicitly authored trainer/Personal edits. Loading data for validation must
// not export editor normalization or incidental form-name repairs.
for (const [name, store] of Object.entries(project.narcs)) if (!["trdata", "trpok", "personal"].includes(name) || !store?.dirty.size) delete project.narcs[name as keyof typeof project.narcs];
await prepareBw2TestBattleCodeInjection(project);
const build = await mkdtemp(`${tmpdir()}/pokeweb-battle-harness-`);
let created: string[] = [];
try {
  const command = fileURLToPath(new URL("../runtime/battle-harness/build.py", import.meta.url));
  await promisify(execFile)(process.env.PYTHON ?? "python3", [command, "--trainer", String(config.trainerId), "--rule", String(rule), "--out", build]);
  const dll = new Uint8Array(await readFile(`${build}/BattleHarnessW2.dll`));
  const nativeVerification = JSON.parse(await readFile(`${build}/verification.json`, "utf8"));
  stageCodeInjectionDll(project, "BattleHarnessW2.dll", dll);
  const rom = await exportModifiedRom(project, { preserveOriginalLength: true });
  const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
  const manifest = { format: "pokeweb-battle-harness-1", config, rule, expandedPartyBootGuard, nativeVerification, inputRomSha256: sha256(bytes), inputSaveSha256: sha256(inputSave), romSha256: sha256(rom), saveSha256: sha256(save), dllSha256: sha256(dll), emulatorValidation: "Not run by builder; use scripts/test-battle-harness-headless.py" };
  await mkdir(dirname(output), { recursive: true });
  for (const [path, data] of [[output, rom], [`${prefix}.sav`, save], [`${prefix}.dsv`, toDesmumeDsv(save)], [`${prefix}.json`, JSON.stringify(manifest, null, 2) + "\n"]] as const) {
    await writeFile(path, data, { flag: "wx" });
    created.push(path);
  }
  console.log(`Automatic trainer battle ${config.trainerId} (${config.battleType ?? ["Singles", "Doubles", "Triples", "Rotation"][rule]})\nROM: ${output}\nSave: ${prefix}.sav\nDeSmuME save: ${prefix}.dsv`);
  created = [];
} finally {
  await Promise.all(created.map(path => rm(path, { force: true })));
  await rm(build, { recursive: true, force: true });
}

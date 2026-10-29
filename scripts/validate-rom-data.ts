import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { validateRomData } from "../src/pokeweb/romDataValidation";

const usage = `Usage: npm run rom:validate -- ROM.nds [--json REPORT.json] [--strict] [--max-output 50] [--max-issues 10000]

Read-only core data scan for Black, White, Black 2 and White 2.
Exit codes: 0 = no errors; 1 = errors (or warnings with --strict); 2 = usage/input failure.
JSON reports are created exclusively; existing files and the input ROM are never overwritten.`;

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) { console.log(usage); return 0; }
  let input: string | undefined, json: string | undefined, strict = false, maxOutput = 50, maxIssues = 10000;
  for (let at = 0; at < args.length; at++) {
    const arg = args[at];
    if (arg === "--strict") strict = true;
    else if (["--json", "--max-output", "--max-issues"].includes(arg)) {
      const value = args[++at]; if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--json") json = value;
      else {
        const number = Number(value), max = arg === "--max-issues" ? 100000 : 10000;
        if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new Error(`${arg} must be an integer in 1..${max}.`);
        if (arg === "--max-issues") maxIssues = number; else maxOutput = number;
      }
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}.`);
    else if (!input) input = arg;
    else throw new Error("Pass exactly one input ROM.");
  }
  if (!input) throw new Error(usage);
  if (json && resolve(input) === resolve(json)) throw new Error("The JSON report must not replace the input ROM.");
  const bytes = new Uint8Array(await readFile(input));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const report = validateRomData(bytes, { maxIssues });
  const output = { input: { fileName: basename(input), bytes: bytes.length, sha256 }, ...report };
  // wx also protects symlinks/hardlinks to the ROM and existing report files.
  if (json) await writeFile(json, JSON.stringify(output, null, 2) + "\n", { flag: "wx" });
  console.log(`${report.version} (${report.game}): ${report.errors} error(s), ${report.warnings} warning(s).`);
  for (const a of report.archives) console.log(`  ${a.archive}: ${a.checked} checked, ${a.skipped} skipped; ${a.errors} error(s), ${a.warnings} warning(s)`);
  for (const item of report.issues.slice(0, maxOutput)) {
    const where = `${item.path}${item.record === undefined ? "" : ` [${item.record}${item.label ? ` ${item.label}` : ""}]`}${item.offset === undefined ? "" : ` +0x${item.offset.toString(16)}`}`;
    console.log(`${item.severity.toUpperCase()} ${where} ${item.code}: ${item.message}`);
  }
  if (report.errors + report.warnings > maxOutput) console.log(`Showing at most ${maxOutput} findings. Use --json for retained details.`);
  if (report.omittedIssues) console.log(`${report.omittedIssues} detail(s) omitted by --max-issues; all findings were counted.`);
  if (json) console.log(`Report: ${json}`);
  console.log("No ROM bytes were changed. See docs/rom-data-validation.md for scope and warning meanings.");
  return report.errors || strict && report.warnings ? 1 : 0;
}

try { process.exitCode = await main(); }
catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 2; }

import { mkdtempSync, readFileSync, rmSync, writeFileSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { writeU16 } from "../nds/binary";
import { coreDataFixture } from "./fixtures/romDataValidationRom";

const script = resolve("scripts/validate-rom-data.ts"), runner = resolve("node_modules/vite-node/vite-node.mjs");
function run(...args: string[]) { return spawnSync(process.execPath, [runner, script, ...args], { encoding: "utf8", timeout: 15000 }); }

describe("ROM data validator command", () => {
  it("returns CI exit codes, writes useful JSON and preserves both inputs and existing files", () => {
    const root = mkdtempSync(join(tmpdir(), "pokeweb-validation-"));
    try {
      const input = join(root, "sample.nds"), output = join(root, "report.json"), f = coreDataFixture();
      const valid = f.rom(); writeFileSync(input, valid);
      const success = run(input, "--json", output); expect(success.status, success.stderr).toBe(0);
      expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({ errors: 0, warnings: 0, input: { fileName: "sample.nds", bytes: valid.length } });
      expect(readFileSync(input)).toEqual(Buffer.from(valid));
      const originalReport = readFileSync(output); expect(run(input, "--json", output).status).toBe(2); expect(readFileSync(output)).toEqual(originalReport);
      expect(run(input, "--json", input).status).toBe(2); expect(readFileSync(input)).toEqual(Buffer.from(valid));
      const linked = join(root, "linked.json"); linkSync(input, linked); expect(run(input, "--json", linked).status).toBe(2); expect(readFileSync(input)).toEqual(Buffer.from(valid));
      writeU16(f.files.personal[1], 12, 0x3fff); writeFileSync(input, f.rom());
      const invalid = run(input); expect(invalid.status).toBe(1); expect(invalid.stdout).toContain("found 16383");
      writeU16(f.files.personal[1], 12, 0); f.files.personal[1][0] = 0; writeFileSync(input, f.rom());
      expect(run(input).status).toBe(0); expect(run(input, "--strict").status).toBe(1);
      expect(run(input, "--max-output", "NaN").status).toBe(2); expect(run(input, "--bogus").status).toBe(2);
      expect(run("--help").status).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 20000);
});

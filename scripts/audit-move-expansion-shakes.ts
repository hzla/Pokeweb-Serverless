import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import expansion from "../src/assets/data/white2upgradeMoveExpansion.json";
import { decompileMoveAnimationBytes, parseMoveAnimationScript } from "../src/pokeweb/moveAnimationModel";
import { auditMoveAnimationShakes } from "../src/pokeweb/moveAnimationShakeAudit";
import { parseMoveExpansionAnimationBundle } from "../src/pokeweb/moveExpansionPatch";

const args = process.argv.slice(2), index = args.indexOf("--out");
if (index < 0 || !args[index + 1]) throw new Error("Usage: vite-node scripts/audit-move-expansion-shakes.ts --out /external/path/audit.json");
const output = path.resolve(args[index + 1]), repo = path.resolve(import.meta.dirname, "..");
if (output.startsWith(`${repo}${path.sep}`) && !output.startsWith(path.join(repo, "work") + path.sep)) throw new Error("Write diagnostics outside the repository or under ignored work/.");
const bytes = new Uint8Array(await readFile(new URL("../src/assets/data/white2upgradeGen6MoveAnimations.zip", import.meta.url)));
const names = new Map(expansion.moves.map(move => [move.sourceId, move.name]));
const moves = parseMoveExpansionAnimationBundle(bytes).moves.map(move => {
  const script = decompileMoveAnimationBytes(move.bytes), parsed = parseMoveAnimationScript(script);
  return {
    sourceMoveId: move.sourceMoveId, targetMoveId: move.targetMoveId, name: names.get(move.sourceMoveId),
    scriptBodies: parsed.scripts.size,
    shakeCommands: [...parsed.scripts.values()].flat().filter(command => command.name === "ShakeSprite").length,
    overlaps: auditMoveAnimationShakes(script),
  };
});
const report = {
  format: "pokeweb-move-expansion-shake-audit", version: 1,
  bundleSha256: createHash("sha256").update(bytes).digest("hex"),
  method: "Static inspection of every packaged script body; native position-step durations and conservative VM scheduling bounds. Includes shake/shake and shake/circular-position conflicts.",
  limitations: "Not a visual, sound or arbitrary control-flow simulation. Other completion waits can add time, so reported conflicts across those waits require native confirmation. Covers packaged actor selectors and supported position commands.",
  summary: { moves: moves.length, scriptBodies: moves.reduce((n, move) => n + move.scriptBodies, 0), shakeCommands: moves.reduce((n, move) => n + move.shakeCommands, 0), affectedMoves: moves.filter(move => move.overlaps.length).length, overlaps: moves.reduce((n, move) => n + move.overlaps.length, 0) },
  moves,
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.summary, null, 2));

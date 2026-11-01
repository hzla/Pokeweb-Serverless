/** Verify side-recipe installation and restoration on an explicitly supplied ROM. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadProjectFromRomBytes } from "../../src/pokeweb/loader";
import { clearMoveRules, configureMoveRuleSets, inspectMoveEffects } from "../../src/pokeweb/moveEffectsModel";
import { MOVE_ALWAYS, newMoveEffect } from "../../src/pokeweb/moveRules";
import { decodeRecord, markDirty } from "../../src/pokeweb/projectStore";
import { exportModifiedRom } from "../../src/pokeweb/exportRom";

const [path] = process.argv.slice(2); assert(path);
globalThis.fetch = (async (request: RequestInfo | URL) => {
  const url = new URL(request instanceof Request ? request.url : String(request));
  if (url.protocol !== "file:") throw Error("Only local assets permitted");
  return new Response(new Uint8Array(await readFile(url)));
}) as typeof fetch;
const load = (data: Uint8Array) => loadProjectFromRomBytes(data, "side.nds", { selectedNarcs: ["moves", "message_texts"] });
let project = await load(new Uint8Array(await readFile(path)));
const ids = [33, 52], kinds = ["entryStatHazard", "swapSideEffects"];
for (const id of ids) {
  const raw = decodeRecord(project, "moves", id).raw!;
  raw.category = 0; raw.power = 0; raw.effect_category = 13;
  markDirty(project, "moves", id);
}
const edits = ids.map((moveId, n) => ({ moveId, rules: { conditions: MOVE_ALWAYS, prerequisites: MOVE_ALWAYS, effects: [newMoveEffect(kinds[n])] } }));
await configureMoveRuleSets(project, edits);
assert.equal(decodeRecord(project, "moves", 33).raw!.effect_category, 11);
project = await load(await exportModifiedRom(project, { forDsi: false }));
const result = inspectMoveEffects(project); assert(result.editable, result.message);
for (const e of edits) assert.deepEqual(result.rules.get(e.moveId), e.rules);
assert.equal(decodeRecord(project, "moves", 33).raw!.effect_category, 11);
await clearMoveRules(project, 33);
assert.equal(decodeRecord(project, "moves", 33).raw!.effect_category, 13);
project = await load(await exportModifiedRom(project, { forDsi: false }));
assert.equal(decodeRecord(project, "moves", 33).raw!.effect_category, 13);
assert(!inspectMoveEffects(project).rules.has(33));
assert(inspectMoveEffects(project).rules.has(52));
console.log(JSON.stringify({ game: project.session.baseVersion, exportReload: true, removalRestored: true }));

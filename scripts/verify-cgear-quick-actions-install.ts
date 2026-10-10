import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, resolve } from "node:path";
import { NintendoDSRom } from "../src/nds/rom";
import { loadProjectFromRomBytes } from "../src/pokeweb/loader";
import { exportModifiedRom } from "../src/pokeweb/exportRom";
import { getCGearQuickActionsStatus, installCGearQuickActions, disableCGearQuickActions, removeCGearQuickActions } from "../src/pokeweb/cgearQuickActionsModel";
import { ensureCGearButtons, hasUnappliedButtons } from "../src/pokeweb/cgearButtonsModel";
import { newButton } from "../src/cgearButtons/document";
import { installLearnsetViewer, getLearnsetViewerStatus } from "../src/pokeweb/learnsetViewerModel";
import { installSummaryStatViewer, getSummaryStatViewerStatus } from "../src/pokeweb/summaryStatViewerModel";
import { installPortaPc, getPortaPcStatus } from "../src/pokeweb/portaPcModel";
const input = process.argv[2];if(!input) throw new Error("Pass INPUT.nds [--output SEPARATELY-NAMED.nds]");
const digest=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const bytes = new Uint8Array(await readFile(input)), before=digest(bytes);
globalThis.fetch=(async(value:RequestInfo|URL)=> {
  const url=value instanceof URL?value:new URL(value instanceof Request?value.url:String(value));
  return new Response(new Uint8Array(await readFile(new URL(`../src/assets/codeinjection/${url.pathname.split("/").pop()}`,import.meta.url))));
}) as typeof fetch;
const project=await loadProjectFromRomBytes(bytes,basename(input),{selectedNarcs:[]});
if(process.argv.includes('--companions')) {
  await installLearnsetViewer(project);await installSummaryStatViewer(project);await installPortaPc(project);
}
assert(getCGearQuickActionsStatus(project).compatible,getCGearQuickActionsStatus(project).message);
if(process.argv.includes("--eight")) {
  const d=ensureCGearButtons(project).document;let added=0;
  while(d.buttons.length<8)d.buttons.push(newButton(d,(process.argv.includes('--bag-party')?["dowsing","rod","bag","party"]:["dowsing","rod","medals","recorder"])[added++%4] as "dowsing"));
}
await installCGearQuickActions(project);await installCGearQuickActions(project);
disableCGearQuickActions(project);assert(!getCGearQuickActionsStatus(project).enabled);
if(getCGearQuickActionsStatus(project).canRemove) {removeCGearQuickActions(project);assert(!getCGearQuickActionsStatus(project).installed);}
await installCGearQuickActions(project);
const output=await exportModifiedRom(project), original=new NintendoDSRom(bytes,{fileData:"view"}), exported=new NintendoDSRom(output,{fileData:"view"});
for(const id of [12,36,79]) assert.deepEqual(exported.loadArm9Overlays([id]).get(id)!.data,original.loadArm9Overlays([id]).get(id)!.data);
const reopened=await loadProjectFromRomBytes(output,"quick-actions-test.nds",{selectedNarcs:[]});
assert(getCGearQuickActionsStatus(reopened).installed && getCGearQuickActionsStatus(reopened).enabled);
assert.deepEqual(reopened.cgearButtons,project.cgearButtons);assert(!hasUnappliedButtons(reopened));
if(process.argv.includes('--companions')) {
  for(const status of [getLearnsetViewerStatus(reopened),getSummaryStatViewerStatus(reopened),getPortaPcStatus(reopened)])assert(status.installed && status.compatible,status.message);
}
await installCGearQuickActions(reopened);assert(getCGearQuickActionsStatus(reopened).compatible);
assert.equal(digest(new Uint8Array(await readFile(input))),before,"Input ROM changed");
const index=process.argv.indexOf("--output");
if(index>=0) {const path=process.argv[index+1];if(!path || resolve(path)===resolve(input)) throw new Error("Use a separate output filename.");await writeFile(path,output,{flag:"wx"});}
console.log(project.session.baseVersion,"install, update, disable, staged removal, export/reload and source preservation passed");

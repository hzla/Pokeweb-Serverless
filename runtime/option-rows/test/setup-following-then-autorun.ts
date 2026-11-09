import type { ProjectState } from "../../../src/pokeweb/projectStore";
import { installAutorun, getAutorunStatus } from "../../../src/pokeweb/autorunModel";
import { installFollowerAlpha, readFollowerAlphaInstall, followerRom } from "../../../src/pokeweb/followingPokemonProject";
import { readOptionRowsState } from "../../../src/pokeweb/optionRowsModel";
export default async function setup(project: ProjectState, argv: string[]): Promise<void> {
  const autorunFirst = argv.includes("--autorun-first");
  if (autorunFirst) await installAutorun(project);
  await installFollowerAlpha(project);
  if (!autorunFirst) await installAutorun(project);
  // Re-running Following's install must accept the delegated Options slot.
  await installFollowerAlpha(project);
  const receipt = await readFollowerAlphaInstall(project, await followerRom(project));
  console.log(JSON.stringify({ rows: readOptionRowsState(project), autorun: getAutorunStatus(project), followingEnabled: receipt?.enabled }));
}

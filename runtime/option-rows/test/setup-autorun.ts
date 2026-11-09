import type { ProjectState } from "../../../src/pokeweb/projectStore";
import { installAutorun } from "../../../src/pokeweb/autorunModel";
export default async function setup(project: ProjectState): Promise<void> {
  await installAutorun(project);
}

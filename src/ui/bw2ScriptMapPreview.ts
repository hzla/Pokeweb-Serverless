import type { ProjectState } from "../pokeweb/projectStore";
import { bw2ScriptMapChoices } from "../pokeweb/bw2ScriptContextModel";
import { installBw2MapPreview, type Bw2MapPreview } from "./bw2MapPreview";

export type Bw2ScriptMapPreview = Pick<Bw2MapPreview, "setFocus" | "destroy">;

export function installBw2ScriptMapPreview(project: ProjectState, root: HTMLElement, fileId: number): Bw2ScriptMapPreview {
  try {
    return installBw2MapPreview(project, root, { choices: bw2ScriptMapChoices(project, fileId),
      emptyMessage: `No map header references script file ${fileId}. It may be a global or auxiliary script.` });
  } catch (error) {
    return installBw2MapPreview(project, root, { choices: [], emptyMessage: error instanceof Error ? error.message : String(error) });
  }
}

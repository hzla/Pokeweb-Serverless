import type { ProjectState } from "../pokeweb/projectStore";
import type { Image } from "../customUi/assets";
import type { Design } from "./document";
import { compose, type PreviewOptions } from "./graphics";
import { openMainMenu, validateMainMenu, applyMainMenu, type Library } from "./model";

export type ScreenAdapter = {
  readonly id: "mainMenu";
  readonly name: string;
  load(project: ProjectState): Promise<Library>;
  preview(library: Library, design: Design, options: PreviewOptions): Image;
  validate(library: Library, design: Design): string[];
  stage(project: ProjectState, library: Library, signal?: AbortSignal): Promise<{ changed: boolean; quantized: boolean }>;
};
export const MAIN_MENU_ADAPTER: ScreenAdapter = {
  id: "mainMenu", name: "Main menu", load: openMainMenu,
  preview: (library, design, options) => compose(library.resources, design, options),
  validate: validateMainMenu, stage: applyMainMenu,
};
export const SCREEN_ADAPTERS: readonly ScreenAdapter[] = [MAIN_MENU_ADAPTER];

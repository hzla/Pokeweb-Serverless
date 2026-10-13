import type { ProjectState } from "../pokeweb/projectStore";

type MoveListFilters = {
  searchText: string;
  categories: Set<string>;
  types: Set<string>;
  generations: Set<number>;
};

const filtersByProject = new WeakMap<ProjectState, MoveListFilters>();

export function getMoveListFilters(project: ProjectState): MoveListFilters {
  let filters = filtersByProject.get(project);
  if (!filters) {
    filters = { searchText: "", categories: new Set(), types: new Set(), generations: new Set() };
    filtersByProject.set(project, filters);
  }
  return filters;
}

import { describe, expect, it } from "vitest";
import type { ProjectState } from "../pokeweb/projectStore";
import { getMoveListFilters } from "../ui/moveListFilters";

describe("move list filters", () => {
  it("keeps all filters when the same project returns to the move page", () => {
    const project = {} as ProjectState;
    const filters = getMoveListFilters(project);
    filters.searchText = "pulse";
    filters.categories.add("special");
    filters.types.add("water");
    filters.generations.add(6);
    filters.generations.add(7);

    const restored = getMoveListFilters(project);
    expect(restored).toBe(filters);
    expect(restored.searchText).toBe("pulse");
    expect([...restored.categories]).toEqual(["special"]);
    expect([...restored.types]).toEqual(["water"]);
    expect([...restored.generations]).toEqual([6, 7]);
  });

  it("starts a different ROM project with no filters", () => {
    const previous = getMoveListFilters({} as ProjectState);
    previous.searchText = "beam";
    previous.generations.add(9);
    const next = getMoveListFilters({} as ProjectState);
    expect(next.searchText).toBe("");
    expect(next.categories.size).toBe(0);
    expect(next.types.size).toBe(0);
    expect(next.generations.size).toBe(0);
  });

  it("retains filter removal on the next render", () => {
    const project = {} as ProjectState;
    const filters = getMoveListFilters(project);
    filters.generations.add(6);
    filters.generations.delete(6);
    filters.searchText = "";
    expect(getMoveListFilters(project).generations.size).toBe(0);
  });
});

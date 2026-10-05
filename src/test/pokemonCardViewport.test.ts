import { afterEach, describe, expect, it, vi } from "vitest";
import { installPokemonCardViewport } from "../ui/pokemonCardViewport";

// Only model the DOM operations this controller needs. Browser integration
// checks cover the real editor's layout, filtering, and editable fields.
function harness(useObserver = true) {
  let intersect: IntersectionObserverCallback;
  let mutate: MutationCallback;
  let attached = true;
  let value = "60";
  const documentState = { activeElement: null as unknown };
  vi.stubGlobal("document", documentState);
  const observer = { observe: vi.fn(), disconnect: vi.fn() };
  vi.stubGlobal("IntersectionObserver", useObserver ? class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; }
    observe = observer.observe;
    disconnect = observer.disconnect;
  } : undefined);
  vi.stubGlobal("ResizeObserver", undefined);
  const mutations = { observe: vi.fn(), disconnect: vi.fn() };
  vi.stubGlobal("MutationObserver", class {
    constructor(callback: MutationCallback) { mutate = callback; }
    observe = mutations.observe;
    disconnect = mutations.disconnect;
  });

  const cards = Array.from({ length: 3 }, () => {
    const classes = new Set(["pokemon-card-placeholder"]);
    const properties = new Map<string, string>();
    const card = {
      content: "", open: false, focusedChild: {},
      style: { display: "", setProperty: (key: string, next: string) => properties.set(key, next), removeProperty: (key: string) => properties.delete(key) },
      classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
      setAttribute: vi.fn(), removeAttribute: vi.fn(),
      contains: (node: unknown) => node === card.focusedChild,
      querySelector: () => card.open ? {} : null,
      getBoundingClientRect: () => ({ height: 330 }),
      replaceChildren: () => { card.content = ""; },
      classes, properties,
    };
    return card;
  });
  const list = { querySelectorAll: () => cards, contains: (card: unknown) => attached && cards.includes(card as typeof cards[number]) };
  const root = Object.assign(new EventTarget(), {
    querySelector: () => list, contains: () => attached, closest: () => null,
  });
  const render = vi.fn((card: HTMLElement) => { (card as unknown as typeof cards[number]).content = value; });
  const onDisconnect = vi.fn();
  const disconnect = installPokemonCardViewport(root as unknown as HTMLElement, render, onDisconnect);
  return {
    cards, root, render, observer, mutations, onDisconnect, disconnect, documentState,
    setValue: (next: string) => { value = next; },
    show: (...entries: Array<[number, boolean]>) => intersect(entries.map(([id, isIntersecting]) => ({ target: cards[id], isIntersecting })) as unknown as IntersectionObserverEntry[], {} as IntersectionObserver),
    removeEditor: () => { attached = false; mutate([], {} as MutationObserver); },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("personal card viewport", () => {
  it("defers distant rows, unloads old cards, and remounts with current edits", () => {
    const view = harness();
    expect(view.render).not.toHaveBeenCalled();
    view.show([0, true]);
    expect(view.cards.map(card => card.content)).toEqual(["60", "", ""]);
    view.show([0, false], [2, true]);
    expect(view.cards.map(card => card.content)).toEqual(["", "", "60"]);
    expect(view.cards[0].properties.get("--pokemon-card-height")).toBe("330px");
    view.setValue("88");
    view.show([2, false], [0, true]);
    expect(view.cards[0].content).toBe("88");
    view.disconnect();
  });

  it("keeps a focused edit alive until blur commits it", async () => {
    const view = harness();
    view.show([0, true]);
    view.documentState.activeElement = view.cards[0].focusedChild;
    view.show([0, false], [2, true]);
    expect(view.cards[0].content).toBe("60");
    view.documentState.activeElement = null;
    view.root.dispatchEvent(new Event("focusout"));
    await Promise.resolve();
    expect(view.cards[0].content).toBe("");
    view.disconnect();
  });

  it("preserves an open panel while distant collapsed cards unload", () => {
    const view = harness();
    view.show([0, true], [1, true]);
    view.cards[0].open = true;
    view.show([0, false], [1, false], [2, true]);
    expect(view.cards.map(card => card.content)).toEqual(["60", "", "60"]);
    view.disconnect();
  });

  it("ignores callbacks after navigating away and disconnects once", () => {
    const view = harness();
    view.show([0, true]);
    view.removeEditor();
    view.show([2, true]);
    view.disconnect();
    expect(view.render).toHaveBeenCalledTimes(1);
    expect(view.observer.disconnect).toHaveBeenCalledOnce();
    expect(view.mutations.disconnect).toHaveBeenCalledOnce();
    expect(view.onDisconnect).toHaveBeenCalledOnce();
  });

  it("keeps the editor usable when IntersectionObserver is unavailable", () => {
    const view = harness(false);
    expect(view.cards.map(card => card.content)).toEqual(["60", "60", "60"]);
    view.disconnect();
  });
});

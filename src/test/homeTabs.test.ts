import { describe, expect, it, vi } from "vitest";
import { attachHomeTabs, HOME_TABS, homeTabFromHash, homeTabUrl, type HomeTab } from "../ui/homeTabs";

function event(overrides: Partial<{
  button: number; key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean;
}> = {}) {
  return { button: 0, key: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    ...overrides, preventDefault: vi.fn() };
}

function fixture(initialTab?: HomeTab) {
  const tabs = HOME_TABS.map(name => ({
    dataset: { homeTab: name }, href: "", tabIndex: -1, attributes: {} as Record<string, string>, focus: vi.fn(),
    events: {} as Record<string, (e: ReturnType<typeof event>) => void>,
    setAttribute(key: string, value: string) { this.attributes[key] = value; },
    addEventListener(key: string, listener: (e: ReturnType<typeof event>) => void) { this.events[key] = listener; },
  }));
  const panels = HOME_TABS.map(name => ({ dataset: { homePanel: name }, hidden: true }));
  const root = { querySelectorAll: (selector: string) => selector === "[data-home-tab]" ? tabs : panels };
  const onSelect = vi.fn();
  const controller = attachHomeTabs(root as unknown as HTMLElement, { initialTab, onSelect });
  const active = () => tabs.filter(tab => tab.attributes["aria-selected"] === "true").map(tab => tab.dataset.homeTab);
  const visible = () => panels.filter(panel => !panel.hidden).map(panel => panel.dataset.homePanel);
  return { tabs, panels, onSelect, controller, active, visible };
}

describe("homepage tab URLs", () => {
  it.each(HOME_TABS)("restores %s from its shareable link", tab => {
    const hash = homeTabUrl(tab);
    const f = fixture(homeTabFromHash(hash));
    expect(f.active()).toEqual([tab]);
    expect(f.visible()).toEqual([tab]);
    expect(f.tabs.find(candidate => candidate.dataset.homeTab === tab)!.tabIndex).toBe(0);
    expect(f.onSelect).not.toHaveBeenCalled();
  });

  it("uses an explicit path for the disclaimer and preserves the upload URL", () => {
    expect(homeTabUrl("ai-use-disclaimer")).toBe("#upload/ai-use-disclaimer");
    expect(homeTabUrl("upload")).toBe("#upload");
  });

  it.each(["#upload", "#upload/", "#upload/unknown", "#upload/__proto__"])("defaults %s to ROM Upload", hash => {
    expect(homeTabFromHash(hash)).toBe("upload");
  });

  it.each(["", "#changelog", "#pokemon/25", "#codeInjection"])("leaves editor route %s to the app router", hash => {
    expect(homeTabFromHash(hash)).toBeUndefined();
  });
});

describe("homepage tab navigation", () => {
  it("gives each tab a copyable link and reports a new selection only once", () => {
    const f = fixture();
    expect(f.tabs.map(tab => tab.href)).toEqual(HOME_TABS.map(homeTabUrl));
    const click = event();
    f.tabs[5].events.click(click);
    expect(click.preventDefault).toHaveBeenCalledOnce();
    expect(f.active()).toEqual(["ai-use-disclaimer"]);
    expect(f.visible()).toEqual(["ai-use-disclaimer"]);
    expect(f.onSelect).toHaveBeenCalledOnce();
    expect(f.onSelect).toHaveBeenCalledWith("ai-use-disclaimer");
    f.tabs[5].events.click(event());
    expect(f.onSelect).toHaveBeenCalledOnce();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
    "retains normal browser link behavior for %j", modifiers => {
      const f = fixture(), click = event(modifiers);
      f.tabs[5].events.click(click);
      expect(click.preventDefault).not.toHaveBeenCalled();
      expect(f.onSelect).not.toHaveBeenCalled();
      expect(f.active()).toEqual(["upload"]);
    },
  );

  it("restores history selections without another navigation or replacing the panels", () => {
    const f = fixture("ai-use-disclaimer"), originalPanel = f.panels[5];
    f.controller.select("repair");
    expect(f.active()).toEqual(["repair"]);
    expect(f.visible()).toEqual(["repair"]);
    f.controller.select("ai-use-disclaimer");
    expect(f.active()).toEqual(["ai-use-disclaimer"]);
    expect(f.panels[5]).toBe(originalPanel);
    expect(f.onSelect).not.toHaveBeenCalled();
  });

  it("keeps arrow, Home, End and Space keyboard selection accessible", () => {
    const f = fixture();
    f.tabs[0].events.keydown(event({ key: "ArrowLeft" }));
    expect(f.active()).toEqual(["ai-use-disclaimer"]);
    expect(f.tabs[5].focus).toHaveBeenCalledOnce();
    f.tabs[5].events.keydown(event({ key: "ArrowRight" }));
    expect(f.active()).toEqual(["upload"]);
    f.tabs[0].events.keydown(event({ key: "End" }));
    expect(f.active()).toEqual(["ai-use-disclaimer"]);
    f.tabs[5].events.keydown(event({ key: "Home" }));
    expect(f.active()).toEqual(["upload"]);
    f.tabs[2].events.keydown(event({ key: " " }));
    expect(f.active()).toEqual(["translation"]);
    expect(f.onSelect).toHaveBeenLastCalledWith("translation");
    const otherKey = event({ key: "ArrowDown" });
    f.tabs[2].events.keydown(otherKey);
    expect(otherKey.preventDefault).not.toHaveBeenCalled();
  });
});

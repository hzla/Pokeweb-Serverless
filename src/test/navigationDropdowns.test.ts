import { describe, expect, it, vi } from "vitest";
import { attachNavigationDropdowns } from "../ui/navigationDropdowns";

function fixture(disabled = false) {
  const classes = new Set<string>(), attributes: Record<string, string> = {};
  const triggerEvents: Record<string, (event: { key?: string; preventDefault: () => void; stopPropagation: () => void }) => void> = {};
  const menuEvents: Record<string, (event: { relatedTarget?: unknown }) => void> = {};
  const first = { classList: { contains: () => disabled }, getAttribute: () => null, click: vi.fn(), focus: vi.fn() };
  const menu = {
    classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) },
    contains: (target: unknown) => target === first,
    addEventListener: (name: string, action: typeof menuEvents[string]) => { menuEvents[name] = action; },
    querySelector: (selector: string) => selector === ".header-more-trigger" ? trigger : first,
  };
  const trigger = {
    setAttribute: (name: string, value: string) => { attributes[name] = value; },
    addEventListener: (name: string, action: typeof triggerEvents[string]) => { triggerEvents[name] = action; },
  };
  const root = { querySelectorAll: () => [menu] };
  attachNavigationDropdowns(root as unknown as HTMLElement);
  return { first, attributes, classes, triggerEvents, menuEvents };
}

describe("Navigation dropdowns", () => {
  it("activates the first option through its existing route or action handler", () => {
    const f = fixture(), event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    f.triggerEvents.click(event);
    expect(f.first.click).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });

  it("does not skip a disabled first option or activate it", () => {
    const f = fixture(true);
    f.triggerEvents.click({ preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(f.first.click).not.toHaveBeenCalled();
  });

  it("reports hover and focus as an open menu and supports keyboard access", () => {
    const f = fixture();
    f.menuEvents.pointerenter({}); expect(f.attributes["aria-expanded"]).toBe("true");
    f.menuEvents.pointerleave({}); expect(f.attributes["aria-expanded"]).toBe("false");
    f.triggerEvents.keydown({ key: "ArrowDown", preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(f.first.focus).toHaveBeenCalledOnce(); expect(f.first.click).not.toHaveBeenCalled();
    expect(f.classes.has("-open")).toBe(true);
    f.menuEvents.focusin({}); f.menuEvents.focusout({ relatedTarget: f.first });
    expect(f.attributes["aria-expanded"]).toBe("true");
    f.menuEvents.focusout({ relatedTarget: null });
    expect(f.classes.has("-open")).toBe(false); expect(f.attributes["aria-expanded"]).toBe("false");
  });
});

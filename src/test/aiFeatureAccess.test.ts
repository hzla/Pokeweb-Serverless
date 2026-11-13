import { describe, expect, it, vi } from "vitest";
import { AI_FEATURES_NOTICE, applyAiFeaturesParam, canUseAiFeatures, hasAiFeaturesUnlock, isLocalPokewebHost } from "../pokeweb/aiFeatureAccess";
import { canOpenMapStudio } from "../pokeweb/mapStudioAccess";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}
const hosted = "hzla.github.io";

describe("AI feature unlock", () => {
  it("is always on locally and off on the hosted site by default", () => {
    for (const host of ["localhost", "127.0.0.1", "::1", "[::1]"]) expect(isLocalPokewebHost(host)).toBe(true);
    for (const host of ["", hosted, "localhost.example"]) expect(isLocalPokewebHost(host)).toBe(false);
    expect(hasAiFeaturesUnlock("", memoryStorage())).toBe(false);
    expect(canUseAiFeatures(hosted)).toBe(false);
    expect(canOpenMapStudio(hosted)).toBe(false);
  });

  it("unlocks with ?okWithAI=true until storage is cleared, with the notice once", () => {
    const storage = memoryStorage();
    const notify = vi.fn();
    expect(applyAiFeaturesParam({ search: "?okWithAI=true", storage, hostname: hosted, notify })).toBe("unlocked");
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith(AI_FEATURES_NOTICE);
    expect(AI_FEATURES_NOTICE).toMatch(/^The patches you've unlocked were developed with AI assistance\./u);
    expect(AI_FEATURES_NOTICE).toMatch(/pokeweb Discord/u);
    // A later visit without the parameter stays unlocked; the parameter again doesn't repeat the notice.
    expect(hasAiFeaturesUnlock("", storage)).toBe(true);
    expect(hasAiFeaturesUnlock("?route=pokemon", storage)).toBe(true);
    expect(applyAiFeaturesParam({ search: "?okWithAI=true", storage, hostname: hosted, notify })).toBe("unchanged");
    expect(notify).toHaveBeenCalledOnce();
    // Cleared site data: locked again.
    storage.values.clear();
    expect(hasAiFeaturesUnlock("", storage)).toBe(false);
  });

  it("ignores other values, locks with ?okWithAI=false, and doesn't notify locally", () => {
    const storage = memoryStorage();
    const notify = vi.fn();
    expect(applyAiFeaturesParam({ search: "?okWithAI=yes", storage, hostname: hosted, notify })).toBe("unchanged");
    expect(hasAiFeaturesUnlock("?okWithAI=yes", storage)).toBe(false);
    expect(applyAiFeaturesParam({ search: "?okWithAI=TRUE", storage, hostname: "localhost", notify })).toBe("unlocked");
    expect(notify).not.toHaveBeenCalled();
    expect(applyAiFeaturesParam({ search: "?okWithAI=false", storage, hostname: hosted, notify })).toBe("locked");
    expect(hasAiFeaturesUnlock("", storage)).toBe(false);
    // Without storage (blocked), the URL still unlocks the page it's on.
    expect(hasAiFeaturesUnlock("?okWithAI=true", undefined)).toBe(true);
  });
});

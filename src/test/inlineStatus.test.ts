import { describe, expect, it } from "vitest";
import { inlineStatusTone, renderInlineStatus } from "../ui/inlineStatus";

describe("inline status meaning", () => {
  it.each(["Ready", "Not Installed", "Unsupported", "Unavailable", "Disabled"])("keeps %s neutral", label => {
    expect(inlineStatusTone(label)).toBe("neutral");
  });

  it.each(["Installed", "Applied", "Migrated", "Enabled", "Assignable"])("recognizes %s as successful", label => {
    expect(inlineStatusTone(label)).toBe("success");
  });

  it.each(["Update Available", "Dependency Missing", "Signature unknown", "Incomplete", "Fallback"])("marks %s as needing attention", label => {
    expect(inlineStatusTone(label)).toBe("warning");
  });

  it("distinguishes an incompatible patch from an unsupported game", () => {
    expect(inlineStatusTone("Incompatible")).toBe("error");
    expect(inlineStatusTone("Unsupported")).toBe("neutral");
  });

  it("retains the state text when decorative markers are hidden from assistive technology", () => {
    const html = renderInlineStatus("Update Available", { className: "code-injection-status" });
    expect(html).toContain('class="inline-status code-injection-status"');
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('aria-hidden="true">!</span>');
    expect(html).toContain('class="inline-status__label">Update available</span>');
  });

  it("escapes labels and tooltip metadata", () => {
    const html = renderInlineStatus('<script>bad</script>', { title: '" onmouseover="bad' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;");
    expect(html).toContain('title="&quot; onmouseover=&quot;bad"');
  });
});

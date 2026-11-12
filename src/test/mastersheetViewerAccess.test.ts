import { describe, expect, it } from "vitest";
import { canOpenMastersheetViewer } from "../pokeweb/mastersheetViewerAccess";

describe("mastersheet viewer access", () => {
  it("opens only on localhost while the viewer is in development", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "::1"]) expect(canOpenMastersheetViewer(host)).toBe(true);
    for (const host of ["hzla.github.io", "pokeweb.example.com", ""]) expect(canOpenMastersheetViewer(host)).toBe(false);
  });
});

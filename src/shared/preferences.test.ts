import { describe, expect, it } from "vitest";
import { normalizeTranslationColor } from "./preferences";

describe("translation preferences", () => {
  it("normalizes valid six-digit hex colors", () => {
    expect(normalizeTranslationColor("#3A7BC8")).toBe("#3a7bc8");
  });

  it("rejects values that cannot be safely embedded in extension CSS", () => {
    expect(normalizeTranslationColor("red")).toBeUndefined();
    expect(normalizeTranslationColor("#fff")).toBeUndefined();
    expect(normalizeTranslationColor("#123456; display:none")).toBeUndefined();
  });
});

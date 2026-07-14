import { describe, expect, it } from "vitest";
import { injectionErrorCode } from "./access";

describe("content-script injection errors", () => {
  it("recognizes a missing temporary host permission", () => {
    expect(
      injectionErrorCode(
        new Error(
          'Cannot access contents of url "https://x.com/". Extension manifest must request permission to access the respective host.',
        ),
      ),
    ).toBe("SITE_ACCESS_REQUIRED");
  });

  it("keeps protected pages separate from missing site access", () => {
    expect(injectionErrorCode(new Error("Cannot access a chrome:// URL"))).toBe("PAGE_UNSUPPORTED");
  });
});

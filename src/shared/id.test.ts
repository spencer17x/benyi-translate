import { describe, expect, it } from "vitest";
import { createId } from "./id";

describe("createId", () => {
  it("creates distinct UUID-shaped identifiers", () => {
    const first = createId();
    const second = createId();

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(second).not.toBe(first);
  });
});

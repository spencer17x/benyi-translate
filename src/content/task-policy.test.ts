import { describe, expect, it } from "vitest";
import type { TaskStatus } from "../shared/protocol";
import { acceptsDynamicContent } from "./task-policy";

describe("acceptsDynamicContent", () => {
  it.each([
    ["idle", false],
    ["collecting", false],
    ["preparing", false],
    ["translating", true],
    ["paused", false],
    ["cancelled", false],
    ["completed", true],
    ["failed", false],
  ] satisfies [TaskStatus, boolean][])("returns %s => %s", (status, expected) => {
    expect(acceptsDynamicContent(status)).toBe(expected);
  });
});

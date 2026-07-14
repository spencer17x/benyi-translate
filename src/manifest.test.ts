import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
  it("registers a cross-platform shortcut for the extension action", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
    ) as {
      commands?: Record<string, { suggested_key?: Record<string, string> }>;
    };

    expect(manifest.commands?._execute_action?.suggested_key).toEqual({
      default: "Ctrl+Shift+Y",
      mac: "Command+Shift+Y",
    });
  });
});

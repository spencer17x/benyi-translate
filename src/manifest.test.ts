import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
  it("keeps release metadata and action configuration valid", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    const manifest = JSON.parse(
      readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
    ) as {
      action?: {
        default_icon?: Record<string, string>;
      };
      commands?: Record<string, { suggested_key?: Record<string, string> }>;
      icons?: Record<string, string>;
      permissions?: string[];
      version?: string;
    };

    expect(manifest.commands?._execute_action?.suggested_key).toEqual({
      default: "Ctrl+Shift+Y",
      mac: "Command+Shift+Y",
    });

    expect(manifest.icons).toEqual({
      "16": "assets/icons/benyi-logo-16.png",
      "32": "assets/icons/benyi-logo-32.png",
      "48": "assets/icons/benyi-logo-48.png",
      "128": "assets/icons/benyi-logo-128.png",
    });
    expect(manifest.action?.default_icon).toEqual({
      "16": "assets/icons/benyi-logo-16.png",
      "32": "assets/icons/benyi-logo-32.png",
    });
    expect(manifest.permissions).toEqual(["activeTab", "scripting", "sidePanel"]);
    expect(manifest.version).toBe(packageJson.version);
  });
});

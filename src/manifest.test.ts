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
        default_title?: string;
        default_icon?: Record<string, string>;
      };
      commands?: Record<
        string,
        {
          description?: string;
          suggested_key?: Record<string, string>;
        }
      >;
      icons?: Record<string, string>;
      permissions?: string[];
      version?: string;
    };

    expect(manifest.commands?._execute_action?.suggested_key).toEqual({
      default: "Ctrl+Shift+Y",
      mac: "Command+Shift+Y",
    });
    expect(manifest.commands?.["translate-page"]).toEqual({
      suggested_key: {
        default: "Ctrl+Shift+U",
        mac: "Command+Shift+U",
      },
      description: "翻译当前页面",
    });
    expect(manifest.commands?.["toggle-pause-translation"]).toEqual({
      suggested_key: {
        default: "Ctrl+Shift+P",
        mac: "Command+Shift+P",
      },
      description: "暂停或继续翻译",
    });
    expect(manifest.commands?.["cancel-translation"]).toEqual({
      suggested_key: {
        default: "Ctrl+Shift+X",
        mac: "Command+Shift+X",
      },
      description: "取消当前翻译",
    });
    expect(manifest.commands?.["undo-translation"]).toEqual({
      description: "撤销当前页面的全部译文",
    });
    expect(manifest.commands?.["cycle-display-mode"]).toEqual({
      description: "切换原文、双语和仅译文显示",
    });
    expect(manifest.commands?.["translate-selection"]).toEqual({
      description: "翻译选中文本",
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
    expect(manifest.action?.default_title).toBe("使用本译翻译当前页");
    expect(manifest.permissions).toEqual([
      "activeTab",
      "contextMenus",
      "scripting",
      "sidePanel",
      "storage",
    ]);
    expect(manifest.version).toBe(packageJson.version);
  });
});

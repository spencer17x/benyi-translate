import { describe, expect, it } from "vitest";
import { PANEL_COMMANDS } from "./commands";
import {
  isEnginePageMessage,
  isEngineResultMessage,
  isPageCommandMessage,
} from "./engine-protocol";
import { PROTOCOL_VERSION } from "./protocol";

describe("background translation protocol", () => {
  it("validates commands sent to the active page", () => {
    expect(
      isPageCommandMessage({
        version: PROTOCOL_VERSION,
        type: "PAGE_COMMAND",
        tabId: 7,
        command: PANEL_COMMANDS.translatePage,
      }),
    ).toBe(true);
    expect(
      isPageCommandMessage({
        version: PROTOCOL_VERSION,
        type: "PAGE_COMMAND",
        tabId: -1,
        command: PANEL_COMMANDS.translatePage,
      }),
    ).toBe(false);
  });

  it("validates page messages sent to the hidden engine", () => {
    expect(
      isEnginePageMessage({
        version: PROTOCOL_VERSION,
        type: "ENGINE_PAGE_MESSAGE",
        message: {
          version: PROTOCOL_VERSION,
          type: "PAGE_STATE",
          tabId: 7,
          pageId: "page",
          status: "idle",
          mode: "bilingual",
          progress: { total: 0, completed: 0, failed: 0, skipped: 0 },
        },
      }),
    ).toBe(true);
  });

  it("requires engine results to target the same tab as their task identity", () => {
    const result = {
      version: PROTOCOL_VERSION,
      type: "ENGINE_RESULT_MESSAGE",
      tabId: 7,
      message: {
        version: PROTOCOL_VERSION,
        type: "TASK_COMPLETE",
        tabId: 7,
        pageId: "page",
        taskId: "task",
      },
    };

    expect(isEngineResultMessage(result)).toBe(true);
    expect(isEngineResultMessage({ ...result, tabId: 8 })).toBe(false);
  });
});

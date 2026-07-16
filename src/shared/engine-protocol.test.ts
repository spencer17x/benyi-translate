import { describe, expect, it } from "vitest";
import { PANEL_COMMANDS } from "./commands";
import {
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
});

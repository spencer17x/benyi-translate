import { describe, expect, it } from "vitest";
import {
  isPanelCommand,
  isPendingPanelCommand,
  PANEL_COMMANDS,
} from "./commands";

describe("extension commands", () => {
  it("accepts every supported panel command", () => {
    for (const command of Object.values(PANEL_COMMANDS)) {
      expect(isPanelCommand(command)).toBe(true);
      expect(isPendingPanelCommand({ tabId: 7, command })).toBe(true);
    }
  });

  it("rejects malformed command requests", () => {
    expect(isPanelCommand("unknown-command")).toBe(false);
    expect(isPendingPanelCommand({ tabId: -1, command: PANEL_COMMANDS.cancelTranslation })).toBe(false);
    expect(isPendingPanelCommand({ tabId: 7, command: "unknown-command" })).toBe(false);
  });
});

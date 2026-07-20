import { describe, expect, it } from "vitest";
import { isPanelCommand, isSelectionCommand, PANEL_COMMANDS, SELECTION_COMMAND } from "./commands";

describe("extension commands", () => {
  it("accepts every supported panel command", () => {
    for (const command of Object.values(PANEL_COMMANDS)) {
      expect(isPanelCommand(command)).toBe(true);
    }
  });

  it("rejects malformed command requests", () => {
    expect(isPanelCommand("unknown-command")).toBe(false);
  });

  it("recognizes the standalone selection command", () => {
    expect(isSelectionCommand(SELECTION_COMMAND)).toBe(true);
    expect(isPanelCommand(SELECTION_COMMAND)).toBe(false);
    expect(isSelectionCommand("translate-page")).toBe(false);
  });
});

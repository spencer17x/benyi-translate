import { describe, expect, it } from "vitest";
import { PANEL_COMMANDS } from "../shared/commands";
import { panelCommandAction } from "./command";

const idleState = {
  taskStatus: "idle" as const,
  localPreparing: false,
  hasTask: false,
  completed: 0,
};

describe("panel command actions", () => {
  it("starts, pauses, resumes, and cancels translation in valid states", () => {
    expect(panelCommandAction(PANEL_COMMANDS.translatePage, idleState)).toBe("start");
    expect(
      panelCommandAction(PANEL_COMMANDS.togglePause, { ...idleState, taskStatus: "translating" }),
    ).toBe("pause");
    expect(
      panelCommandAction(PANEL_COMMANDS.togglePause, { ...idleState, taskStatus: "paused" }),
    ).toBe("start");
    expect(
      panelCommandAction(PANEL_COMMANDS.cancelTranslation, {
        ...idleState,
        taskStatus: "preparing",
        localPreparing: true,
        hasTask: true,
      }),
    ).toBe("cancel");
  });

  it("only enables undo when translated content exists", () => {
    expect(panelCommandAction(PANEL_COMMANDS.undoTranslation, idleState)).toBe("none");
    expect(
      panelCommandAction(PANEL_COMMANDS.undoTranslation, {
        ...idleState,
        taskStatus: "completed",
        hasTask: true,
        completed: 3,
      }),
    ).toBe("undo");
  });

  it("always allows cycling the display mode", () => {
    expect(panelCommandAction(PANEL_COMMANDS.cycleDisplayMode, idleState)).toBe("cycle-display");
  });
});

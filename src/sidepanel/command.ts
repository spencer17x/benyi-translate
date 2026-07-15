import type { PanelCommand } from "../shared/commands";
import { PANEL_COMMANDS } from "../shared/commands";
import type { TaskStatus } from "../shared/protocol";

export type PanelCommandAction = "start" | "pause" | "cancel" | "undo" | "cycle-display" | "none";

export function panelCommandAction(
  command: PanelCommand,
  state: {
    taskStatus: TaskStatus;
    localPreparing: boolean;
    hasTask: boolean;
    completed: number;
  },
): PanelCommandAction {
  const busy =
    state.localPreparing ||
    state.taskStatus === "collecting" ||
    state.taskStatus === "preparing" ||
    state.taskStatus === "translating";

  switch (command) {
    case PANEL_COMMANDS.translatePage:
      return busy ? "none" : "start";
    case PANEL_COMMANDS.togglePause:
      if (state.taskStatus === "translating") return "pause";
      if (state.taskStatus === "paused") return "start";
      return "none";
    case PANEL_COMMANDS.cancelTranslation:
      return busy || state.taskStatus === "paused" ? "cancel" : "none";
    case PANEL_COMMANDS.undoTranslation:
      return state.hasTask && state.completed > 0 ? "undo" : "none";
    case PANEL_COMMANDS.cycleDisplayMode:
      return "cycle-display";
  }
}

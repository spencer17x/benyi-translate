export const PANEL_COMMANDS = {
  translatePage: "translate-page",
  togglePause: "toggle-pause-translation",
  cancelTranslation: "cancel-translation",
  undoTranslation: "undo-translation",
  cycleDisplayMode: "cycle-display-mode",
} as const;

export const SELECTION_COMMAND = "translate-selection" as const;

export type PanelCommand = (typeof PANEL_COMMANDS)[keyof typeof PANEL_COMMANDS];

export function isPanelCommand(value: unknown): value is PanelCommand {
  return Object.values(PANEL_COMMANDS).some((command) => command === value);
}

export function isSelectionCommand(value: unknown): value is typeof SELECTION_COMMAND {
  return value === SELECTION_COMMAND;
}

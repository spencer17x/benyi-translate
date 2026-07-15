export const PANEL_COMMANDS = {
  translatePage: "translate-page",
  togglePause: "toggle-pause-translation",
  cancelTranslation: "cancel-translation",
  undoTranslation: "undo-translation",
  cycleDisplayMode: "cycle-display-mode",
} as const;

export type PanelCommand = (typeof PANEL_COMMANDS)[keyof typeof PANEL_COMMANDS];

export const PENDING_PANEL_COMMAND_KEY = "pendingPanelCommand";

export type PendingPanelCommand = {
  tabId: number;
  command: PanelCommand;
};

export function isPanelCommand(value: unknown): value is PanelCommand {
  return Object.values(PANEL_COMMANDS).some((command) => command === value);
}

export function isPendingPanelCommand(value: unknown): value is PendingPanelCommand {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.tabId === "number" &&
    Number.isSafeInteger(request.tabId) &&
    request.tabId >= 0 &&
    isPanelCommand(request.command)
  );
}

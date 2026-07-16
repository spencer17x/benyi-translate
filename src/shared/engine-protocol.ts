import { isPanelCommand, type PanelCommand } from "./commands";
import { PROTOCOL_VERSION } from "./protocol";

export type PageCommandMessage = {
  version: 1;
  type: "PAGE_COMMAND";
  tabId: number;
  command: PanelCommand;
};

export function isPageCommandMessage(value: unknown): value is PageCommandMessage {
  if (!isRecord(value)) return false;
  return value.type === "PAGE_COMMAND" && isSafeTabId(value.tabId) && isPanelCommand(value.command);
}

function isRecord(value: unknown): value is Record<string, unknown> & { version: 1; type: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).version === PROTOCOL_VERSION &&
    typeof (value as Record<string, unknown>).type === "string"
  );
}

function isSafeTabId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

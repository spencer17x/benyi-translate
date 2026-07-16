import { isPanelCommand, type PanelCommand } from "./commands";
import {
  isPageToPanelMessage,
  isPanelToPageMessage,
  PROTOCOL_VERSION,
  type PageToPanelMessage,
  type PanelToPageMessage,
} from "./protocol";

export const OFFSCREEN_DOCUMENT_PATH = "offscreen/index.html";

export type PageCommandMessage = {
  version: 1;
  type: "PAGE_COMMAND";
  tabId: number;
  command: PanelCommand;
};

export type EnginePageMessage = {
  version: 1;
  type: "ENGINE_PAGE_MESSAGE";
  message: PageToPanelMessage;
};

export type EngineResultMessage = {
  version: 1;
  type: "ENGINE_RESULT_MESSAGE";
  tabId: number;
  message: PanelToPageMessage;
};

export function isPageCommandMessage(value: unknown): value is PageCommandMessage {
  if (!isRecord(value)) return false;
  return value.type === "PAGE_COMMAND" && isSafeTabId(value.tabId) && isPanelCommand(value.command);
}

export function isEnginePageMessage(value: unknown): value is EnginePageMessage {
  if (!isRecord(value)) return false;
  return value.type === "ENGINE_PAGE_MESSAGE" && isPageToPanelMessage(value.message);
}

export function isEngineResultMessage(value: unknown): value is EngineResultMessage {
  if (!isRecord(value) || value.type !== "ENGINE_RESULT_MESSAGE" || !isSafeTabId(value.tabId)) {
    return false;
  }
  if (!isPanelToPageMessage(value.message)) return false;
  return value.message.tabId === value.tabId;
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

import {
  PROTOCOL_VERSION,
  type ActionReadyMessage,
} from "../shared/protocol";
import {
  isPanelCommand,
  PENDING_PANEL_COMMAND_KEY,
  type PendingPanelCommand,
} from "../shared/commands";

async function configureSidePanel(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}

chrome.action.onClicked.addListener((tab) => {
  openAndPrepare(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!isPanelCommand(command) || tab?.id === undefined) return;

  const request: PendingPanelCommand = { tabId: tab.id, command };
  const requestPromise = chrome.storage.session.set({
    [PENDING_PANEL_COMMAND_KEY]: request,
  });
  openAndPrepare(tab, requestPromise);
});

function openAndPrepare(tab: chrome.tabs.Tab, requestPromise: Promise<void> = Promise.resolve()): void {
  if (tab.id === undefined) return;

  const openPromise = chrome.sidePanel.open({ tabId: tab.id });
  const injectionPromise = chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content/content-script.js"],
  });
  void finishAction(tab.id, openPromise, injectionPromise, requestPromise);
}

async function finishAction(
  tabId: number,
  openPromise: Promise<void>,
  injectionPromise: Promise<chrome.scripting.InjectionResult[]>,
  requestPromise: Promise<void>,
): Promise<void> {
  const [open, injection, request] = await Promise.allSettled([
    openPromise,
    injectionPromise,
    requestPromise,
  ]);
  if (open.status === "rejected") {
    await chrome.storage.session.remove(PENDING_PANEL_COMMAND_KEY).catch(() => undefined);
    console.warn("Benyi could not open the side panel");
    return;
  }
  if (injection.status === "rejected") {
    console.warn("Benyi could not prepare the active page");
  }
  if (request.status === "rejected") {
    console.warn("Benyi could not queue the translation command");
  }

  const message: ActionReadyMessage = {
    version: PROTOCOL_VERSION,
    type: "ACTION_READY",
    tabId,
  };
  await chrome.runtime.sendMessage(message).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel().catch((error: unknown) => {
    console.error("Failed to configure the Benyi side panel", error);
  });
});

void configureSidePanel().catch((error: unknown) => {
  console.error("Failed to restore the Benyi side panel behavior", error);
});

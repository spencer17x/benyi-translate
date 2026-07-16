import {
  MAX_SELECTION_CHARACTERS,
  PROTOCOL_VERSION,
  type ActionReadyMessage,
  type SelectionTranslateMessage,
} from "../shared/protocol";
import {
  isPanelCommand,
  isSelectionCommand,
  PENDING_PANEL_COMMAND_KEY,
  type PendingPanelCommand,
} from "../shared/commands";

const SELECTION_MENU_ID = "benyi-translate-selection";

async function configureSidePanel(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}

async function configureContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: SELECTION_MENU_ID,
    title: "使用本译翻译选中文本",
    contexts: ["selection"],
  });
}

chrome.action.onClicked.addListener((tab) => {
  openAndPrepare(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (tab?.id === undefined) return;
  if (isSelectionCommand(command)) {
    void prepareSelectionTranslation(tab);
    return;
  }
  if (!isPanelCommand(command)) return;

  const request: PendingPanelCommand = { tabId: tab.id, command };
  const requestPromise = chrome.storage.session.set({
    [PENDING_PANEL_COMMAND_KEY]: request,
  });
  openAndPrepare(tab, requestPromise);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== SELECTION_MENU_ID || tab?.id === undefined) return;
  void prepareSelectionTranslation(tab, info.selectionText);
});

async function prepareSelectionTranslation(tab: chrome.tabs.Tab, sourceText?: string): Promise<void> {
  if (tab.id === undefined) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/content-script.js"],
    });
    const message: SelectionTranslateMessage = {
      version: PROTOCOL_VERSION,
      type: "SELECTION_TRANSLATE",
      sourceText: sourceText?.slice(0, MAX_SELECTION_CHARACTERS + 1),
    };
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    console.warn("Benyi could not translate the current selection");
  }
}

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
  void configureContextMenu().catch((error: unknown) => {
    console.error("Failed to configure the Benyi selection menu", error);
  });
});

void configureSidePanel().catch((error: unknown) => {
  console.error("Failed to restore the Benyi side panel behavior", error);
});

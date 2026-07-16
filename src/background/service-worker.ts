import {
  isEngineResultMessage,
  isPageCommandMessage,
  OFFSCREEN_DOCUMENT_PATH,
  type PageCommandMessage,
} from "../shared/engine-protocol";
import {
  isPanelCommand,
  isSelectionCommand,
  PANEL_COMMANDS,
  type PanelCommand,
} from "../shared/commands";
import {
  MAX_SELECTION_CHARACTERS,
  PROTOCOL_VERSION,
  type SelectionTranslateMessage,
} from "../shared/protocol";

const SELECTION_MENU_ID = "benyi-translate-selection";
const OPEN_PANEL_MENU_ID = "benyi-open-control-panel";
let creatingOffscreenDocument: Promise<void> | undefined;

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
  chrome.contextMenus.create({
    id: OPEN_PANEL_MENU_ID,
    title: "打开本译控制面板",
    contexts: ["action"],
  });
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) void runPageCommand(tab.id, PANEL_COMMANDS.translatePage);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (tab?.id === undefined) return;
  if (isSelectionCommand(command)) {
    void prepareSelectionTranslation(tab.id);
    return;
  }
  if (isPanelCommand(command)) void runPageCommand(tab.id, command);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id === undefined) return;
  if (info.menuItemId === SELECTION_MENU_ID) {
    void prepareSelectionTranslation(tab.id, info.selectionText);
  } else if (info.menuItemId === OPEN_PANEL_MENU_ID) {
    void chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
  }
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (isEngineResultMessage(message)) {
    if (sender.url !== chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)) return false;
    void chrome.tabs
      .sendMessage(message.tabId, message.message)
      .then(() => sendResponse({ delivered: true }))
      .catch(() => sendResponse({ delivered: false }));
    return true;
  }

  if (isPageCommandMessage(message)) {
    if (sender.id !== chrome.runtime.id || sender.tab !== undefined) return false;
    void runPageCommand(message.tabId, message.command)
      .then(() => sendResponse({ accepted: true }))
      .catch(() => sendResponse({ accepted: false }));
    return true;
  }
  return false;
});

async function runPageCommand(tabId: number, command: PanelCommand): Promise<void> {
  if (command === PANEL_COMMANDS.translatePage || command === PANEL_COMMANDS.togglePause) {
    await ensureOffscreenDocument();
  }
  await ensureContentScript(tabId);
  const message: PageCommandMessage = {
    version: PROTOCOL_VERSION,
    type: "PAGE_COMMAND",
    tabId,
    command,
  };
  await chrome.tabs.sendMessage(tabId, message);
}

async function prepareSelectionTranslation(tabId: number, sourceText?: string): Promise<void> {
  try {
    await ensureContentScript(tabId);
    const message: SelectionTranslateMessage = {
      version: PROTOCOL_VERSION,
      type: "SELECTION_TRANSLATE",
      sourceText: sourceText?.slice(0, MAX_SELECTION_CHARACTERS + 1),
    };
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    console.warn("Benyi could not translate the current selection");
  }
}

async function ensureContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/content-script.js"],
  });
}

async function ensureOffscreenDocument(): Promise<void> {
  const documentUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [documentUrl],
  });
  if (contexts.length > 0) return;

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_DOCUMENT_PATH,
        reasons: ["DOM_PARSER"],
        justification: "运行仅支持文档上下文的 Chrome 本地 Translator API，不显示额外界面。",
      })
      .finally(() => {
        creatingOffscreenDocument = undefined;
      });
  }
  await creatingOffscreenDocument;
}

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel().catch((error: unknown) => {
    console.error("Failed to configure the Benyi side panel", error);
  });
  void configureContextMenu().catch((error: unknown) => {
    console.error("Failed to configure the Benyi context menus", error);
  });
});

void configureSidePanel().catch((error: unknown) => {
  console.error("Failed to restore the Benyi side panel behavior", error);
});

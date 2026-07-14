import {
  PROTOCOL_VERSION,
  type ActionReadyMessage,
} from "../shared/protocol";

async function configureSidePanel(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;

  const openPromise = chrome.sidePanel.open({ tabId: tab.id });
  const injectionPromise = chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content/content-script.js"],
  });
  void finishAction(tab.id, openPromise, injectionPromise);
});

async function finishAction(
  tabId: number,
  openPromise: Promise<void>,
  injectionPromise: Promise<chrome.scripting.InjectionResult[]>,
): Promise<void> {
  const [, injection] = await Promise.allSettled([openPromise, injectionPromise]);
  if (injection.status === "rejected") {
    console.warn("Benyi could not prepare the active page");
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

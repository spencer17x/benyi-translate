async function configureSidePanel(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onInstalled.addListener(() => {
  void configureSidePanel().catch((error: unknown) => {
    console.error("Failed to configure the Benyi side panel", error);
  });
});

void configureSidePanel().catch((error: unknown) => {
  console.error("Failed to restore the Benyi side panel behavior", error);
});

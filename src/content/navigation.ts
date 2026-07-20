export const NAVIGATION_POLL_INTERVAL_MS = 1_000;

export type PageNavigationChange = {
  previousUrl: string;
  currentUrl: string;
};

export type PageNavigationObserver = {
  check(): void;
  dispose(): void;
};

export function observePageNavigation(
  view: Window,
  onNavigate: (change: PageNavigationChange) => void,
  pollIntervalMs = NAVIGATION_POLL_INTERVAL_MS,
): PageNavigationObserver {
  let currentUrl = view.location.href;

  const check = (): void => {
    const nextUrl = view.location.href;
    if (nextUrl === currentUrl) return;

    const previousUrl = currentUrl;
    currentUrl = nextUrl;
    onNavigate({ previousUrl, currentUrl: nextUrl });
  };

  view.addEventListener("popstate", check);
  view.addEventListener("hashchange", check);
  const pollTimer = view.setInterval(check, pollIntervalMs);

  return {
    check,
    dispose() {
      view.removeEventListener("popstate", check);
      view.removeEventListener("hashchange", check);
      view.clearInterval(pollTimer);
    },
  };
}

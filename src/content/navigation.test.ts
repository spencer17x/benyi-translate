import { afterEach, describe, expect, it, vi } from "vitest";
import { observePageNavigation } from "./navigation";

type NavigationTestWindow = {
  view: Window;
  navigate(url: string): void;
  dispatch(type: "popstate" | "hashchange"): void;
};

afterEach(() => {
  vi.useRealTimers();
});

describe("observePageNavigation", () => {
  it("reports history-style URL changes through the polling fallback", () => {
    vi.useFakeTimers();
    const testWindow = createTestWindow("https://example.com/start");
    const onNavigate = vi.fn();
    const observer = observePageNavigation(testWindow.view, onNavigate, 250);

    testWindow.navigate("https://example.com/next");
    vi.advanceTimersByTime(250);

    expect(onNavigate).toHaveBeenCalledWith({
      previousUrl: "https://example.com/start",
      currentUrl: "https://example.com/next",
    });

    observer.dispose();
  });

  it("deduplicates event and polling notifications for the same navigation", () => {
    vi.useFakeTimers();
    const testWindow = createTestWindow("https://example.com/start");
    const onNavigate = vi.fn();
    const observer = observePageNavigation(testWindow.view, onNavigate, 250);

    testWindow.navigate("https://example.com/start#details");
    testWindow.dispatch("hashchange");
    vi.advanceTimersByTime(250);

    expect(onNavigate).toHaveBeenCalledTimes(1);

    observer.dispose();
  });

  it("stops listening and polling after disposal", () => {
    vi.useFakeTimers();
    const testWindow = createTestWindow("https://example.com/start");
    const onNavigate = vi.fn();
    const observer = observePageNavigation(testWindow.view, onNavigate, 250);

    observer.dispose();
    testWindow.navigate("https://example.com/next");
    testWindow.dispatch("popstate");
    vi.advanceTimersByTime(500);

    expect(onNavigate).not.toHaveBeenCalled();
  });
});

function createTestWindow(initialUrl: string): NavigationTestWindow {
  let currentUrl = initialUrl;
  const listeners = new Map<string, Set<EventListener>>();
  const view = {
    location: {
      get href() {
        return currentUrl;
      },
    },
    addEventListener(type: string, listener: EventListener) {
      const registered = listeners.get(type) ?? new Set<EventListener>();
      registered.add(listener);
      listeners.set(type, registered);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener);
    },
    setInterval(handler: TimerHandler, timeout?: number) {
      return globalThis.setInterval(handler, timeout) as unknown as number;
    },
    clearInterval(timer: number) {
      globalThis.clearInterval(timer);
    },
  } as unknown as Window;

  return {
    view,
    navigate(url: string) {
      currentUrl = url;
    },
    dispatch(type: "popstate" | "hashchange") {
      for (const listener of listeners.get(type) ?? []) listener(new Event(type));
    },
  };
}
